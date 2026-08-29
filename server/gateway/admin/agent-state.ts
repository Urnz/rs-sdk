import { AgentStateStore } from '../../../agent-state/store.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { resolveAgentAssets } from '../../../agent-state/assets.js';
import { planNextAction } from '../../../agent-state/planner.js';
import { episodicQueryFromSnapshot, retrieveEpisodicMemory, retrieveSemanticMemory,
    retrieveSocialMemory, semanticQueryFromSnapshot, socialQueryFromSnapshot } from '../../../agent-state/retrieval.js';
import type { AgentCommitmentStatus, AgentSkillKnowledgeStatus, AgentSkillReference, CreateAgentCommitment,
    CreateAgentEpisode, CreateAgentGoal, CreateAgentIdentity, CreateAgentKnowledge, GoalStatus,
    SetAgentRelationship, UpdateAgentIdentity } from '../../../agent-state/types.js';
import { agentStateDbPath } from './paths.js';
import { listAdminSkills } from './skill-catalog.js';
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
}

export async function listAdminAgents(path = agentStateDbPath, assetSources: AdminAgentAssetSources = {}) {
    const skills = await listAdminSkills();
    const availableSkills = skills.map(skill => ({ id: skill.id, version: skill.version }));
    const generatedAt = new Date().toISOString();
    const agents = useStore(path, store => store.listIdentities().map(identity => {
        const snapshot = store.getSnapshot(identity.agentId)!;
        const recentEpisodes = store.listEpisodes(identity.agentId, { limit: 30 });
        const relevantEpisodes = retrieveEpisodicMemory(store.listEpisodes(identity.agentId, { limit: 500 }),
            episodicQueryFromSnapshot(snapshot));
        const recentKnowledge = store.listKnowledge(identity.agentId, { limit: 30 });
        const activeKnowledge = store.listKnowledge(identity.agentId, { status: 'active', limit: 500 });
        const relevantKnowledge = retrieveSemanticMemory(store.listKnowledge(identity.agentId, { limit: 500 }),
            semanticQueryFromSnapshot(snapshot));
        const relationships = store.listRelationships(identity.agentId).map(relationship => ({
            relationship, commitments: store.listCommitments(identity.agentId, relationship.actorKey)
        }));
        const relevantRelationships = retrieveSocialMemory(relationships, socialQueryFromSnapshot(snapshot));
        const actorLinks = store.listEconomicActorLinks(identity.agentId);
        const bot = assetSources.bots?.find(entry => entry.username === identity.playerUsername);
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
            decisionContext: buildDecisionContext(snapshot, { maxCharacters: 4000,
                episodicMemories: relevantEpisodes.map(result => result.episode),
                semanticMemories: relevantKnowledge.map(result => result.knowledge),
                socialMemories: relevantRelationships, assets }),
            planner: planNextAction(snapshot, { availableSkills })
        };
    }));
    return { agents, skills, generatedAt };
}

export function createAdminAgent(input: CreateAgentIdentity, path = agentStateDbPath) {
    return useStore(path, store => store.createIdentity(input));
}

export function updateAdminAgent(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
    path = agentStateDbPath) {
    return useStore(path, store => store.updateIdentity(agentId, expectedRevision, patch));
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
