import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { isLivelihoodPolicy } from './livelihood-policy.js';
import { loadPopulationAgePolicy, type PopulationAgePolicy } from '../../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy, type PopulationMortalityPolicy } from '../../../population-lifecycle/mortality.js';
import { reconcilePopulationDeaths } from './population-death-runtime.js';
import { defaultEstateRuntimeOptions } from './population-estate-runtime.js';
import { runPopulationEstateCycle, type EstateRuntimeOptions } from '../../../population-estate/runtime.js';
import { loadHealthPolicy, runPopulationHealthCycle, type PopulationHealthRuntimeOptions } from '../../../population-health/index.js';
import { populationHealthDbPath, populationHealthPolicyPath, populationHealthEngineEvidencePath } from './paths.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { readEconomicObservation } from './economic-observer-source.js';
import { resolveAgentAssets } from '../../../agent-state/assets.js';
import { planNextAction } from '../../../agent-state/planner.js';
import { episodicQueryFromSnapshot, retrieveEpisodicMemory, retrieveSemanticMemory,
    retrieveSocialMemory, semanticQueryFromSnapshot, socialQueryFromSnapshot } from '../../../agent-state/retrieval.js';
import type { AgentCommitmentStatus, AgentControlProfile, AgentPlayerActionManualStatus, AgentPlayerActionRequest,
    AgentSkillKnowledgeStatus,
    AgentSkillReference, CreateAgentCommitment,
    CreateAgentEpisode, CreateAgentGoal, CreateAgentIdentity, CreateAgentKnowledge, GoalStatus,
    CreateAgentPlayerActionRequest, SetAgentControlProfile, SetAgentRelationship,
    UpdateAgentIdentity } from '../../../agent-state/types.js';
import { agentStateDbPath, economicContractsDbPath, institutionTreasuryDbPath, repoRoot } from './paths.js';
import { listAdminSkills, listAdminSkillsForAgent, type AdminAgentSkillCatalogOptions } from './skill-catalog.js';
import type { BotCatalogEntry } from './types.js';
import type { AdminPropertyView } from './properties.js';
import { readSkillRun, readSkillRunHistory, type AdminSkillRun } from './skill-history.js';
import { requestEnginePlayerReward } from './player-rewards.js';
import { bindSocietyInternalPayment } from './society-integrity.js';
import { InstitutionTreasuryStore, type InstitutionKind } from './institution-treasury.js';
import { BusinessManagerStore } from './business-manager.js';
import { businessManagerPathFor, validateBusinessPlayerActionForAgent } from './business-agent-port.js';
import { factionTreasuryActorForAgent, validateFactionPlayerActionForAgent } from './governance-agent-port.js';
import { inspectGovernanceForAgent, governancePathFor } from './governance-agent-port.js';
import { EconomicContractStore } from './economic-contracts.js';
import { buildAdminDecisionContext } from './admin-decision-context.js';
import { loadCrimeKnowledge, type CrimeKnowledgePaths, type CrimeKnowledgeSnapshot } from './crime-knowledge.js';
import type { GatewayBotSnapshot } from './types.js';
import { workDigest, workUuid, type NativeWorkTarget } from '../../../business-work/index.js';
import { validateCreatePlayerActionRequest } from '../../../agent-state/validation.js';
import { assertCookTarget, assertWorkRequest, businessWorkNeedsRecovery, nativeWorkCompletion, nativeWorkReward, useBusinessWork, workTradeCursor,
    type BusinessWorkRuntimeOptions } from './business-work-runtime.js';

function useStore<T>(path: string, callback: (store: AgentStateStore) => T,
    simulationClock?: AgentStateSimulationClock): T {
    const store = new AgentStateStore(path, simulationClock);
    try { return callback(store); }
    finally { store.close(); }
}

export function institutionTreasuryPathFor(path = agentStateDbPath): string {
    return path === agentStateDbPath ? institutionTreasuryDbPath : join(dirname(path), 'institution-treasury.sqlite');
}

function treasuryActorIdForAgent(agentId: string, profile: AgentControlProfile, path: string): string {
    return profile.subjectKind === 'faction'
        ? factionTreasuryActorForAgent(agentId, path) : profile.subjectId;
}

function useTreasury<T>(path: string, callback: (store: InstitutionTreasuryStore) => T): T {
    const store = new InstitutionTreasuryStore(institutionTreasuryPathFor(path));
    try { return callback(store); }
    finally { store.close(); }
}

function useBusiness<T>(path: string, callback: (store: BusinessManagerStore) => T): T {
    const store = new BusinessManagerStore(businessManagerPathFor(path));
    try { return callback(store); }
    finally { store.close(); }
}

export interface AdminAgentAssetSources {
    simulationClock?: AgentStateSimulationClock;
    populationAgePolicy?: PopulationAgePolicy;
    populationMortalityPolicy?: PopulationMortalityPolicy;
    populationHealth?: PopulationHealthRuntimeOptions;
    populationDeathSourcePath?: string;
    populationEstate?: EstateRuntimeOptions;
    bots?: readonly BotCatalogEntry[];
    properties?: readonly AdminPropertyView[];
    unavailableSources?: readonly string[];
    observedAt?: string;
    skillCatalog?: AdminAgentSkillCatalogOptions;
    gatewayBots?: ReadonlyMap<string, GatewayBotSnapshot>;
    skillRuns?: readonly AdminSkillRun[];
    economicContractsPath?: string;
    crimeKnowledgePaths?: CrimeKnowledgePaths;
}

export async function listAdminAgents(path = agentStateDbPath, assetSources: AdminAgentAssetSources = {}) {
    const [skills, skillRuns] = await Promise.all([listAdminSkills(), assetSources.skillRuns
        ? Promise.resolve([...assetSources.skillRuns]) : readSkillRunHistory(500)]);
    const availableSkills = skills.map(skill => ({ id: skill.id, version: skill.version }));
    const generatedAt = new Date().toISOString();
    const agePolicy = assetSources.simulationClock ? assetSources.populationAgePolicy
        ?? loadPopulationAgePolicy(join(repoRoot, 'config', 'population-age-policy.json')) : null;
    const mortalityPolicy = agePolicy ? assetSources.populationMortalityPolicy
        ?? loadPopulationMortalityPolicy(join(repoRoot, 'config', 'population-mortality-policy.json')) : null;
    const healthOptions = assetSources.populationHealth ?? (path === agentStateDbPath && assetSources.simulationClock
        ? { statePath: populationHealthDbPath, engineEvidencePath: populationHealthEngineEvidencePath,
            policy: loadHealthPolicy(populationHealthPolicyPath) } : null);
    const deathSource = assetSources.populationDeathSourcePath ?? (path === agentStateDbPath ? populationHealthEngineEvidencePath : null);
    let deathUnavailable = false;
    if (deathSource && agePolicy && mortalityPolicy && assetSources.simulationClock) {
        try { useStore(path, store => reconcilePopulationDeaths(store, deathSource, agePolicy, mortalityPolicy), assetSources.simulationClock); }
        catch { deathUnavailable = true; }
    }
    const estateOptions = assetSources.populationEstate ?? (path === agentStateDbPath ? defaultEstateRuntimeOptions() : null);
    let estate: ReturnType<typeof runPopulationEstateCycle> | null = null;
    if (estateOptions) { try { estate = runPopulationEstateCycle(estateOptions,assetSources.observedAt ?? generatedAt); }
        catch { estate = null; } }
    const health = healthOptions && agePolicy && assetSources.simulationClock ? useStore(path,
        store => runPopulationHealthCycle(store, assetSources.simulationClock!, agePolicy, healthOptions,
            assetSources.observedAt ?? generatedAt), assetSources.simulationClock) : null;
    const treasuries = new Map(useTreasury(path, store => store.list())
        .map(item => [`${item.kind}:${item.id}`, item]));
    const businesses = new Map(useBusiness(path, store => store.list(500))
        .map(item => [item.businessId, item]));
    const contractPath = assetSources.economicContractsPath ?? (path === agentStateDbPath
        ? economicContractsDbPath : join(dirname(path), 'economic-contracts.sqlite'));
    let offers: ReturnType<EconomicContractStore['listOffers']> = [];
    let contracts: ReturnType<EconomicContractStore['listContracts']> = [];
    if (existsSync(contractPath)) {
        const economic = new EconomicContractStore(contractPath);
        try { offers = economic.listOffers(500, generatedAt); contracts = economic.listContracts(500); }
        finally { economic.close(); }
    }
    const crimePaths = assetSources.crimeKnowledgePaths ?? (path === agentStateDbPath ? {
        thieving: join(repoRoot, '.local', 'crime', 'thieving-procedures.sqlite'),
        cases: join(repoRoot, '.local', 'crime', 'cases.sqlite'),
        reintegrationEvidence:join(repoRoot,'.local','crime','reintegration-evidence.sqlite'),
        reintegrationState:join(repoRoot,'.local','crime','reintegration-state.sqlite'),worldProfileId:'local-world'
    } : null);
    const crimeKnowledge: CrimeKnowledgeSnapshot = crimePaths
        ? loadCrimeKnowledge(crimePaths, useStore(path, store => store.listIdentities().map(value => value.agentId)))
        : { byViewer: new Map(), reformsByViewer:new Map(), unavailable: false };
    const agents = useStore(path, store => store.listIdentities().map(identity => {
        const populationAge = agePolicy ? store.getPopulationAge(identity.agentId, agePolicy,
            assetSources.observedAt ?? generatedAt) : null;
        const populationMortality = agePolicy && mortalityPolicy
            ? store.getPopulationMortality(identity.agentId, agePolicy, mortalityPolicy) : null;
        const populationHealth = health?.byAgent.get(identity.agentId) ?? null;
        const snapshot = store.getSnapshot(identity.agentId)!;
        const populationDeath = store.getPopulationDeath(identity.agentId);
        const archivedMemory = store.getPopulationMemoryArchive(identity.agentId);
        const populationMemoryArchive = archivedMemory ? {digest:archivedMemory.digest,deathEventId:archivedMemory.archive.deathEventId,
            capturedAt:archivedMemory.archive.capturedAt,captureMode:archivedMemory.archive.captureMode,
            counts:Object.fromEntries(Object.entries(archivedMemory.archive.records).map(([kind,rows])=>[kind,rows.length]))} : null;
        const populationEstate = estate?.cases.find(current => current.agentId === identity.agentId) ?? null;
        const knownByReference = new Map(snapshot.knownSkills.map(item =>
            [`${item.skill.id}@${item.skill.version}`, item]));
        const skillRelationships = skills.map(skill => {
            const knowledge = knownByReference.get(`${skill.id}@${skill.version}`) ?? null;
            return {
                reference: { id: skill.id, version: skill.version }, name: skill.name,
                exists: true as const, access: 'accessible' as const,
                knowledge: knowledge?.status ?? 'unlearned' as const,
                executable: knowledge?.status === 'known' || knowledge?.status === 'preferred'
            };
        });
        const recentEpisodes = store.listEpisodes(identity.agentId, { limit: 30 });
        const relevantEpisodes = retrieveEpisodicMemory(store.listEpisodes(identity.agentId, { limit: 500 }),
            { ...episodicQueryFromSnapshot(snapshot), now: generatedAt });
        const recentKnowledge = store.listKnowledge(identity.agentId, { limit: 30 });
        const activeKnowledge = store.listKnowledge(identity.agentId, { status: 'active', limit: 500 });
        const relevantKnowledge = retrieveSemanticMemory(store.listKnowledge(identity.agentId, { limit: 500 }),
            { ...semanticQueryFromSnapshot(snapshot), now: generatedAt });
        const relationships = store.listRelationships(identity.agentId).map(relationship => ({
            relationship, commitments: store.listCommitments(identity.agentId, relationship.actorKey)
        }));
        const relevantRelationships = retrieveSocialMemory(relationships,
            { ...socialQueryFromSnapshot(snapshot), now: generatedAt });
        const actorLinks = store.listEconomicActorLinks(identity.agentId);
        const controlProfile = store.getControlProfile(identity.agentId)!;
        const autonomyEnrollment = store.getAutonomyEnrollment(identity.agentId);
        const treasury = controlProfile.role === 'institution'
            ? treasuries.get(`${controlProfile.subjectKind}:${controlProfile.subjectId}`) ?? null : null;
        const business = controlProfile.role === 'institution' && controlProfile.subjectKind === 'business'
            ? businesses.get(controlProfile.subjectId) ?? null : null;
        const playerActionRequests = store.listPlayerActionRequests(identity.agentId);
        const goalProposals = store.listGoalProposals(identity.agentId);
        const incomingPlayerActions = playerActionRequests
            .filter(item => item.assigneeAgentId === identity.agentId);
        const outgoingPlayerActions = playerActionRequests
            .filter(item => item.requesterAgentId === identity.agentId);
        const bot = controlProfile.avatarPlayerUsername
            ? assetSources.bots?.find(entry => entry.username === controlProfile.avatarPlayerUsername) : undefined;
        const gateway = controlProfile.avatarPlayerUsername
            ? [...(assetSources.gatewayBots?.entries() ?? [])].find(([username]) =>
                username.toLowerCase() === controlProfile.avatarPlayerUsername)?.[1] ?? null : null;
        const liveCoins = gateway?.state ? [...gateway.state.inventory,
            ...(gateway.bankKnown ? gateway.state.bank.items : [])].filter(item => item.id === 995)
            .reduce((total, item) => total + item.count, 0) : null;
        const assets = resolveAgentAssets(actorLinks, relationships.map(entry => entry.relationship),
            relationships.flatMap(entry => entry.commitments), {
                observedAt: assetSources.observedAt,
                money: bot || liveCoins !== null ? [{ actor: { kind: 'player' as const,
                    id: bot?.username ?? controlProfile.avatarPlayerUsername! }, balanceGp: bot?.coins ?? liveCoins!,
                    observedAt: bot?.lastActivityAt ?? bot?.saveSavedAt ?? (gateway
                        ? new Date(gateway.lastStateReceivedAt).toISOString() : assetSources.observedAt ?? new Date().toISOString()),
                    source: gateway?.status === 'active' || bot?.status === 'active' || bot?.status === 'stale' ? 'live' : 'save',
                    freshness: gateway?.status === 'active' || bot?.status === 'active' ? 'fresh' : 'stale' }]
                    : treasury ? [{ actor: { kind: treasury.kind, id: treasury.id }, balanceGp: treasury.balanceGp,
                        observedAt: treasury.updatedAt, source: 'treasury' as const, freshness: 'fresh' as const }] : [],
                properties: (assetSources.properties ?? []).filter(property => property.state.owner).map(property => ({
                    propertyId: property.propertyId, displayName: property.displayName, type: property.type,
                    region: property.location.region, acquiredAt: property.state.acquiredAt,
                    stateVersion: property.state.version, owner: property.state.owner!
                })),
                unavailableSources: [...(assetSources.unavailableSources ?? []), ...(bot || liveCoins !== null || treasury ? [] : ['money'])]
            });
        const relevantOffers = offers.filter(item => item.creatorAgentId === identity.agentId
            || item.counterpartyAgentId === identity.agentId);
        const relevantContracts = contracts.filter(item => item.partyAAgentId === identity.agentId
            || item.partyBAgentId === identity.agentId);
        let governance = null;
        const unavailable = [...(assetSources.unavailableSources ?? []), ...assets.unavailableSources,
            ...(snapshot.characterLifecycle?.status === 'deceased' && (!populationEstate || populationEstate.status !== 'custody-ready')
                ? ['population-estate'] : []),
            ...(snapshot.characterLifecycle?.status === 'deceased' || snapshot.populationMember?.status === 'reset'
                ? ['character-lifecycle-closed'] : []),
            ...(snapshot.populationMember && deathUnavailable ? ['population-death-authority'] : []),
            ...(snapshot.populationMember && !populationAge ? ['population-age'] : []),
            ...(snapshot.populationMember && !populationMortality ? ['population-mortality'] : []),
            ...(snapshot.populationMember && (!health?.sourceAvailable || health.pending
                || !health.byAgent.has(identity.agentId)) ? ['population-health'] : []),
            ...(crimeKnowledge.unavailable ? ['crime-case-knowledge'] : [])];
        if (controlProfile.role === 'institution' && controlProfile.subjectKind === 'faction') {
            const governancePath = governancePathFor(path);
            if (existsSync(governancePath)) {
                try { governance = inspectGovernanceForAgent(identity.agentId, path, governancePath); }
                catch { unavailable.push('governance-subject'); }
            } else unavailable.push('governance-subject');
        }
        const witnessDescriptions = crimeKnowledge.byViewer.get(identity.agentId) ?? [];
        const witnessedCrimeContext = witnessDescriptions.length ? `\nPersonally observed suspects (not legal findings):\n- ${
            witnessDescriptions.slice(0, 4).map(value => `${value.targetAgentId}: ${value.description}; case event ${
                value.sourceCaseEventIds[0]}`).join('\n- ')}` : '';
        const reformDescriptions=crimeKnowledge.reformsByViewer.get(identity.agentId)??[];
        const reformContext=reformDescriptions.length?`\nKnown reintegration efforts (audience-scoped, not legal erasure):\n- ${
            reformDescriptions.slice(0,4).map(value=>`${value.targetAgentId}: ${value.description}; source events ${
                value.sourceEventIds.join(',')}`).join('\n- ')}`:'';
        const healthContext = snapshot.populationMember ? populationHealth && populationHealth.sourceStatus === 'verified'
            ? `\nAuthoritative injury health: ${populationHealth.status}; burden ${populationHealth.injuryBurden}/10000; `
                + `rest required ${populationHealth.restRequired}; treatment required ${populationHealth.treatmentRequired}; `
                + `workload capacity ${populationHealth.workloadCapacityBasisPoints}/10000. Treatment needs verified clinical evidence.`
            : '\nInjury health is unobserved/unavailable; stored values are historical. Do not assume the character is healthy.' : '';
        const baseContext = `${buildDecisionContext(snapshot, { now: generatedAt, maxCharacters: 6000,
            economicObservation: readEconomicObservation(identity.agentId, { agentPath: path,
                contractsPath: assetSources.economicContractsPath, simulationClock: assetSources.simulationClock,
                gatewayBots: assetSources.gatewayBots, now: generatedAt }),
            controlProfile,
            playerActionRequests,
            episodicMemories: relevantEpisodes.map(result => result.episode),
            semanticMemories: relevantKnowledge.map(result => result.knowledge),
            socialMemories: relevantRelationships, assets })}${witnessedCrimeContext}${reformContext}${treasury
                ? `\nTreasury: ${treasury.balanceGp} gp balance; ${treasury.reservedGp} gp reserved; ${treasury.availableGp} gp available.` : ''}${healthContext}`;
        const decision = buildAdminDecisionContext({ baseContext, profile: controlProfile, bot: bot ?? null,
            gateway, business, governance, offers: relevantOffers, contracts: relevantContracts,
            latestRun: identity.playerUsername
                ? skillRuns.find(run => run.username === identity.playerUsername) ?? null : null,
            unavailableSources: unavailable, generatedAt });
        return {
            ...snapshot,
            populationAge,
            populationMortality,
            populationDeath,
            populationMemoryArchive,
            populationEstate,
            populationHealth,
            controlProfile,
            autonomyEnrollment,
            livelihoodProgress: isLivelihoodPolicy(autonomyEnrollment)
                ? store.listLivelihoodJournal(identity.agentId).slice(-10).reverse() : [],
            business,
            economicOffers: relevantOffers,
            economicContracts: relevantContracts,
            incomingPlayerActions,
            outgoingPlayerActions,
            goalProposals,
            skillRelationships,
            episodeCount: store.countEpisodes(identity.agentId),
            recentEpisodes,
            relevantEpisodes,
            retention: store.previewEpisodeRetention(identity.agentId, generatedAt),
            knowledgeCount: store.countKnowledge(identity.agentId),
            recentKnowledge,
            activeKnowledge,
            relevantKnowledge,
            relationships,
            relevantRelationships,
            assets,
            decisionContext: decision.trustedContext,
            decisionUntrustedText: decision.untrustedText,
            decisionContextBlockers: decision.blockers,
            decisionContextProvenance: decision.provenance,
            planner: planNextAction(snapshot, { availableSkills })
        };
    }), assetSources.simulationClock);
    const enrichedAgents = await Promise.all(agents.map(async agent => {
        const catalogSkills = await listAdminSkillsForAgent(agent.identity.agentId, {
            ...assetSources.skillCatalog, at: assetSources.skillCatalog?.at ?? generatedAt
        });
        const knownByReference = new Map(agent.knownSkills.map(item => [`${item.skill.id}@${item.skill.version}`, item]));
        const skillRelationships = catalogSkills.map(skill => {
            const knowledge = knownByReference.get(skill.reference) ?? null;
            return {
                reference: { id: skill.id, version: skill.version }, name: skill.name,
                exists: true as const, access: 'accessible' as const, policy: skill.policy,
                knowledge: knowledge?.status ?? 'unlearned' as const,
                executable: knowledge?.status === 'known' || knowledge?.status === 'preferred'
            };
        });
        const treasury = agent.controlProfile.role === 'institution'
            ? treasuries.get(`${agent.controlProfile.subjectKind}:${agent.controlProfile.subjectId}`) ?? null : null;
        const business = agent.controlProfile.role === 'institution' && agent.controlProfile.subjectKind === 'business'
            ? businesses.get(agent.controlProfile.subjectId) ?? null : null;
        return { ...agent, catalogSkills, skillRelationships, treasury, business,
            planner: planNextAction(agent, { availableSkills: catalogSkills.map(skill => ({
                id: skill.id, version: skill.version
            })) }) };
    }));
    const autonomyControl = useStore(path, store => store.getAutonomyControl());
    return { agents: enrichedAgents, skills, autonomyControl, generatedAt };
}

export function createAdminAgent(input: CreateAgentIdentity, path = agentStateDbPath) {
    const identity = useStore(path, store => store.createIdentity(input));
    const profile = useStore(path, store => store.getControlProfile(identity.agentId));
    if (profile?.role === 'institution') {
        useTreasury(path, store => store.ensure(profile.subjectKind as InstitutionKind, profile.subjectId));
    }
    return identity;
}

export function updateAdminAgent(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
    path = agentStateDbPath) {
    return useStore(path, store => store.updateIdentity(agentId, expectedRevision, patch));
}

export function updateAdminAgentControlProfile(agentId: string, expectedRevision: number,
    input: SetAgentControlProfile, path = agentStateDbPath) {
    const profile = useStore(path, store => store.setControlProfile(agentId, expectedRevision, input));
    if (profile.role === 'institution') {
        useTreasury(path, store => store.ensure(profile.subjectKind as InstitutionKind, profile.subjectId));
    }
    return profile;
}

export function createAdminPlayerActionRequest(requesterAgentId: string,
    input: CreateAgentPlayerActionRequest, path = agentStateDbPath) {
    if (input.requestId.startsWith('shift.')) throw new Error('Shift requests must be created from their Business work order');
    if ((input.rewardGp ?? 0) > 0 && (input.skill.id === 'procedure.food.cook-lobster'
        || (input.skill.id === 'trade.lumbridge.give-item' && String(input.parameters?.['item-name']).toLowerCase() === 'lobster')))
        throw new Error('Paid native food work requires an exact Business work order');
    const profile = useStore(path, store => store.getControlProfile(requesterAgentId));
    if (!profile || profile.role !== 'institution') throw new Error('A megbízónak institution agentnek kell lennie.');
    if (profile.subjectKind === 'business') {
        validateBusinessPlayerActionForAgent(requesterAgentId, input, path);
    }
    if (profile.subjectKind === 'faction') {
        validateFactionPlayerActionForAgent(requesterAgentId, input, path);
    }
    const treasuryActorId = treasuryActorIdForAgent(requesterAgentId, profile, path);
    const held = input.rewardGp
        ? useTreasury(path, store => store.reserve(profile.subjectKind as InstitutionKind,
            treasuryActorId, input.requestId, input.rewardGp!)) : null;
    try {
        return useStore(path, store => store.createPlayerActionRequest(requesterAgentId, input));
    } catch (error) {
        if (held?.created) useTreasury(path, store => store.release(input.requestId));
        throw error;
    }
}

/** Resumable outbox: bind first, reserve once, then materialize the existing player-action queue. */
export function createAdminBusinessWorkRequest(workOrderId: string, requesterAgentId: string,
    parameters: NonNullable<CreateAgentPlayerActionRequest['parameters']>,
    target: { kind: 'cook'; kitchenRunId: string; batchId: string } | { kind: 'delivery'; recipient: string },
    path = agentStateDbPath, options: BusinessWorkRuntimeOptions = {}, now = new Date().toISOString()) {
    const order = useBusinessWork(path, options, work => work.get(workOrderId));
    if (!order) throw new Error('Business work order does not exist');
    if (order.status === 'cancelled') throw new Error('Business work order is cancelled');
    const existing = useBusinessWork(path, options, work => work.binding(workOrderId));
    if (!existing) useBusinessWork(path, options, work => work.assertAuthorized(workOrderId));
    const authority = validateBusinessPlayerActionForAgent(requesterAgentId,
        { assigneeAgentId: order.workerAgentId, skill: order.skill, rewardGp: order.wageGp }, path);
    if (authority.employment.employmentId !== order.employmentId || authority.business.businessId !== order.businessId)
        throw new Error('Work order Business/employment differs');
    const username = useStore(path, store => {
        const identity = store.getIdentity(order.workerAgentId), profile = store.getControlProfile(order.workerAgentId);
        if (!identity?.playerUsername || identity.playerUsername !== profile?.avatarPlayerUsername || profile.role !== 'player')
            throw new Error('Work order requires its exact player-avatar');
        return identity.playerUsername;
    });
    let native: NativeWorkTarget;
    if (target.kind === 'cook') {
        if (order.roleDefinitionId !== 'business.cook.v1' || order.skill.id !== 'procedure.food.cook-lobster'
            || parameters['kitchen-run'] !== target.kitchenRunId || parameters['batch-id'] !== target.batchId)
            throw new Error('Cooking work requires exact role, skill and native parameters');
        native = target;
    } else if (target.kind === 'delivery') {
        const recipient = target.recipient.toLowerCase();
        if (!/^[a-z0-9]{1,12}$/.test(recipient) || recipient === username || order.roleDefinitionId !== 'business.delivery.v1'
            || order.skill.id !== 'trade.lumbridge.give-item' || parameters.recipient !== recipient
            || parameters['item-name'] !== 'Lobster' || parameters.amount !== 1)
            throw new Error('Delivery work requires exact role, recipient and one cooked lobster');
        native = { kind: 'delivery', recipient, itemId: 379, quantity: 1,
            ...(existing?.target.kind === 'delivery' ? existing.target : workTradeCursor(path, options)) };
    } else throw new Error('Native work target is invalid');
    const request = validateCreatePlayerActionRequest({ requestId: `shift.${workDigest(workOrderId).slice(0, 48)}`,
        assigneeAgentId: order.workerAgentId, skill: order.skill, parameters, rewardGp: order.wageGp,
        objective: `Complete Business shift ${workOrderId}.` });
    const candidate = { schemaVersion: 1 as const, workOrderId, requesterAgentId, username, request, target: native,
        settlementId: workUuid(`business-shift:${workOrderId}`), runId: null };
    if (!existing) assertCookTarget(path, options, candidate);
    const binding = useBusinessWork(path, options, work => work.bindRequest(candidate, now));
    const current = useStore(path, store => store.getPlayerActionRequest(binding.request.requestId));
    if (current) { assertWorkRequest(binding, current); return current; }
    if (now > order.scheduledEnd) throw new Error('Business work order shift has expired');
    const held = useTreasury(path, store => store.reserve('business', order.businessId, binding.request.requestId, order.wageGp, now));
    if (held.reservation.status !== 'reserved' || held.reservation.settlementId)
        throw new Error('Business work reservation requires reconciliation before request creation');
    // A crash here retains the reservation; this exact binding is the recovery outbox.
    return useStore(path, store => store.createPlayerActionRequest(requesterAgentId, binding.request, now));
}

function boundRequest(requestId: string, path: string, options: BusinessWorkRuntimeOptions) {
    // Legacy queues need no Business schema side effects when their database is absent.
    if (!existsSync(businessManagerPathFor(path))) return null;
    return useBusinessWork(path, options, work => work.bindings().find(b => b.request.requestId === requestId) ?? null);
}

export function updateAdminPlayerActionRequest(requestId: string, actorAgentId: string,
    expectedRevision: number, status: AgentPlayerActionManualStatus,
    responseNote: string, path = agentStateDbPath) {
    const binding = boundRequest(requestId, path, {});
    const request = useStore(path, store => store.setPlayerActionRequestStatus(requestId, actorAgentId,
        expectedRevision, status, responseNote));
    if (binding && (status === 'rejected' || status === 'cancelled'))
        useBusinessWork(path, {}, work => work.cancelBoundRequest(binding.workOrderId));
    if (request.rewardGp > 0 && (status === 'rejected' || status === 'cancelled')) {
        useTreasury(path, store => store.release(request.requestId));
    }
    return request;
}

export function approveAdminPlayerActionRequest(requestId: string, actorAgentId: string,
    expectedRevision: number, approvalId: string, expiresAt: string, path = agentStateDbPath) {
    return useStore(path, store => store.approvePlayerActionRequest(requestId, actorAgentId,
        expectedRevision, approvalId, expiresAt));
}

export function startAdminPlayerActionRequest(requestId: string, actorAgentId: string,
    expectedRevision: number, approvalId: string, runId: string, path = agentStateDbPath,
    options: BusinessWorkRuntimeOptions = {}, now = new Date().toISOString()) {
    const binding = boundRequest(requestId, path, options);
    if (binding) {
        const request = useStore(path, store => store.getPlayerActionRequest(requestId)!);
        assertWorkRequest(binding, request);
        if (request.status !== 'approved' || request.revision !== expectedRevision || request.assigneeAgentId !== actorAgentId
            || request.approvalId !== approvalId || !request.approvalExpiresAt || now >= request.approvalExpiresAt)
            throw new Error('Bound work approval is invalid or expired');
        validateBusinessPlayerActionForAgent(binding.requesterAgentId, request, path);
        useBusinessWork(path, options, work => work.bindRun(binding.workOrderId, runId, now));
    }
    return useStore(path, store => store.startApprovedPlayerAction(requestId, actorAgentId,
        expectedRevision, approvalId, runId, now));
}

export interface DelegatedBusinessPlayerActionResult {
    request: AgentPlayerActionRequest;
    policyId: string;
    employmentId: string;
    approvalId: string;
}

/**
 * Resumable accept/approve/start transition backed by a currently approved Business policy and employment.
 * The derived approval can be consumed by exactly one run id.
 */
export function delegateBusinessPlayerAction(requestId: string, runId: string, path = agentStateDbPath,
    now = new Date().toISOString(), options: BusinessWorkRuntimeOptions = {}): DelegatedBusinessPlayerActionResult {
    const initial = useStore(path, store => store.getPlayerActionRequest(requestId));
    if (!initial) throw new Error('Delegated player-action work order does not exist');
    const recordedAuthority = /^Delegated by approved policy ([a-z0-9._-]+) and employment ([a-z0-9-]+)\.$/i
        .exec(initial.responseNote);
    if (initial.status === 'running') {
        if (initial.runId !== runId || !initial.approvalId?.startsWith('delegated-') || !recordedAuthority) {
            throw new Error('Delegated player-action authorization is invalid or already used');
        }
        return { request: initial, policyId: recordedAuthority[1]!.toLowerCase(),
            employmentId: recordedAuthority[2]!.toLowerCase(), approvalId: initial.approvalId };
    }
    const authority = validateBusinessPlayerActionForAgent(initial.requesterAgentId, initial, path);
    if (initial.status === 'accepted' && recordedAuthority
        && (recordedAuthority[1]!.toLowerCase() !== authority.policy.proposalId
            || recordedAuthority[2]!.toLowerCase() !== authority.employment.employmentId)) {
        throw new Error('Delegated player-action authority changed after acceptance');
    }
    const material = [initial.requestId, authority.policy.proposalId, authority.employment.employmentId,
        initial.skill.id, initial.skill.version, runId].join('|');
    const approvalId = `delegated-${new Bun.CryptoHasher('sha256').update(material).digest('hex').slice(0, 48)}`;
    let request = initial;
    if (request.status === 'pending') {
        request = updateAdminPlayerActionRequest(request.requestId, request.assigneeAgentId, request.revision,
            'accepted', `Delegated by approved policy ${authority.policy.proposalId} and employment ${authority.employment.employmentId}.`, path);
    }
    if (request.status === 'accepted') {
        const expiresAt = new Date(Date.parse(now) + 3_600_000).toISOString();
        request = approveAdminPlayerActionRequest(request.requestId, request.assigneeAgentId, request.revision,
            approvalId, expiresAt, path);
    }
    if (request.status === 'approved') {
        if (request.approvalId !== approvalId) {
            throw new Error('Player-action has a different approval and cannot use delegated authorization');
        }
        request = startAdminPlayerActionRequest(request.requestId, request.assigneeAgentId, request.revision,
            approvalId, runId, path, options, now);
    }
    if (request.status !== 'running' || request.runId !== runId) {
        throw new Error('Delegated player-action authorization is invalid or already used');
    }
    return { request, policyId: authority.policy.proposalId,
        employmentId: authority.employment.employmentId, approvalId };
}

export function finishAdminPlayerActionRun(runId: string, completed: boolean, responseNote: string,
    path = agentStateDbPath, settlementId: string | null = null, options: BusinessWorkRuntimeOptions = {},
    now = new Date().toISOString()) {
    const binding = existsSync(businessManagerPathFor(path))
        ? useBusinessWork(path, options, work => work.bindings().find(b => b.runId === runId) ?? null) : null;
    if (binding) {
        const request = useStore(path, store => store.getPlayerActionRequest(binding.request.requestId)!);
        assertWorkRequest(binding, request);
        if (request.status !== 'running') return request;
        try {
            const order = useBusinessWork(path, options, work => work.get(binding.workOrderId)!);
            if (order.wageStatus === 'unearned') {
                const evidence = nativeWorkCompletion(path, binding, request, options);
                useBusinessWork(path, options, work => work.completeBound(order.workOrderId, evidence, () => true));
            }
            return useStore(path, store => store.finishPlayerActionRun(runId, true, 'Native Business shift completed; wage earned.',
                now, binding.settlementId));
        } catch (error) {
            const order = useBusinessWork(path, options, work => work.get(binding.workOrderId)!);
            if (order.wageStatus !== 'unearned') throw error;
            if (now > order.scheduledEnd) {
                useBusinessWork(path, options, work => work.expire(order.workOrderId, now));
                const failed = useStore(path, store => store.finishPlayerActionRun(runId, false,
                    `Shift expired without verified native completion: ${String(error)}`, now));
                useTreasury(path, store => store.release(binding.request.requestId)); return failed;
            }
            return useStore(path, store => store.notePlayerActionRunReconciliation(request.requestId,
                `Native work reconciliation pending: ${String(error)}`, now));
        }
    }
    const request = useStore(path, store => store.finishPlayerActionRun(runId, completed, responseNote,
        now, settlementId));
    if (request?.status === 'failed' && request.rewardGp > 0) {
        useTreasury(path, store => store.release(request.requestId));
    }
    return request;
}

export async function reconcileAdminPlayerActionRun(runId: string, fallbackCompleted: boolean,
    fallbackNote: string, path = agentStateDbPath, runRoot?: string,
    rewarder: typeof requestEnginePlayerReward = requestEnginePlayerReward, options: BusinessWorkRuntimeOptions = {}) {
    const run = await readSkillRun(runId, runRoot);
    const completed = run ? run.status === 'completed' : fallbackCompleted;
    const note = run
        ? `${run.skill.id}@${run.skill.version}: ${run.status}. ${run.message || run.reason || `Skill run ${run.status}.`}`
        : fallbackNote;
    const request = finishAdminPlayerActionRun(runId, completed, note, path,
        completed ? crypto.randomUUID() : null, { ...options, ...(runRoot ? { runRoot } : {}) });
    return request?.status === 'settling'
        ? settleAdminPlayerActionReward(request.settlementId!, path, rewarder, options) : request;
}

export async function settleAdminPlayerActionReward(settlementId: string, path = agentStateDbPath,
    rewarder: typeof requestEnginePlayerReward = requestEnginePlayerReward, options: BusinessWorkRuntimeOptions = {}) {
    const state = useStore(path, store => {
        const request = store.getPlayerActionRequestBySettlementId(settlementId);
        if (!request || !['settling', 'completed'].includes(request.status)) throw new Error('Nincs függőben lévő player-action elszámolás.');
        const identity = store.getIdentity(request.assigneeAgentId);
        const profile = store.getControlProfile(request.assigneeAgentId);
        const requester = store.getControlProfile(request.requesterAgentId);
        if (!identity || !profile || profile.role !== 'player' || !profile.avatarPlayerUsername
            || identity.playerUsername !== profile.avatarPlayerUsername) {
            throw new Error('A jutalom címzettjének exact player-avatar kötése megszűnt.');
        }
        if (!requester || requester.role !== 'institution') {
            throw new Error('A jutalom forrásintézménye megszűnt.');
        }
        return { request, username: profile.avatarPlayerUsername, requester };
    });
    const binding = boundRequest(state.request.requestId, path, options);
    let alreadyPaid = false;
    if (binding) {
        assertWorkRequest(binding, state.request);
        const order = useBusinessWork(path, options, work => work.get(binding.workOrderId)!);
        if (order.wageStatus === 'unearned' || order.status !== 'completed') throw new Error('Native shift wage has not been earned');
        if (state.requester.subjectKind !== 'business' || state.requester.subjectId !== order.businessId)
            throw new Error('Native wage Business subject binding differs');
        alreadyPaid = order.wageStatus === 'paid';
        if (state.username !== binding.username) throw new Error('Native wage avatar binding differs');
    } else if (state.request.status !== 'settling') return state.request;
    try {
        const treasuryActorId = treasuryActorIdForAgent(state.request.requesterAgentId, state.requester, path);
        const reservation = useTreasury(path, store => {
            if (!store.getReservation(state.request.requestId)) {
                store.reserve(state.requester.subjectKind as InstitutionKind,
                    treasuryActorId, state.request.requestId, state.request.rewardGp);
            }
            return store.bindSettlement(state.request.requestId, settlementId);
        });
        if (reservation.kind !== state.requester.subjectKind || reservation.actorId !== treasuryActorId
            || reservation.amountGp !== state.request.rewardGp) throw new Error('Wage treasury reservation source differs');
        const integrityPayment={settlementId,username:state.username,amountGp:state.request.rewardGp,
            reservationId:state.request.requestId,treasuryPath:institutionTreasuryPathFor(path)};
        bindSocietyInternalPayment(integrityPayment,'reserve');
        let nativeReceipt = binding ? nativeWorkReward(path, binding, options) : null;
        if (binding && !nativeReceipt && (alreadyPaid || reservation.status === 'committed'))
            throw new Error('Previously paid native wage receipt is missing; reconciliation required');
        const receipt = nativeReceipt ? null : await rewarder(state.username, state.request.rewardGp, settlementId);
        if (binding) {
            nativeReceipt = nativeWorkReward(path, binding, options);
            if (!nativeReceipt) throw new Error('Native engine wage receipt is missing; reservation retained');
        }
        useTreasury(path, store => store.commit(state.request.requestId, settlementId));
        bindSocietyInternalPayment(integrityPayment,'commit');
        if (binding) useBusinessWork(path, options, work => work.settleBoundWage(binding.workOrderId, settlementId, () => !!nativeReceipt));
        const reward = nativeReceipt ?? receipt?.reward;
        const balance = reward ? ` (${reward.coinsBefore} → ${reward.coinsAfter} gp)` : '';
        return useStore(path, store => store.completePlayerActionSettlement(settlementId,
            `Jutalom kifizetve: ${state.request.rewardGp} gp${balance}.`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useStore(path, store => store.notePlayerActionSettlementFailure(settlementId,
            `Jutalom függőben: ${message}`));
        throw error;
    }
}

export interface PlayerActionSettlementRecoveryResult {
    attemptedSettlementIds: string[];
    completedSettlementIds: string[];
    errors: Array<{ settlementId: string; message: string }>;
}

/** Bounded restart/periodic recovery; the persisted settlement id is always reused. */
export async function recoverAdminPlayerActionSettlements(path = agentStateDbPath,
    rewarder: typeof requestEnginePlayerReward = requestEnginePlayerReward, options: BusinessWorkRuntimeOptions = {}):
    Promise<PlayerActionSettlementRecoveryResult> {
    const bindings = existsSync(businessManagerPathFor(path)) ? useBusinessWork(path, options, work =>
        useStore(path, agents => useTreasury(path, treasury => work.bindings().filter(binding => businessWorkNeedsRecovery(
            work.get(binding.workOrderId)!, agents.getPlayerActionRequest(binding.request.requestId),
            treasury.getReservation(binding.request.requestId)?.status === 'reserved', binding.runId, new Date().toISOString())).slice(0, 100)))) : [];
    const bindingErrors: PlayerActionSettlementRecoveryResult['errors'] = [];
    for (const binding of bindings.slice(0, 100)) {
        try {
            let request = useStore(path, store => store.getPlayerActionRequest(binding.request.requestId));
            const order = useBusinessWork(path, options, work => work.get(binding.workOrderId)!);
            const now = new Date().toISOString();
            if (request && ['failed', 'rejected', 'cancelled'].includes(request.status)) {
                if (order.status !== 'cancelled') {
                    if (!binding.runId) useBusinessWork(path, options, work => work.cancelBoundRequest(order.workOrderId, now));
                    else if (now > order.scheduledEnd) useBusinessWork(path, options, work => work.expire(order.workOrderId, now));
                    else throw new Error('Failed native work requires reconciliation before cancelling its running shift');
                }
                useTreasury(path, store => store.release(binding.request.requestId)); continue;
            }
            if (now > order.scheduledEnd && order.wageStatus === 'unearned' && (!request || !request.runId)) {
                if (order.status !== 'cancelled') useBusinessWork(path, options, work => work.expire(order.workOrderId, now));
                if (request && ['pending', 'accepted', 'approved'].includes(request.status))
                    useStore(path, store => store.failUnstartedPlayerAction(request!.requestId, 'Business shift expired before dispatch.', now));
                useTreasury(path, store => store.release(binding.request.requestId)); continue;
            }
            if (!request) request = createAdminBusinessWorkRequest(binding.workOrderId, binding.requesterAgentId,
                binding.request.parameters, binding.target, path, options);
            assertWorkRequest(binding, request);
            if (binding.runId && request.status === 'approved' && request.approvalId) request = startAdminPlayerActionRequest(request.requestId,
                request.assigneeAgentId, request.revision, request.approvalId, binding.runId, path, options);
            if (binding.runId && request.status === 'running') finishAdminPlayerActionRun(binding.runId, false,
                'Business shift restart reconciliation.', path, null, options);
        } catch (error) { bindingErrors.push({ settlementId: binding.settlementId, message: String(error).slice(0, 500) }); }
    }
    const settlementIds = useStore(path, store => store.listIdentities()
        .flatMap(identity => store.listPlayerActionRequests(identity.agentId, 'outgoing'))
        .filter(request => request.status === 'settling' && request.settlementId)
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
            || left.requestId.localeCompare(right.requestId))
        .slice(0, 100).map(request => request.settlementId!));
    // Crash after request completion but before the WorkStore paid projection is repaired forward.
    for (const binding of bindings.slice(0, 100)) {
        const order = useBusinessWork(path, options, work => work.get(binding.workOrderId)!);
        const request = useStore(path, store => store.getPlayerActionRequest(binding.request.requestId));
        if (order.wageStatus === 'earned' && request?.status === 'completed' && !settlementIds.includes(binding.settlementId))
            settlementIds.push(binding.settlementId);
    }
    const result: PlayerActionSettlementRecoveryResult = {
        attemptedSettlementIds: [], completedSettlementIds: [], errors: bindingErrors
    };
    for (const settlementId of settlementIds) {
        result.attemptedSettlementIds.push(settlementId);
        try {
            await settleAdminPlayerActionReward(settlementId, path, rewarder, options);
            result.completedSettlementIds.push(settlementId);
        } catch (error) {
            result.errors.push({ settlementId,
                message: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
        }
    }
    return result;
}

export function updateAdminInstitutionTreasury(agentId: string, expectedRevision: number,
    balanceGp: number, path = agentStateDbPath) {
    const profile = useStore(path, store => store.getControlProfile(agentId));
    if (!profile || profile.role !== 'institution') throw new Error('Csak institution agentnek lehet treasury-je.');
    return useTreasury(path, store => store.setBalance(profile.subjectKind as InstitutionKind,
        treasuryActorIdForAgent(agentId, profile, path), expectedRevision, balanceGp));
}

export function createAdminAgentGoal(agentId: string, input: CreateAgentGoal, path = agentStateDbPath,
    simulationClock?: AgentStateSimulationClock) {
    return useStore(path, store => store.createGoal(agentId, input), simulationClock);
}

export function createAdminGoalProposal(agentId: string,
    input: Parameters<AgentStateStore['createGoalProposal']>[1], path = agentStateDbPath) {
    return useStore(path, store => store.createGoalProposal(agentId, input));
}

export function approveAdminGoalProposal(proposalId: string, expectedRevision: number,
    approvalId: string, expiresAt: string, path = agentStateDbPath,
    simulationClock?: AgentStateSimulationClock) {
    return useStore(path, store => store.approveGoalProposal(proposalId, expectedRevision, approvalId, expiresAt),
        simulationClock);
}

export function startAdminGoalProposal(proposalId: string, expectedRevision: number,
    approvalId: string, skillRunId: string, path = agentStateDbPath) {
    return useStore(path, store => store.startApprovedGoalProposal(proposalId, expectedRevision, approvalId, skillRunId));
}

export function failAdminGoalProposalRun(skillRunId: string, responseNote: string, path = agentStateDbPath) {
    return useStore(path, store => store.finishGoalProposalRun(skillRunId, false, responseNote));
}

export function reconcileAdminGoalProposalRun(skillRunId: string, completed: boolean,
    responseNote: string, path = agentStateDbPath) {
    return useStore(path, store => store.finishGoalProposalRun(skillRunId, completed, responseNote));
}

export function updateAdminAgentGoalStatus(agentId: string, goalId: string, expectedRevision: number,
    status: GoalStatus, path = agentStateDbPath, simulationClock?: AgentStateSimulationClock) {
    return useStore(path, store => {
        const goal = store.getGoal(goalId);
        if (!goal || goal.agentId !== agentId.toLowerCase()) throw new Error('A cél nem ehhez az agenthez tartozik.');
        return store.setGoalStatus(goalId, expectedRevision, status);
    }, simulationClock);
}

export function updateAdminAgentSkill(agentId: string, skill: AgentSkillReference,
    status: AgentSkillKnowledgeStatus, expectedRevision: number | null, path = agentStateDbPath) {
    return useStore(path, store => store.setSkillKnowledge(agentId, skill, status, expectedRevision));
}

export function createAdminAgentEpisode(agentId: string, input: CreateAgentEpisode, path = agentStateDbPath) {
    return useStore(path, store => store.createEpisode(agentId, input));
}

export function pruneAdminAgentEpisodes(agentId: string, path = agentStateDbPath, asOf = new Date().toISOString()) {
    return useStore(path, store => store.pruneExpiredEpisodes(agentId, asOf));
}

export function createAdminAgentKnowledge(agentId: string, input: CreateAgentKnowledge, path = agentStateDbPath) {
    return useStore(path, store => store.createKnowledge(agentId, input));
}

export function updateAdminAgentRelationship(agentId: string, expectedRevision: number | null,
    input: SetAgentRelationship, path = agentStateDbPath) {
    return useStore(path, store => store.setRelationship(agentId, expectedRevision, input));
}

export function createAdminAgentCommitment(agentId: string, input: CreateAgentCommitment, path = agentStateDbPath) {
    return useStore(path, store => store.createCommitment(agentId, input));
}

export function updateAdminAgentCommitmentStatus(agentId: string, commitmentId: string, expectedRevision: number,
    status: AgentCommitmentStatus, path = agentStateDbPath) {
    return useStore(path, store => {
        const commitment = store.getCommitment(commitmentId);
        if (!commitment || commitment.agentId !== agentId.toLowerCase()) {
            throw new Error('A kötelezettség nem ehhez az agenthez tartozik.');
        }
        return store.setCommitmentStatus(commitmentId, expectedRevision, status);
    });
}
