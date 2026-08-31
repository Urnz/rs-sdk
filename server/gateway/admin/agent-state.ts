import { dirname, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { resolveAgentAssets } from '../../../agent-state/assets.js';
import { planNextAction } from '../../../agent-state/planner.js';
import { episodicQueryFromSnapshot, retrieveEpisodicMemory, retrieveSemanticMemory,
    retrieveSocialMemory, semanticQueryFromSnapshot, socialQueryFromSnapshot } from '../../../agent-state/retrieval.js';
import type { AgentCommitmentStatus, AgentPlayerActionManualStatus, AgentSkillKnowledgeStatus,
    AgentSkillReference, CreateAgentCommitment,
    CreateAgentEpisode, CreateAgentGoal, CreateAgentIdentity, CreateAgentKnowledge, GoalStatus,
    CreateAgentPlayerActionRequest, SetAgentControlProfile, SetAgentRelationship,
    UpdateAgentIdentity } from '../../../agent-state/types.js';
import { agentStateDbPath, institutionTreasuryDbPath } from './paths.js';
import { listAdminSkills, listAdminSkillsForAgent, type AdminAgentSkillCatalogOptions } from './skill-catalog.js';
import type { BotCatalogEntry } from './types.js';
import type { AdminPropertyView } from './properties.js';
import { readSkillRun } from './skill-history.js';
import { requestEnginePlayerReward } from './player-rewards.js';
import { InstitutionTreasuryStore, type InstitutionKind } from './institution-treasury.js';

function useStore<T>(path: string, callback: (store: AgentStateStore) => T): T {
    const store = new AgentStateStore(path);
    try { return callback(store); }
    finally { store.close(); }
}

export function institutionTreasuryPathFor(path = agentStateDbPath): string {
    return path === agentStateDbPath ? institutionTreasuryDbPath : join(dirname(path), 'institution-treasury.sqlite');
}

function useTreasury<T>(path: string, callback: (store: InstitutionTreasuryStore) => T): T {
    const store = new InstitutionTreasuryStore(institutionTreasuryPathFor(path));
    try { return callback(store); }
    finally { store.close(); }
}

export interface AdminAgentAssetSources {
    bots?: readonly BotCatalogEntry[];
    properties?: readonly AdminPropertyView[];
    unavailableSources?: readonly string[];
    observedAt?: string;
    skillCatalog?: AdminAgentSkillCatalogOptions;
}

export async function listAdminAgents(path = agentStateDbPath, assetSources: AdminAgentAssetSources = {}) {
    const skills = await listAdminSkills();
    const availableSkills = skills.map(skill => ({ id: skill.id, version: skill.version }));
    const generatedAt = new Date().toISOString();
    const treasuries = new Map(useTreasury(path, store => store.list())
        .map(item => [`${item.kind}:${item.id}`, item]));
    const agents = useStore(path, store => store.listIdentities().map(identity => {
        const snapshot = store.getSnapshot(identity.agentId)!;
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
        const treasury = controlProfile.role === 'institution'
            ? treasuries.get(`${controlProfile.subjectKind}:${controlProfile.subjectId}`) ?? null : null;
        const playerActionRequests = store.listPlayerActionRequests(identity.agentId);
        const goalProposals = store.listGoalProposals(identity.agentId);
        const incomingPlayerActions = playerActionRequests
            .filter(item => item.assigneeAgentId === identity.agentId);
        const outgoingPlayerActions = playerActionRequests
            .filter(item => item.requesterAgentId === identity.agentId);
        const bot = controlProfile.avatarPlayerUsername
            ? assetSources.bots?.find(entry => entry.username === controlProfile.avatarPlayerUsername) : undefined;
        const assets = resolveAgentAssets(actorLinks, relationships.map(entry => entry.relationship),
            relationships.flatMap(entry => entry.commitments), {
                observedAt: assetSources.observedAt,
                money: bot ? [{ actor: { kind: 'player' as const, id: bot.username }, balanceGp: bot.coins,
                    observedAt: bot.lastActivityAt ?? bot.saveSavedAt ?? assetSources.observedAt ?? new Date().toISOString(),
                    source: bot.status === 'active' || bot.status === 'stale' ? 'live' : 'save',
                    freshness: bot.status === 'active' ? 'fresh' : 'stale' }]
                    : treasury ? [{ actor: { kind: treasury.kind, id: treasury.id }, balanceGp: treasury.balanceGp,
                        observedAt: treasury.updatedAt, source: 'treasury' as const, freshness: 'fresh' as const }] : [],
                properties: (assetSources.properties ?? []).filter(property => property.state.owner).map(property => ({
                    propertyId: property.propertyId, displayName: property.displayName, type: property.type,
                    region: property.location.region, acquiredAt: property.state.acquiredAt,
                    stateVersion: property.state.version, owner: property.state.owner!
                })),
                unavailableSources: [...(assetSources.unavailableSources ?? []), ...(bot || treasury ? [] : ['money'])]
            });
        return {
            ...snapshot,
            controlProfile,
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
            decisionContext: `${buildDecisionContext(snapshot, { now: generatedAt, maxCharacters: 3800,
                controlProfile,
                playerActionRequests,
                episodicMemories: relevantEpisodes.map(result => result.episode),
                semanticMemories: relevantKnowledge.map(result => result.knowledge),
                socialMemories: relevantRelationships, assets })}${treasury
                ? `\nTreasury: ${treasury.balanceGp} gp balance; ${treasury.reservedGp} gp reserved; ${treasury.availableGp} gp available.` : ''}`,
            planner: planNextAction(snapshot, { availableSkills })
        };
    }));
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
        return { ...agent, catalogSkills, skillRelationships, treasury,
            planner: planNextAction(agent, { availableSkills: catalogSkills.map(skill => ({
                id: skill.id, version: skill.version
            })) }) };
    }));
    return { agents: enrichedAgents, skills, generatedAt };
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
    const profile = useStore(path, store => store.getControlProfile(requesterAgentId));
    if (!profile || profile.role !== 'institution') throw new Error('A megbízónak institution agentnek kell lennie.');
    const held = input.rewardGp
        ? useTreasury(path, store => store.reserve(profile.subjectKind as InstitutionKind,
            profile.subjectId, input.requestId, input.rewardGp!)) : null;
    try {
        return useStore(path, store => store.createPlayerActionRequest(requesterAgentId, input));
    } catch (error) {
        if (held?.created) useTreasury(path, store => store.release(input.requestId));
        throw error;
    }
}

export function updateAdminPlayerActionRequest(requestId: string, actorAgentId: string,
    expectedRevision: number, status: AgentPlayerActionManualStatus,
    responseNote: string, path = agentStateDbPath) {
    const request = useStore(path, store => store.setPlayerActionRequestStatus(requestId, actorAgentId,
        expectedRevision, status, responseNote));
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
    expectedRevision: number, approvalId: string, runId: string, path = agentStateDbPath) {
    return useStore(path, store => store.startApprovedPlayerAction(requestId, actorAgentId,
        expectedRevision, approvalId, runId));
}

export function finishAdminPlayerActionRun(runId: string, completed: boolean, responseNote: string,
    path = agentStateDbPath, settlementId: string | null = null) {
    const request = useStore(path, store => store.finishPlayerActionRun(runId, completed, responseNote,
        new Date().toISOString(), settlementId));
    if (request?.status === 'failed' && request.rewardGp > 0) {
        useTreasury(path, store => store.release(request.requestId));
    }
    return request;
}

export async function reconcileAdminPlayerActionRun(runId: string, fallbackCompleted: boolean,
    fallbackNote: string, path = agentStateDbPath, runRoot?: string,
    rewarder: typeof requestEnginePlayerReward = requestEnginePlayerReward) {
    const run = await readSkillRun(runId, runRoot);
    const completed = run ? run.status === 'completed' : fallbackCompleted;
    const note = run
        ? `${run.skill.id}@${run.skill.version}: ${run.status}. ${run.message || run.reason || `Skill run ${run.status}.`}`
        : fallbackNote;
    const request = finishAdminPlayerActionRun(runId, completed, note, path,
        completed ? crypto.randomUUID() : null);
    return request?.status === 'settling'
        ? settleAdminPlayerActionReward(request.settlementId!, path, rewarder) : request;
}

export async function settleAdminPlayerActionReward(settlementId: string, path = agentStateDbPath,
    rewarder: typeof requestEnginePlayerReward = requestEnginePlayerReward) {
    const state = useStore(path, store => {
        const request = store.getPlayerActionRequestBySettlementId(settlementId);
        if (!request || request.status !== 'settling') throw new Error('Nincs függőben lévő player-action elszámolás.');
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
    try {
        useTreasury(path, store => {
            if (!store.getReservation(state.request.requestId)) {
                store.reserve(state.requester.subjectKind as InstitutionKind, state.requester.subjectId,
                    state.request.requestId, state.request.rewardGp);
            }
            store.bindSettlement(state.request.requestId, settlementId);
        });
        const receipt = await rewarder(state.username, state.request.rewardGp, settlementId);
        useTreasury(path, store => store.commit(state.request.requestId, settlementId));
        const balance = receipt.reward ? ` (${receipt.reward.coinsBefore} → ${receipt.reward.coinsAfter} gp)` : '';
        return useStore(path, store => store.completePlayerActionSettlement(settlementId,
            `Jutalom kifizetve: ${state.request.rewardGp} gp${balance}.`));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useStore(path, store => store.notePlayerActionSettlementFailure(settlementId,
            `Jutalom függőben: ${message}`));
        throw error;
    }
}

export function updateAdminInstitutionTreasury(agentId: string, expectedRevision: number,
    balanceGp: number, path = agentStateDbPath) {
    const profile = useStore(path, store => store.getControlProfile(agentId));
    if (!profile || profile.role !== 'institution') throw new Error('Csak institution agentnek lehet treasury-je.');
    return useTreasury(path, store => store.setBalance(profile.subjectKind as InstitutionKind,
        profile.subjectId, expectedRevision, balanceGp));
}

export function createAdminAgentGoal(agentId: string, input: CreateAgentGoal, path = agentStateDbPath) {
    return useStore(path, store => store.createGoal(agentId, input));
}

export function createAdminGoalProposal(agentId: string,
    input: Parameters<AgentStateStore['createGoalProposal']>[1], path = agentStateDbPath) {
    return useStore(path, store => store.createGoalProposal(agentId, input));
}

export function approveAdminGoalProposal(proposalId: string, expectedRevision: number,
    approvalId: string, expiresAt: string, path = agentStateDbPath) {
    return useStore(path, store => store.approveGoalProposal(proposalId, expectedRevision, approvalId, expiresAt));
}

export function startAdminGoalProposal(proposalId: string, expectedRevision: number,
    approvalId: string, skillRunId: string, path = agentStateDbPath) {
    return useStore(path, store => store.startApprovedGoalProposal(proposalId, expectedRevision, approvalId, skillRunId));
}

export function failAdminGoalProposalRun(skillRunId: string, responseNote: string, path = agentStateDbPath) {
    return useStore(path, store => store.failGoalProposalRun(skillRunId, responseNote));
}

export function updateAdminAgentGoalStatus(agentId: string, goalId: string, expectedRevision: number,
    status: GoalStatus, path = agentStateDbPath) {
    return useStore(path, store => {
        const goal = store.getGoal(goalId);
        if (!goal || goal.agentId !== agentId.toLowerCase()) throw new Error('A cél nem ehhez az agenthez tartozik.');
        return store.setGoalStatus(goalId, expectedRevision, status);
    });
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
