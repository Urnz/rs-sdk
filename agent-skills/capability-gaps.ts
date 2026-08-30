import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SKILL_SCHEMA_VERSION, type SkillReference, type SkillSharingMode } from './types.js';

export const CAPABILITY_GAP_SCHEMA_VERSION = 1 as const;
export type CapabilityGapStatus = 'open' | 'assigned' | 'draft' | 'validating' | 'live-trial' | 'verified' | 'rejected';

export interface CapabilityGapRequester {
    agentId: string;
    goalId: string;
    anchorGoalId: string;
    firstRequestedAt: string;
    lastRequestedAt: string;
    requestCount: number;
    wakeClaimedAt: string | null;
}

export interface CapabilityGapWakeup {
    gapId: string;
    agentId: string;
    goalId: string;
    anchorGoalId: string;
    resolvedSkill: SkillReference;
}

export interface CapabilityGap {
    schemaVersion: typeof CAPABILITY_GAP_SCHEMA_VERSION;
    gapId: string;
    fingerprint: string;
    title: string;
    description: string;
    tags: string[];
    worldVersion: string;
    skillSchemaVersion: number;
    status: CapabilityGapStatus;
    requesters: CapabilityGapRequester[];
    assignedWorkerId: string | null;
    draftSkill: SkillReference | null;
    resolvedSkill: SkillReference | null;
    rejectionReason: string | null;
    builderAttempts: number;
    builderCostMicros: number;
    lastBuilderAttemptAt: string | null;
    lastBuilderError: string | null;
    builderAttemptId: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface ReportCapabilityGap {
    agentId: string;
    goalId: string;
    anchorGoalId?: string;
    title: string;
    description?: string;
    tags?: string[];
    worldVersion?: string;
}

export interface SkillBuilderClaimPolicy {
    maxAttemptsPerGap: number;
    maxCostMicrosPerGap: number;
    cooldownMs: number;
    leaseMs?: number;
}

interface CapabilityGapDocument {
    schemaVersion: typeof CAPABILITY_GAP_SCHEMA_VERSION;
    revision: number;
    updatedAt: string;
    gaps: CapabilityGap[];
}

export interface SkillResolutionCandidate extends SkillReference {
    name: string;
    description: string;
    tags: readonly string[];
    status?: 'draft' | 'verified' | 'deprecated';
    visibility?: 'shared' | 'private';
}

export interface SkillResolution {
    skill: SkillResolutionCandidate;
    source: 'known' | 'shared-library';
    knowledge: 'learned' | 'unlearned';
    requiresLearning: boolean;
    score: number;
    matchedTerms: string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const TAG_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ACTIVE_STATUSES: readonly CapabilityGapStatus[] = ['open', 'assigned', 'draft', 'validating', 'live-trial'];
const TRANSITIONS: Record<CapabilityGapStatus, readonly CapabilityGapStatus[]> = {
    open: ['assigned', 'rejected'],
    assigned: ['open', 'draft', 'rejected'],
    draft: ['validating', 'rejected'],
    validating: ['draft', 'live-trial', 'rejected'],
    'live-trial': ['draft', 'verified', 'rejected'],
    verified: [], rejected: []
};
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'then', 'this', 'that', 'egy', 'az',
    'hogy', 'kell', 'majd', 'itt', 'ott', 'agent', 'player', 'goal']);
const writeTails = new Map<string, Promise<unknown>>();

function boundedText(value: unknown, name: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
        throw new Error(`${name} must contain 1 to ${maximum} characters`);
    }
    return value.trim();
}

function normalizedId(value: unknown, name: string): string {
    const id = boundedText(value, name, 100).toLocaleLowerCase('en-US');
    if (!ID_PATTERN.test(id)) throw new Error(`${name} contains unsupported characters`);
    return id;
}

function normalizedTags(input: unknown): string[] {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 20) throw new Error('tags must be an array with at most 20 values');
    const tags = [...new Set(input.map((tag, index) => boundedText(tag, `tags[${index}]`, 64)
        .toLocaleLowerCase('en-US')))];
    if (tags.some(tag => !TAG_PATTERN.test(tag))) throw new Error('tags contain unsupported characters');
    return tags.sort();
}

function phrase(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function terms(value: string): string[] {
    return [...new Set(phrase(value).split(' ').map(term => term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term)
        .filter(term => term.length >= 3 && !STOP_WORDS.has(term)))].sort();
}

function fingerprint(input: Omit<ReportCapabilityGap, 'agentId' | 'goalId'>): string {
    const semantic = JSON.stringify({ title: phrase(input.title), description: phrase(input.description ?? ''),
        tags: normalizedTags(input.tags), worldVersion: input.worldVersion ?? 'local', skillSchemaVersion: SKILL_SCHEMA_VERSION });
    return createHash('sha256').update(semantic).digest('hex');
}

function emptyDocument(now: string): CapabilityGapDocument {
    return { schemaVersion: CAPABILITY_GAP_SCHEMA_VERSION, revision: 0, updatedAt: now, gaps: [] };
}

function validateDocument(input: unknown): CapabilityGapDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Capability gap document must be an object');
    const value = input as Partial<CapabilityGapDocument>;
    if (value.schemaVersion !== CAPABILITY_GAP_SCHEMA_VERSION || !Number.isInteger(value.revision)
        || typeof value.updatedAt !== 'string' || !Array.isArray(value.gaps)) {
        throw new Error('Capability gap document has an unsupported schema');
    }
    for (const gap of value.gaps) {
        if (!gap || gap.schemaVersion !== CAPABILITY_GAP_SCHEMA_VERSION || !ID_PATTERN.test(gap.gapId)
            || !/^[a-f0-9]{64}$/.test(gap.fingerprint) || !ACTIVE_STATUSES.concat(['verified', 'rejected']).includes(gap.status)
            || !Number.isInteger(gap.revision) || !Array.isArray(gap.requesters)) {
            throw new Error('Capability gap document contains an invalid gap');
        }
        for (const requester of gap.requesters) {
            if (!requester || !ID_PATTERN.test(requester.agentId) || !ID_PATTERN.test(requester.goalId)) {
                throw new Error('Capability gap document contains an invalid requester');
            }
            requester.anchorGoalId ??= requester.goalId;
            requester.wakeClaimedAt ??= null;
        }
        gap.builderAttempts ??= 0;
        gap.builderCostMicros ??= 0;
        gap.lastBuilderAttemptAt ??= null;
        gap.lastBuilderError ??= null;
        gap.builderAttemptId ??= null;
    }
    return value as CapabilityGapDocument;
}

export class CapabilityGapStore {
    private readonly path: string;

    constructor(path: string) { this.path = resolve(path); }

    async list(status?: CapabilityGapStatus): Promise<CapabilityGap[]> {
        const document = await this.read();
        return structuredClone(document.gaps.filter(gap => !status || gap.status === status)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.gapId.localeCompare(right.gapId)));
    }

    async findPending(agentId: string, anchorGoalId: string): Promise<CapabilityGap | null> {
        const normalizedAgentId = normalizedId(agentId, 'agentId');
        const normalizedAnchorGoalId = normalizedId(anchorGoalId, 'anchorGoalId');
        const document = await this.read();
        const gap = document.gaps.filter(entry => ACTIVE_STATUSES.includes(entry.status))
            .filter(entry => entry.requesters.some(requester => requester.agentId === normalizedAgentId
                && (requester.anchorGoalId ?? requester.goalId) === normalizedAnchorGoalId))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
                || left.gapId.localeCompare(right.gapId))[0];
        return gap ? structuredClone(gap) : null;
    }

    async report(input: ReportCapabilityGap, now = new Date().toISOString()): Promise<{
        gap: CapabilityGap;
        created: boolean;
        deduplicated: boolean;
    }> {
        return this.serialize(async () => {
            const value = {
                agentId: normalizedId(input.agentId, 'agentId'), goalId: normalizedId(input.goalId, 'goalId'),
                anchorGoalId: normalizedId(input.anchorGoalId ?? input.goalId, 'anchorGoalId'),
                title: boundedText(input.title, 'title', 200), description: input.description?.trim().slice(0, 2000) ?? '',
                tags: normalizedTags(input.tags), worldVersion: boundedText(input.worldVersion ?? 'local', 'worldVersion', 64)
            };
            const hash = fingerprint(value);
            const document = await this.read(now);
            let gap = document.gaps.find(entry => entry.fingerprint === hash);
            const created = !gap;
            if (!gap) {
                gap = { schemaVersion: CAPABILITY_GAP_SCHEMA_VERSION, gapId: `gap-${hash.slice(0, 20)}`,
                    fingerprint: hash, title: value.title, description: value.description, tags: value.tags,
                    worldVersion: value.worldVersion, skillSchemaVersion: SKILL_SCHEMA_VERSION, status: 'open',
                    requesters: [], assignedWorkerId: null, draftSkill: null, resolvedSkill: null,
                    rejectionReason: null, builderAttempts: 0, builderCostMicros: 0,
                    lastBuilderAttemptAt: null, lastBuilderError: null, builderAttemptId: null,
                    createdAt: now, updatedAt: now, revision: 1 };
                document.gaps.push(gap);
            }
            const requester = gap.requesters.find(entry => entry.agentId === value.agentId
                && entry.goalId === value.goalId && (entry.anchorGoalId ?? entry.goalId) === value.anchorGoalId);
            if (requester) {
                requester.lastRequestedAt = now;
                requester.requestCount++;
            } else {
                gap.requesters.push({ agentId: value.agentId, goalId: value.goalId, anchorGoalId: value.anchorGoalId,
                    firstRequestedAt: now, lastRequestedAt: now, requestCount: 1, wakeClaimedAt: null });
            }
            gap.updatedAt = now;
            if (!created) gap.revision++;
            document.revision++;
            document.updatedAt = now;
            await this.write(document);
            return { gap: structuredClone(gap), created, deduplicated: !created };
        });
    }

    async claimForBuilder(workerId: string, policy: SkillBuilderClaimPolicy,
        now = new Date().toISOString()): Promise<CapabilityGap | null> {
        const worker = normalizedId(workerId, 'workerId');
        if (!Number.isInteger(policy.maxAttemptsPerGap) || policy.maxAttemptsPerGap < 1
            || policy.maxAttemptsPerGap > 100) throw new Error('Builder max attempts must be from 1 to 100');
        if (!Number.isInteger(policy.maxCostMicrosPerGap) || policy.maxCostMicrosPerGap < 0
            || policy.maxCostMicrosPerGap > 100_000_000) throw new Error('Builder max cost is invalid');
        if (!Number.isInteger(policy.cooldownMs) || policy.cooldownMs < 0
            || policy.cooldownMs > 7 * 24 * 60 * 60_000) throw new Error('Builder cooldown is invalid');
        const leaseMs = policy.leaseMs ?? 10 * 60_000;
        if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 24 * 60 * 60_000) {
            throw new Error('Builder lease is invalid');
        }
        const current = Date.parse(now);
        if (Number.isNaN(current)) throw new Error('Builder claim time is invalid');
        return this.serialize(async () => {
            const document = await this.read(now);
            let recovered = false;
            for (const entry of document.gaps) {
                if (entry.status !== 'assigned' || !entry.builderAttemptId || !entry.lastBuilderAttemptAt
                    || current - Date.parse(entry.lastBuilderAttemptAt) < leaseMs) continue;
                entry.status = 'open';
                entry.assignedWorkerId = null;
                entry.builderAttemptId = null;
                entry.lastBuilderError = 'Builder lease expired before completion.';
                entry.updatedAt = now;
                entry.revision++;
                recovered = true;
            }
            const gap = document.gaps.filter(entry => entry.status === 'open'
                && entry.builderAttempts < policy.maxAttemptsPerGap
                && entry.builderCostMicros < policy.maxCostMicrosPerGap
                && (!entry.lastBuilderAttemptAt || current - Date.parse(entry.lastBuilderAttemptAt) >= policy.cooldownMs))
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
                    || left.gapId.localeCompare(right.gapId))[0];
            if (!gap) {
                if (recovered) {
                    document.updatedAt = now;
                    document.revision++;
                    await this.write(document);
                }
                return null;
            }
            gap.status = 'assigned';
            gap.assignedWorkerId = worker;
            gap.builderAttempts++;
            gap.builderAttemptId = randomUUID();
            gap.lastBuilderAttemptAt = now;
            gap.lastBuilderError = null;
            gap.updatedAt = now;
            gap.revision++;
            document.updatedAt = now;
            document.revision++;
            await this.write(document);
            return structuredClone(gap);
        });
    }

    async completeBuilderAttempt(gapId: string, attemptId: string, workerId: string,
        outcome: { costMicros: number; draftSkill?: SkillReference; error?: string; retryable?: boolean },
        now = new Date().toISOString()): Promise<CapabilityGap> {
        const worker = normalizedId(workerId, 'workerId');
        if (!Number.isInteger(outcome.costMicros) || outcome.costMicros < 0 || outcome.costMicros > 100_000_000) {
            throw new Error('Builder attempt cost is invalid');
        }
        return this.serialize(async () => {
            const document = await this.read(now);
            const gap = document.gaps.find(entry => entry.gapId === normalizedId(gapId, 'gapId'));
            if (!gap) throw new Error('Capability gap not found');
            if (gap.status !== 'assigned' || gap.assignedWorkerId !== worker || gap.builderAttemptId !== attemptId) {
                throw new Error('Capability gap is not assigned to this builder');
            }
            if (!!outcome.draftSkill === !!outcome.error) {
                throw new Error('Builder completion requires exactly one draft or error outcome');
            }
            gap.builderCostMicros += outcome.costMicros;
            gap.builderAttemptId = null;
            if (outcome.draftSkill) {
                gap.status = 'draft';
                gap.draftSkill = structuredClone(outcome.draftSkill);
                gap.lastBuilderError = null;
            } else {
                const message = boundedText(outcome.error, 'builder error', 1000);
                gap.lastBuilderError = message;
                gap.assignedWorkerId = null;
                if (outcome.retryable) gap.status = 'open';
                else { gap.status = 'rejected'; gap.rejectionReason = message; }
            }
            gap.updatedAt = now;
            gap.revision++;
            document.updatedAt = now;
            document.revision++;
            await this.write(document);
            return structuredClone(gap);
        });
    }

    async transition(gapId: string, expectedRevision: number, status: CapabilityGapStatus, patch: {
        assignedWorkerId?: string | null;
        draftSkill?: SkillReference | null;
        resolvedSkill?: SkillReference | null;
        rejectionReason?: string | null;
    } = {}, now = new Date().toISOString()): Promise<CapabilityGap> {
        return this.serialize(async () => {
            const document = await this.read(now);
            const gap = document.gaps.find(entry => entry.gapId === normalizedId(gapId, 'gapId'));
            if (!gap) throw new Error('Capability gap not found');
            if (gap.revision !== expectedRevision) throw new Error('Capability gap changed before update');
            if (!TRANSITIONS[gap.status].includes(status)) throw new Error(`Invalid capability gap transition: ${gap.status} -> ${status}`);
            if (status === 'assigned' && !patch.assignedWorkerId) throw new Error('Assigned gap requires a worker');
            if (status === 'draft' && !patch.draftSkill && !gap.draftSkill) throw new Error('Draft gap requires a skill reference');
            if (status === 'verified' && !patch.resolvedSkill) throw new Error('Verified gap requires a resolved skill');
            if (status === 'rejected' && !patch.rejectionReason?.trim()) throw new Error('Rejected gap requires a reason');
            gap.status = status;
            if (patch.assignedWorkerId !== undefined) gap.assignedWorkerId = patch.assignedWorkerId
                ? normalizedId(patch.assignedWorkerId, 'assignedWorkerId') : null;
            if (patch.draftSkill !== undefined) gap.draftSkill = patch.draftSkill;
            if (patch.resolvedSkill !== undefined) gap.resolvedSkill = patch.resolvedSkill;
            if (patch.rejectionReason !== undefined) gap.rejectionReason = patch.rejectionReason?.trim() || null;
            if (status === 'verified') for (const requester of gap.requesters) requester.wakeClaimedAt = null;
            gap.updatedAt = now;
            gap.revision++;
            document.revision++;
            document.updatedAt = now;
            await this.write(document);
            return structuredClone(gap);
        });
    }

    async claimVerifiedWakeups(limit = 100, now = new Date().toISOString()): Promise<CapabilityGapWakeup[]> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Wakeup limit must be from 1 to 1000');
        return this.serialize(async () => {
            const document = await this.read(now);
            const wakeups: CapabilityGapWakeup[] = [];
            const changed = new Set<CapabilityGap>();
            for (const gap of document.gaps.filter(entry => entry.status === 'verified' && entry.resolvedSkill)
                .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.gapId.localeCompare(right.gapId))) {
                for (const requester of gap.requesters) {
                    if (requester.wakeClaimedAt || wakeups.length >= limit) continue;
                    requester.wakeClaimedAt = now;
                    changed.add(gap);
                    wakeups.push({ gapId: gap.gapId, agentId: requester.agentId, goalId: requester.goalId,
                        anchorGoalId: requester.anchorGoalId, resolvedSkill: structuredClone(gap.resolvedSkill!) });
                }
                if (wakeups.length >= limit) break;
            }
            if (wakeups.length) {
                for (const gap of changed) { gap.updatedAt = now; gap.revision++; }
                document.updatedAt = now;
                document.revision++;
                await this.write(document);
            }
            return wakeups;
        });
    }

    async releaseWakeup(wakeup: CapabilityGapWakeup, now = new Date().toISOString()): Promise<boolean> {
        return this.serialize(async () => {
            const document = await this.read(now);
            const gap = document.gaps.find(entry => entry.gapId === wakeup.gapId && entry.status === 'verified');
            const requester = gap?.requesters.find(entry => entry.agentId === wakeup.agentId
                && entry.goalId === wakeup.goalId && entry.anchorGoalId === wakeup.anchorGoalId);
            if (!gap || !requester?.wakeClaimedAt) return false;
            requester.wakeClaimedAt = null;
            gap.updatedAt = now;
            gap.revision++;
            document.updatedAt = now;
            document.revision++;
            await this.write(document);
            return true;
        });
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const previous = writeTails.get(this.path) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        writeTails.set(this.path, result);
        const cleanup = () => { if (writeTails.get(this.path) === result) writeTails.delete(this.path); };
        void result.then(cleanup, cleanup);
        return result;
    }

    private async read(now = new Date().toISOString()): Promise<CapabilityGapDocument> {
        try { return validateDocument(JSON.parse(await readFile(this.path, 'utf8')) as unknown); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument(now);
            throw error;
        }
    }

    private async write(document: CapabilityGapDocument): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, this.path);
    }
}

export function resolveSkillForCapability(query: { title: string; description?: string; tags?: readonly string[] },
    candidates: readonly SkillResolutionCandidate[], knownSkills: readonly (SkillReference & { status?: 'known' | 'preferred' | 'blocked' })[] = [],
    sharingMode: SkillSharingMode = 'shared-library'): SkillResolution | null {
    const queryTerms = new Set(terms(`${query.title} ${query.description ?? ''} ${(query.tags ?? []).join(' ')}`));
    const queryTags = new Set((query.tags ?? []).map(tag => phrase(tag).replace(/ /g, '-')));
    const blocked = new Set(knownSkills.filter(skill => skill.status === 'blocked')
        .map(skill => `${skill.id}@${skill.version}`));
    const known = new Set(knownSkills.filter(skill => skill.status !== 'blocked')
        .map(skill => `${skill.id}@${skill.version}`));
    const ranked = candidates.filter(skill => (skill.status ?? 'verified') === 'verified')
        .filter(skill => !blocked.has(`${skill.id}@${skill.version}`))
        .filter(skill => known.has(`${skill.id}@${skill.version}`)
            || (sharingMode === 'shared-library' && (skill.visibility ?? 'shared') === 'shared'))
        .map(skill => {
            const candidateTerms = new Set(terms(`${skill.id} ${skill.name} ${skill.description} ${skill.tags.join(' ')}`));
            const matchedTerms = [...queryTerms].filter(term => candidateTerms.has(term)).sort();
            const tagMatches = skill.tags.filter(tag => queryTags.has(phrase(tag).replace(/ /g, '-'))).length;
            const learned = known.has(`${skill.id}@${skill.version}`);
            return { skill, source: learned ? 'known' as const : 'shared-library' as const,
                knowledge: learned ? 'learned' as const : 'unlearned' as const, requiresLearning: !learned,
                score: matchedTerms.length * 2 + tagMatches * 5, matchedTerms };
        }).filter(result => result.score >= 2)
        .sort((left, right) => right.score - left.score || (left.source === 'known' ? -1 : 1)
            || left.skill.id.localeCompare(right.skill.id) || right.skill.version.localeCompare(left.skill.version));
    if (!ranked.length) return null;
    if (ranked[1] && ranked[1].score === ranked[0]!.score && ranked[1].source === ranked[0]!.source) return null;
    return ranked[0]!;
}
