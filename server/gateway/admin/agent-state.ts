import { AgentStateStore } from '../../../agent-state/store.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { resolveAgentAssets } from '../../../agent-state/assets.js';
import { planNextAction } from '../../../agent-state/planner.js';
import { episodicQueryFromSnapshot, retrieveEpisodicMemory, retrieveSemanticMemory,
    retrieveSocialMemory, semanticQueryFromSnapshot, socialQueryFromSnapshot } from '../../../agent-state/retrieval.js';
import type { AgentCommitmentStatus, AgentPlayerActionStatus, AgentSkillKnowledgeStatus,
    AgentSkillReference, CreateAgentCommitment,
    CreateAgentEpisode, CreateAgentGoal, CreateAgentIdentity, CreateAgentKnowledge, GoalStatus,
    CreateAgentPlayerActionRequest, SetAgentControlProfile, SetAgentRelationship,
    UpdateAgentIdentity } from '../../../agent-state/types.js';
import { agentStateDbPath } from './paths.js';
import { listAdminSkills, listAdminSkillsForAgent, type AdminAgentSkillCatalogOptions } from './skill-catalog.js';
import type { BotCatalogEntry } from './types.js';
import type { AdminPropertyView } from './properties.js';

function useStore<T>(path: string, callback: (store: AgentStateStore) => T): T {
    const store = new AgentStateStore(path);
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
        const playerActionRequests = store.listPlayerActionRequests(identity.agentId);
        const incomingPlayerActions = playerActionRequests
            .filter(item => item.assigneeAgentId === identity.agentId);
        const outgoingPlayerActions = playerActionRequests
            .filter(item => item.requesterAgentId === identity.agentId);
        const bot = controlProfile.avatarPlayerUsername
            ? assetSources.bots?.find(entry => entry.username === controlProfile.avatarPlayerUsername) : undefined;
        const assets = resolveAgentAssets(actorLinks, relationships.map(entry => entry.relationship),
            relationships.flatMap(entry => entry.commitments), {
                observedAt: assetSources.observedAt,
                money: bot ? [{ actor: { kind: 'player', id: bot.username }, balanceGp: bot.coins,
                    observedAt: bot.lastActivityAt ?? bot.saveSavedAt ?? assetSources.observedAt ?? new Date().toISOString(),
                    source: bot.status === 'active' || bot.status === 'stale' ? 'live' : 'save',
                    freshness: bot.status === 'active' ? 'fresh' : 'stale' }] : [],
                properties: (assetSources.properties ?? []).filter(property => property.state.owner).map(property => ({
                    propertyId: property.propertyId, displayName: property.displayName, type: property.type,
                    region: property.location.region, acquiredAt: property.state.acquiredAt,
                    stateVersion: property.state.version, owner: property.state.owner!
                })),
                unavailableSources: [...(assetSources.unavailableSources ?? []), ...(bot ? [] : ['money'])]
            });
        return {
            ...snapshot,
            controlProfile,
            incomingPlayerActions,
            outgoingPlayerActions,
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
            decisionContext: buildDecisionContext(snapshot, { now: generatedAt, maxCharacters: 4000,
                controlProfile,
                playerActionRequests,
                episodicMemories: relevantEpisodes.map(result => result.episode),
                semanticMemories: relevantKnowledge.map(result => result.knowledge),
                socialMemories: relevantRelationships, assets }),
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
        return { ...agent, catalogSkills, skillRelationships,
            planner: planNextAction(agent, { availableSkills: catalogSkills.map(skill => ({
                id: skill.id, version: skill.version
            })) }) };
    }));
    return { agents: enrichedAgents, skills, generatedAt };
}

export function createAdminAgent(input: CreateAgentIdentity, path = agentStateDbPath) {
    return useStore(path, store => store.createIdentity(input));
}

export function updateAdminAgent(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
    path = agentStateDbPath) {
    return useStore(path, store => store.updateIdentity(agentId, expectedRevision, patch));
}

export function updateAdminAgentControlProfile(agentId: string, expectedRevision: number,
    input: SetAgentControlProfile, path = agentStateDbPath) {
    return useStore(path, store => store.setControlProfile(agentId, expectedRevision, input));
}

export function createAdminPlayerActionRequest(requesterAgentId: string,
    input: CreateAgentPlayerActionRequest, path = agentStateDbPath) {
    return useStore(path, store => store.createPlayerActionRequest(requesterAgentId, input));
}

export function updateAdminPlayerActionRequest(requestId: string, actorAgentId: string,
    expectedRevision: number, status: Exclude<AgentPlayerActionStatus, 'pending'>,
    responseNote: string, path = agentStateDbPath) {
    return useStore(path, store => store.setPlayerActionRequestStatus(requestId, actorAgentId,
        expectedRevision, status, responseNote));
}

export function createAdminAgentGoal(agentId: string, input: CreateAgentGoal, path = agentStateDbPath) {
    return useStore(path, store => store.createGoal(agentId, input));
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
