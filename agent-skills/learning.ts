import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decideSkillPolicy, validateSkillSharingPolicy, type SkillAccessSubject, type SkillLearningMode,
    type SkillSharingPolicy } from './sharing-policy.js';
import type { SkillReference } from './types.js';

export const SKILL_LEARNING_SCHEMA_VERSION = 1 as const;
export type SkillGrantKind = 'organization-membership' | 'teacher-relationship' | 'license';

export interface SkillAccessGrant {
    grantId: string;
    externalKey: string;
    kind: SkillGrantKind;
    agentId: string;
    resourceId: string;
    grantedBy: string;
    validFrom: string;
    validUntil: string | null;
    revokedAt: string | null;
    revokeReason: string | null;
    createdAt: string;
    revision: number;
}

export interface SkillLearningEvent {
    eventId: string;
    externalKey: string;
    agentId: string;
    skill: SkillReference;
    policy: SkillSharingPolicy;
    learningMode: Exclude<SkillLearningMode, 'unavailable'>;
    supportingGrantId: string | null;
    occurredAt: string;
    recordedAt: string;
}

interface SkillLearningDocument {
    schemaVersion: typeof SKILL_LEARNING_SCHEMA_VERSION;
    revision: number;
    grants: SkillAccessGrant[];
    events: SkillLearningEvent[];
}

const writeTails = new Map<string, Promise<unknown>>();
const ID_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;

function id(value: string, name: string, maximum = 100): string {
    const normalized = value.trim().toLocaleLowerCase('en-US');
    if (!normalized || normalized.length > maximum || !ID_PATTERN.test(normalized)) {
        throw new Error(`${name} contains unsupported characters`);
    }
    return normalized;
}

function timestamp(value: string, name: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`);
    return value;
}

function activeAt(grant: SkillAccessGrant, at: string): boolean {
    const time = Date.parse(at);
    return Date.parse(grant.validFrom) <= time
        && (!grant.validUntil || time < Date.parse(grant.validUntil))
        && (!grant.revokedAt || time < Date.parse(grant.revokedAt));
}

function validateDocument(input: unknown): SkillLearningDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Skill learning document must be an object');
    const value = input as SkillLearningDocument;
    if (value.schemaVersion !== SKILL_LEARNING_SCHEMA_VERSION || !Number.isInteger(value.revision)
        || !Array.isArray(value.grants) || !Array.isArray(value.events)) {
        throw new Error('Skill learning document has an unsupported schema');
    }
    for (const grant of value.grants) {
        id(grant.grantId, 'grantId'); id(grant.externalKey, 'externalKey', 200); id(grant.agentId, 'agentId');
        id(grant.resourceId, 'resourceId'); id(grant.grantedBy, 'grantedBy');
        if (!['organization-membership', 'teacher-relationship', 'license'].includes(grant.kind)
            || !Number.isInteger(grant.revision) || grant.revision < 1) throw new Error('Skill learning document contains an invalid grant');
        timestamp(grant.validFrom, 'validFrom'); timestamp(grant.createdAt, 'createdAt');
        if (grant.validUntil) timestamp(grant.validUntil, 'validUntil');
        if (grant.revokedAt) timestamp(grant.revokedAt, 'revokedAt');
    }
    for (const event of value.events) {
        id(event.eventId, 'eventId'); id(event.externalKey, 'externalKey', 200); id(event.agentId, 'agentId');
        id(event.skill.id, 'skill.id'); timestamp(event.occurredAt, 'occurredAt'); timestamp(event.recordedAt, 'recordedAt');
        validateSkillSharingPolicy(event.policy);
        if (!/^\d+\.\d+\.\d+$/.test(event.skill.version) || String(event.learningMode) === 'unavailable') {
            throw new Error('Skill learning document contains an invalid event');
        }
    }
    return value;
}

function supportingGrant(grants: SkillAccessGrant[], policy: SkillSharingPolicy, at: string): SkillAccessGrant | null {
    const expected = policy.kind === 'organization' ? ['organization-membership', policy.organizationId]
        : policy.kind === 'teachable' ? ['teacher-relationship', policy.teacherAgentId]
            : policy.kind === 'licensed' ? ['license', policy.licenseId] : null;
    return expected ? grants.find(grant => grant.kind === expected[0] && grant.resourceId === expected[1]
        && activeAt(grant, at)) ?? null : null;
}

export class SkillLearningStore {
    private readonly path: string;

    constructor(path: string) { this.path = resolve(path); }

    async listGrants(agentId?: string): Promise<SkillAccessGrant[]> {
        const agent = agentId ? id(agentId, 'agentId') : null;
        return structuredClone((await this.read()).grants.filter(grant => !agent || grant.agentId === agent)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.grantId.localeCompare(right.grantId)));
    }

    async listEvents(agentId?: string): Promise<SkillLearningEvent[]> {
        const agent = agentId ? id(agentId, 'agentId') : null;
        return structuredClone((await this.read()).events.filter(event => !agent || event.agentId === agent)
            .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)));
    }

    async accessSubject(agentIdInput: string, at = new Date().toISOString()): Promise<SkillAccessSubject> {
        const agentId = id(agentIdInput, 'agentId'); timestamp(at, 'at');
        const grants = (await this.read()).grants.filter(grant => grant.agentId === agentId && activeAt(grant, at));
        return { agentId,
            organizationIds: grants.filter(grant => grant.kind === 'organization-membership').map(grant => grant.resourceId),
            teacherAgentIds: grants.filter(grant => grant.kind === 'teacher-relationship').map(grant => grant.resourceId),
            licenseIds: grants.filter(grant => grant.kind === 'license').map(grant => grant.resourceId) };
    }

    async grant(input: { externalKey: string; kind: SkillGrantKind; agentId: string; resourceId: string;
        grantedBy: string; validFrom?: string; validUntil?: string | null },
    now = new Date().toISOString()): Promise<{ grant: SkillAccessGrant; created: boolean }> {
        return this.serialize(async () => {
            const document = await this.read();
            const value = { externalKey: id(input.externalKey, 'externalKey', 200), agentId: id(input.agentId, 'agentId'),
                resourceId: id(input.resourceId, 'resourceId'), grantedBy: id(input.grantedBy, 'grantedBy'),
                kind: input.kind, validFrom: timestamp(input.validFrom ?? now, 'validFrom'),
                validUntil: input.validUntil ? timestamp(input.validUntil, 'validUntil') : null };
            if (!['organization-membership', 'teacher-relationship', 'license'].includes(value.kind)) throw new Error('Invalid grant kind');
            if (value.validUntil && Date.parse(value.validUntil) <= Date.parse(value.validFrom)) throw new Error('Grant validity window is invalid');
            const existing = document.grants.find(grant => grant.externalKey === value.externalKey);
            if (existing) {
                const comparable = (({ externalKey, agentId, resourceId, grantedBy, kind, validFrom, validUntil }) =>
                    ({ externalKey, agentId, resourceId, grantedBy, kind, validFrom, validUntil }))(existing);
                if (JSON.stringify(comparable) !== JSON.stringify(value)) throw new Error('Grant external key collision');
                return { grant: structuredClone(existing), created: false };
            }
            if (document.grants.some(grant => grant.agentId === value.agentId && grant.kind === value.kind
                && grant.resourceId === value.resourceId && activeAt(grant, value.validFrom))) {
                throw new Error('An active equivalent grant already exists');
            }
            const grant: SkillAccessGrant = { grantId: `grant:${crypto.randomUUID()}`, ...value,
                revokedAt: null, revokeReason: null, createdAt: now, revision: 1 };
            document.grants.push(grant); document.revision++;
            await this.write(document);
            return { grant: structuredClone(grant), created: true };
        });
    }

    async revoke(grantIdInput: string, expectedRevision: number, reason: string,
        now = new Date().toISOString()): Promise<SkillAccessGrant> {
        return this.serialize(async () => {
            const document = await this.read();
            const grant = document.grants.find(item => item.grantId === id(grantIdInput, 'grantId'));
            if (!grant) throw new Error('Skill access grant not found');
            if (grant.revision !== expectedRevision) throw new Error('Skill access grant changed before revoke');
            if (grant.revokedAt) throw new Error('Skill access grant is already revoked');
            if (!reason.trim() || reason.trim().length > 500) throw new Error('Revoke reason must contain 1 to 500 characters');
            grant.revokedAt = timestamp(now, 'revokedAt'); grant.revokeReason = reason.trim(); grant.revision++;
            document.revision++; await this.write(document);
            return structuredClone(grant);
        });
    }

    async learn(input: { externalKey: string; agentId: string; skill: SkillReference; policy: SkillSharingPolicy;
        occurredAt?: string; authorAgentId?: string }, now = new Date().toISOString()): Promise<{
            event: SkillLearningEvent; created: boolean;
        }> {
        return this.serialize(async () => {
            const document = await this.read();
            const externalKey = id(input.externalKey, 'externalKey', 200);
            const agentId = id(input.agentId, 'agentId');
            const skill = { id: id(input.skill.id, 'skill.id'), version: input.skill.version };
            if (!/^\d+\.\d+\.\d+$/.test(skill.version)) throw new Error('skill.version is invalid');
            const occurredAt = timestamp(input.occurredAt ?? now, 'occurredAt');
            const policy = validateSkillSharingPolicy(input.policy);
            const existing = document.events.find(event => event.externalKey === externalKey);
            if (existing) {
                if (existing.agentId !== agentId || existing.skill.id !== skill.id || existing.skill.version !== skill.version
                    || existing.occurredAt !== occurredAt || JSON.stringify(existing.policy) !== JSON.stringify(policy)) {
                    throw new Error('Learning external key collision');
                }
                return { event: structuredClone(existing), created: false };
            }
            const grants = document.grants.filter(grant => grant.agentId === agentId);
            const subject: SkillAccessSubject = { agentId,
                organizationIds: grants.filter(grant => grant.kind === 'organization-membership' && activeAt(grant, occurredAt)).map(grant => grant.resourceId),
                teacherAgentIds: grants.filter(grant => grant.kind === 'teacher-relationship' && activeAt(grant, occurredAt)).map(grant => grant.resourceId),
                licenseIds: grants.filter(grant => grant.kind === 'license' && activeAt(grant, occurredAt)).map(grant => grant.resourceId) };
            const decision = decideSkillPolicy(policy, subject, input.authorAgentId);
            if (!decision.accessible || !decision.learningEligible || decision.learningMode === 'unavailable') {
                throw new Error(`Skill learning is not allowed: ${decision.reason}`);
            }
            const support = supportingGrant(grants, policy, occurredAt);
            const event: SkillLearningEvent = { eventId: `learn:${crypto.randomUUID()}`, externalKey, agentId, skill,
                policy, learningMode: decision.learningMode, supportingGrantId: support?.grantId ?? null,
                occurredAt, recordedAt: now };
            document.events.push(event); document.revision++;
            await this.write(document);
            return { event: structuredClone(event), created: true };
        });
    }

    private async read(): Promise<SkillLearningDocument> {
        try { return validateDocument(JSON.parse(await readFile(this.path, 'utf8'))); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return { schemaVersion: SKILL_LEARNING_SCHEMA_VERSION, revision: 0, grants: [], events: [] };
            }
            throw error;
        }
    }

    private async write(document: SkillLearningDocument): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, this.path);
    }

    private async serialize<T>(operation: () => Promise<T>): Promise<T> {
        const previous = writeTails.get(this.path) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        writeTails.set(this.path, next);
        try { return await next; }
        finally { if (writeTails.get(this.path) === next) writeTails.delete(this.path); }
    }
}
