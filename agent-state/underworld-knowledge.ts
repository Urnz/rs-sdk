import { AgentStateStore } from './store.js';
import { normalizeActorKey } from './validation.js';
import type { AgentEpisode, AgentKnowledge } from './types.js';

export type UnderworldKnowledgeBlocker = 'no-direct-episode-evidence' | 'underworld-claim-not-attested';

/** A contact visible to this observer, never a verified fence or executable trade target. */
export interface ObserverContactKnowledge {
    actorKey: string;
    relationshipRevision: number;
    familiarity: number;
    subjectiveTrust: number;
    directEpisodeIds: string[];
    semanticKnowledgeIds: string[];
    blockers: UnderworldKnowledgeBlocker[];
}

export interface ObserverUnderworldKnowledge {
    observerAgentId: string;
    asOf: string;
    contacts: ObserverContactKnowledge[];
    blocker: 'underworld-claim-not-attested';
}

function directActorEpisode(episode: AgentEpisode, observerAgentId: string, actorKey: string, asOfMs: number): boolean {
    if (episode.agentId !== observerAgentId || episode.trust !== 'trusted'
        || Date.parse(episode.occurredAt) > asOfMs
        || (episode.expiresAt !== null && Date.parse(episode.expiresAt) <= asOfMs)) return false;
    return episode.actors.some(actor => {
        try { return normalizeActorKey(actor) === actorKey; }
        catch { return false; }
    });
}

function currentKnowledge(knowledge: AgentKnowledge, observerAgentId: string, actorKey: string, asOfMs: number): boolean {
    if (knowledge.agentId !== observerAgentId || knowledge.status !== 'active'
        || Date.parse(knowledge.validFrom) > asOfMs
        || (knowledge.validUntil !== null && Date.parse(knowledge.validUntil) <= asOfMs)) return false;
    try { return normalizeActorKey(knowledge.subject) === actorKey; }
    catch { return false; }
}

/**
 * Read-only, observer-scoped contact projection. Free text, tags, predicate and
 * object are never interpreted as a criminal role. Even a trusted memory is not
 * an independently attested underworld claim.
 */
export function projectObserverUnderworldKnowledge(store: AgentStateStore, observerAgentId: string,
    asOf: string): ObserverUnderworldKnowledge {
    const asOfMs = Date.parse(asOf);
    if (!Number.isFinite(asOfMs) || new Date(asOfMs).toISOString() !== asOf) {
        throw new Error('asOf must be a canonical ISO timestamp');
    }
    const identity = store.getIdentity(observerAgentId);
    if (!identity) throw new Error('Observer agent does not exist');
    const observer = identity.agentId;
    const knowledge: AgentKnowledge[] = [];
    const total = store.countKnowledge(observer);
    for (let offset = 0; offset < total; offset += 500) {
        knowledge.push(...store.listKnowledge(observer, { limit: 500, offset }));
    }
    const contacts = store.listRelationships(observer).map(relationship => {
        const episodes = relationship.evidenceEpisodeIds
            .map(id => store.getEpisode(id))
            .filter((episode): episode is AgentEpisode => episode !== null
                && directActorEpisode(episode, observer, relationship.actorKey, asOfMs));
        const directEpisodeIds = [...new Set(episodes.map(episode => episode.episodeId))].sort();
        const directIds = new Set(directEpisodeIds);
        const semanticKnowledgeIds = knowledge
            .filter(item => currentKnowledge(item, observer, relationship.actorKey, asOfMs)
                && item.evidenceEpisodeIds.some(id => directIds.has(id)))
            .map(item => item.knowledgeId).sort();
        return {
            actorKey: relationship.actorKey,
            relationshipRevision: relationship.revision,
            familiarity: relationship.familiarity,
            subjectiveTrust: relationship.trust,
            directEpisodeIds,
            semanticKnowledgeIds,
            blockers: [...(directEpisodeIds.length ? [] : ['no-direct-episode-evidence'] as const),
                'underworld-claim-not-attested' as const]
        };
    }).sort((a, b) => a.actorKey.localeCompare(b.actorKey));
    return { observerAgentId: observer, asOf, contacts, blocker: 'underworld-claim-not-attested' };
}
