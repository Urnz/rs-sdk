import type { AgentCommitment, AgentEpisode, AgentKnowledge, AgentRelationship, AgentSnapshot } from './types.js';

export interface EpisodicRetrievalOptions {
    now?: string;
    goalIds?: readonly string[];
    actors?: readonly string[];
    tags?: readonly string[];
    query?: string;
    limit?: number;
    maxAgeMs?: number;
    minimumImportance?: number;
    includeUntrusted?: boolean;
}

export interface RetrievedAgentEpisode {
    episode: AgentEpisode;
    score: number;
    reasons: string[];
}

function normalized(values: readonly string[] = []): Set<string> {
    return new Set(values.map(value => value.trim().toLocaleLowerCase('en-US')).filter(Boolean));
}

function tokens(value = ''): string[] {
    return [...new Set(value.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}.-]+/u)
        .map(token => token.trim()).filter(token => token.length >= 3))].slice(0, 24);
}

function recencyScore(ageMs: number): number {
    const day = 24 * 60 * 60_000;
    if (ageMs <= day) return 30;
    if (ageMs <= 7 * day) return 24;
    if (ageMs <= 30 * day) return 16;
    if (ageMs <= 180 * day) return 8;
    return 0;
}

export function retrieveEpisodicMemory(episodes: readonly AgentEpisode[],
    options: EpisodicRetrievalOptions = {}): RetrievedAgentEpisode[] {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const limit = options.limit ?? 6;
    const maxAge = options.maxAgeMs ?? 365 * 24 * 60 * 60_000;
    const minimumImportance = options.minimumImportance ?? 0;
    if (Number.isNaN(now)) throw new Error('Episodic retrieval now must be an ISO timestamp');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Episodic retrieval limit must be from 1 to 20');
    if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 10 * 365 * 24 * 60 * 60_000) {
        throw new Error('Episodic retrieval maximum age must be between 0 and 10 years');
    }
    if (!Number.isInteger(minimumImportance) || minimumImportance < 0 || minimumImportance > 100) {
        throw new Error('Episodic retrieval minimum importance must be from 0 to 100');
    }
    const goalIds = normalized(options.goalIds);
    const actors = normalized(options.actors);
    const tags = normalized(options.tags);
    const queryTokens = tokens(options.query);
    return episodes.flatMap(episode => {
        const occurredAt = Date.parse(episode.occurredAt);
        const expiresAt = episode.expiresAt ? Date.parse(episode.expiresAt) : null;
        const age = now - occurredAt;
        if (Number.isNaN(occurredAt) || age < 0 || age > maxAge || (expiresAt !== null && expiresAt <= now)
            || episode.importance < minimumImportance || (!options.includeUntrusted && episode.trust === 'untrusted')) return [];
        const episodeGoals = normalized(episode.goalIds);
        const episodeActors = normalized(episode.actors);
        const episodeTags = normalized(episode.tags);
        const goalMatches = [...goalIds].filter(value => episodeGoals.has(value)).length;
        const actorMatches = [...actors].filter(value => episodeActors.has(value)).length;
        const tagMatches = [...tags].filter(value => episodeTags.has(value)).length;
        const haystack = `${episode.summary} ${episode.details} ${episode.tags.join(' ')}`.toLocaleLowerCase('en-US');
        const textMatches = queryTokens.filter(token => haystack.includes(token)).length;
        const reasons = [`importance:${episode.importance}`, `recency:${recencyScore(age)}`];
        if (goalMatches) reasons.push(`goal:${goalMatches}`);
        if (actorMatches) reasons.push(`actor:${actorMatches}`);
        if (tagMatches) reasons.push(`tag:${tagMatches}`);
        if (textMatches) reasons.push(`text:${textMatches}`);
        const score = Math.round(episode.importance * 0.6) + recencyScore(age)
            + Math.min(60, goalMatches * 40) + Math.min(30, actorMatches * 20)
            + Math.min(24, tagMatches * 12) + Math.min(24, textMatches * 4);
        return [{ episode, score, reasons }];
    }).sort((left, right) => right.score - left.score
        || right.episode.occurredAt.localeCompare(left.episode.occurredAt)
        || left.episode.episodeId.localeCompare(right.episode.episodeId)).slice(0, limit);
}

export function episodicQueryFromSnapshot(snapshot: AgentSnapshot): Omit<EpisodicRetrievalOptions, 'now'> {
    const activeGoals = snapshot.goals.filter(goal => goal.status === 'active');
    return {
        goalIds: activeGoals.map(goal => goal.goalId),
        query: [snapshot.workingMemory?.summary ?? '', ...activeGoals.map(goal => `${goal.title} ${goal.description}`)].join(' '),
        limit: 6
    };
}

export interface SemanticRetrievalOptions {
    now?: string;
    goalIds?: readonly string[];
    tags?: readonly string[];
    query?: string;
    limit?: number;
    minimumConfidence?: number;
    includeDisputed?: boolean;
}

export interface RetrievedAgentKnowledge {
    knowledge: AgentKnowledge;
    score: number;
    reasons: string[];
}

export function retrieveSemanticMemory(entries: readonly AgentKnowledge[],
    options: SemanticRetrievalOptions = {}): RetrievedAgentKnowledge[] {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const limit = options.limit ?? 6;
    const minimumConfidence = options.minimumConfidence ?? 25;
    if (Number.isNaN(now)) throw new Error('Semantic retrieval now must be an ISO timestamp');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Semantic retrieval limit must be from 1 to 20');
    if (!Number.isInteger(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 100) {
        throw new Error('Semantic retrieval minimum confidence must be from 0 to 100');
    }
    const goalIds = normalized(options.goalIds);
    const tags = normalized(options.tags);
    const queryTokens = tokens(options.query);
    return entries.flatMap(entry => {
        const validFrom = Date.parse(entry.validFrom);
        const validUntil = entry.validUntil ? Date.parse(entry.validUntil) : null;
        const updatedAt = Date.parse(entry.updatedAt);
        if (Number.isNaN(validFrom) || validFrom > now || (validUntil !== null && validUntil <= now)
            || entry.status === 'superseded' || (entry.status === 'disputed' && !options.includeDisputed)
            || entry.confidence < minimumConfidence) return [];
        const entryGoals = normalized(entry.goalIds);
        const entryTags = normalized(entry.tags);
        const goalMatches = [...goalIds].filter(value => entryGoals.has(value)).length;
        const tagMatches = [...tags].filter(value => entryTags.has(value)).length;
        const haystack = `${entry.subject} ${entry.predicate} ${entry.object} ${entry.summary} ${entry.tags.join(' ')}`
            .toLocaleLowerCase('en-US');
        const textMatches = queryTokens.filter(token => haystack.includes(token)).length;
        const freshness = Number.isNaN(updatedAt) ? 0 : recencyScore(Math.max(0, now - updatedAt));
        const reasons = [`confidence:${entry.confidence}`, `recency:${freshness}`];
        if (goalMatches) reasons.push(`goal:${goalMatches}`);
        if (tagMatches) reasons.push(`tag:${tagMatches}`);
        if (textMatches) reasons.push(`text:${textMatches}`);
        const score = Math.round(entry.confidence * 0.8) + freshness + Math.min(60, goalMatches * 40)
            + Math.min(24, tagMatches * 12) + Math.min(32, textMatches * 4);
        return [{ knowledge: entry, score, reasons }];
    }).sort((left, right) => right.score - left.score
        || right.knowledge.updatedAt.localeCompare(left.knowledge.updatedAt)
        || left.knowledge.knowledgeId.localeCompare(right.knowledge.knowledgeId)).slice(0, limit);
}

export function semanticQueryFromSnapshot(snapshot: AgentSnapshot): Omit<SemanticRetrievalOptions, 'now'> {
    const activeGoals = snapshot.goals.filter(goal => goal.status === 'active');
    return {
        goalIds: activeGoals.map(goal => goal.goalId),
        query: [snapshot.workingMemory?.summary ?? '', ...activeGoals.map(goal => `${goal.title} ${goal.description}`)].join(' '),
        limit: 6
    };
}

export interface SocialMemoryEntry {
    relationship: AgentRelationship;
    commitments: AgentCommitment[];
}

export interface SocialRetrievalOptions {
    now?: string;
    actors?: readonly string[];
    tags?: readonly string[];
    query?: string;
    goalQuery?: string;
    limit?: number;
}

export interface RetrievedSocialMemory extends SocialMemoryEntry {
    score: number;
    reasons: string[];
}

export function retrieveSocialMemory(entries: readonly SocialMemoryEntry[],
    options: SocialRetrievalOptions = {}): RetrievedSocialMemory[] {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const limit = options.limit ?? 6;
    if (Number.isNaN(now)) throw new Error('Social retrieval now must be an ISO timestamp');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Social retrieval limit must be from 1 to 20');
    const actors = normalized(options.actors);
    const tags = normalized(options.tags);
    const queryTokens = tokens(options.query);
    const goalTokens = tokens(options.goalQuery);
    return entries.map(entry => {
        const itemTags = normalized(entry.relationship.tags);
        const actorMatch = actors.has(entry.relationship.actorKey)
            || actors.has(entry.relationship.displayName.toLocaleLowerCase('en-US'));
        const tagMatches = [...tags].filter(value => itemTags.has(value)).length;
        const open = entry.commitments.filter(item => item.status === 'open');
        const haystack = `${entry.relationship.actorKey} ${entry.relationship.displayName} ${entry.relationship.notes} `
            + `${entry.relationship.tags.join(' ')} ${open.map(item => item.description).join(' ')}`;
        const normalizedHaystack = haystack.toLocaleLowerCase('en-US');
        const textMatches = queryTokens.filter(token => normalizedHaystack.includes(token)).length;
        const goalMatches = goalTokens.filter(token => normalizedHaystack.includes(token)).length;
        const debtRelevant = entry.relationship.agentOwesGp > 0 || entry.relationship.actorOwesGp > 0;
        const freshnessSource = entry.relationship.lastInteractionAt ?? entry.relationship.updatedAt;
        const freshnessAt = Date.parse(freshnessSource);
        const freshness = Number.isNaN(freshnessAt) ? 0 : recencyScore(Math.max(0, now - freshnessAt));
        const reasons = [`familiarity:${entry.relationship.familiarity}`, `recency:${freshness}`];
        if (actorMatch) reasons.push('actor:1');
        if (tagMatches) reasons.push(`tag:${tagMatches}`);
        if (textMatches) reasons.push(`text:${textMatches}`);
        if (goalMatches) reasons.push(`goal:${goalMatches}`);
        if (open.length) reasons.push(`open-commitments:${open.length}`);
        if (debtRelevant) reasons.push('debt:1');
        const score = Math.round(entry.relationship.familiarity * 0.5)
            + Math.round(Math.abs(entry.relationship.trust) * 0.25)
            + Math.round(Math.abs(entry.relationship.affinity) * 0.1)
            + freshness
            + (actorMatch ? 60 : 0) + Math.min(24, tagMatches * 12) + Math.min(32, textMatches * 4)
            + Math.min(48, goalMatches * 8)
            + Math.min(30, open.length * 15) + (debtRelevant ? 15 : 0);
        return { ...entry, score, reasons };
    }).sort((left, right) => right.score - left.score
        || right.relationship.updatedAt.localeCompare(left.relationship.updatedAt)
        || left.relationship.actorKey.localeCompare(right.relationship.actorKey)).slice(0, limit);
}

export function socialQueryFromSnapshot(snapshot: AgentSnapshot): SocialRetrievalOptions {
    const activeGoals = snapshot.goals.filter(goal => goal.status === 'active');
    return { query: snapshot.workingMemory?.summary ?? '',
        goalQuery: activeGoals.map(goal => `${goal.title} ${goal.description}`).join(' '), limit: 6 };
}
