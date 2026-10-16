import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReintegrationAdjustment, ReintegrationAudience, ReintegrationEvent,
    ReintegrationEventVerifier, ReintegrationKnowledge, ReintegrationKnowledgeVerifier,
    ReintegrationPolicy, ReintegrationRule } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const EVENT_KINDS = ['restitution-completed', 'compensation-paid', 'community-service-completed',
    'sentence-completed', 'forgiveness-granted', 'religious-penance-completed'] as const;

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} is invalid`);
    return value as Record<string, unknown>;
}
function exact(value: object, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${field} is invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${field} is invalid`);
    return value;
}

export function reintegrationPolicyDigest(value: Omit<ReintegrationPolicy, 'digest'>): string {
    return hash(value);
}

/** Versioned policy input; unsupported schemas, duplicate rules and reputation from penance are refused. */
export function validateReintegrationPolicy(value: unknown): ReintegrationPolicy {
    const input = record(value, 'Reintegration policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'worldProfileId', 'effectiveFrom', 'expiresAt', 'rules'],
        'Reintegration policy');
    if (input.schemaVersion !== 1 || typeof input.version !== 'string' || !VERSION.test(input.version)
        || !Array.isArray(input.rules) || input.rules.length > 12)
        throw new Error('Reintegration policy is invalid');
    const rules: ReintegrationRule[] = input.rules.map((value, index) => {
        const field = `rules[${index}]`, rule = record(value, field);
        exact(rule, ['eventKind', 'projection', 'delta'], field);
        if (!EVENT_KINDS.includes(rule.eventKind as typeof EVENT_KINDS[number])
            || rule.projection !== 'reputation' && rule.projection !== 'moral-standing'
            || !Number.isInteger(rule.delta) || (rule.delta as number) < 1 || (rule.delta as number) > 5
            || rule.eventKind === 'religious-penance-completed' && rule.projection === 'reputation')
            throw new Error(`${field} is invalid`);
        return { eventKind: rule.eventKind as ReintegrationRule['eventKind'],
            projection: rule.projection as ReintegrationRule['projection'], delta: rule.delta as number };
    });
    if (new Set(rules.map(rule => `${rule.eventKind}:${rule.projection}`)).size !== rules.length)
        throw new Error('Reintegration rules must be unique');
    const effectiveFrom = time(input.effectiveFrom, 'effectiveFrom');
    const expiresAt = input.expiresAt === null ? null : time(input.expiresAt, 'expiresAt');
    if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(effectiveFrom))
        throw new Error('Reintegration policy interval is invalid');
    const definition = { schemaVersion: 1 as const, policyId: id(input.policyId, 'policyId'),
        version: input.version, worldProfileId: id(input.worldProfileId, 'worldProfileId'),
        effectiveFrom, expiresAt, rules };
    return { ...definition, digest: reintegrationPolicyDigest(definition) };
}
export function loadReintegrationPolicy(path:string):ReintegrationPolicy{
    return validateReintegrationPolicy(JSON.parse(readFileSync(path,'utf8'))as unknown)
}
export function loadDefaultReintegrationPolicy():ReintegrationPolicy{
    return loadReintegrationPolicy(join(import.meta.dir,'..','config','crime-reintegration-policy.json'))
}

function assertPolicy(policy: ReintegrationPolicy): void {
    const { digest: suppliedDigest, ...definition } = policy;
    if (!DIGEST.test(suppliedDigest) || suppliedDigest !== reintegrationPolicyDigest(definition))
        throw new Error('Reintegration policy digest mismatch');
    validateReintegrationPolicy(definition);
}
function validateAudience(audience: ReintegrationAudience): void {
    const value = record(audience, 'Reintegration audience');
    if (value.kind === 'observer') {
        exact(value, ['kind', 'observerAgentId', 'worldProfileId'], 'Reintegration audience');
        id(value.observerAgentId, 'observerAgentId');
    } else if (value.kind === 'community') {
        exact(value, ['kind', 'communityId', 'worldProfileId'], 'Reintegration audience');
        id(value.communityId, 'communityId');
    } else if (value.kind === 'moral-standing') {
        exact(value, ['kind', 'worldProfileId'], 'Reintegration audience');
        id(value.worldProfileId, 'worldProfileId');
    } else throw new Error('Reintegration audience is invalid');
    id(value.worldProfileId, 'worldProfileId');
}
function validateEvent(event: ReintegrationEvent): void {
    const value = record(event, 'Reintegration event');
    const common = ['kind', 'eventId', 'subjectAgentId', 'worldProfileId', 'occurredAt', 'sourceEvidenceDigest'];
    const extra: Record<ReintegrationEvent['kind'], string[]> = {
        'restitution-completed': ['claimId', 'victimActorId'],
        'compensation-paid': ['paymentId', 'recipientActorId'],
        'community-service-completed': ['serviceOrderId', 'jurisdictionId'],
        'sentence-completed': ['sentenceId', 'jurisdictionId'],
        'forgiveness-granted': ['caseId', 'forgiverActorId'],
        'religious-penance-completed': ['riteId', 'institutionId']
    };
    if (!EVENT_KINDS.includes(value.kind as ReintegrationEvent['kind'])) throw new Error('Reintegration event is invalid');
    exact(value, [...common, ...extra[event.kind]], 'Reintegration event');
    for (const key of ['eventId', 'subjectAgentId', 'worldProfileId', ...extra[event.kind]]) id(value[key], key);
    time(value.occurredAt, 'occurredAt');
    digest(value.sourceEvidenceDigest, 'sourceEvidenceDigest');
}
function validateKnowledge(knowledge: ReintegrationKnowledge): void {
    const value = record(knowledge, 'Reintegration knowledge');
    exact(value, ['knowledgeId', 'eventId', 'audience', 'learnedAt', 'sourceEvidenceDigest'],
        'Reintegration knowledge');
    id(value.knowledgeId, 'knowledgeId');
    id(value.eventId, 'eventId');
    validateAudience(knowledge.audience);
    if ((knowledge.audience as ReintegrationAudience).kind === 'moral-standing')
        throw new Error('Reintegration knowledge audience is invalid');
    time(value.learnedAt, 'learnedAt');
    digest(value.sourceEvidenceDigest, 'sourceEvidenceDigest');
}
export function validateReintegrationEvent(event: ReintegrationEvent): void { validateEvent(event); }
export function validateReintegrationKnowledge(knowledge: ReintegrationKnowledge): void { validateKnowledge(knowledge); }
function sameAudience(a: ReintegrationAudience, b: ReintegrationAudience): boolean {
    return a.worldProfileId === b.worldProfileId
        && (a.kind === 'observer' && b.kind === 'observer' && a.observerAgentId === b.observerAgentId
        || a.kind === 'community' && b.kind === 'community' && a.communityId === b.communityId);
}

/** Pure projection: missing trusted event/knowledge sources yield no adjustment, never a legal or title mutation. */
export function projectReintegrationAdjustment(policy: ReintegrationPolicy, event: ReintegrationEvent | null,
    audience: ReintegrationAudience, knowledge?: ReintegrationKnowledge | null,
    verifyEvent?: ReintegrationEventVerifier, verifyKnowledge?: ReintegrationKnowledgeVerifier): ReintegrationAdjustment {
    assertPolicy(policy);
    validateAudience(audience);
    const none: ReintegrationAdjustment = { applied: false, delta: 0, policyDigest: policy.digest };
    if (!event || !verifyEvent) return none;
    validateEvent(event);
    const projection = audience.kind === 'moral-standing' ? 'moral-standing' : 'reputation';
    const rule = policy.rules.find(rule => rule.eventKind === event.kind && rule.projection === projection);
    if (!rule || Date.parse(event.occurredAt) < Date.parse(policy.effectiveFrom)
        || policy.expiresAt !== null && Date.parse(event.occurredAt) >= Date.parse(policy.expiresAt)
        || event.worldProfileId !== policy.worldProfileId
        || audience.worldProfileId !== policy.worldProfileId)
        return none;
    if (projection === 'reputation') {
        if (!knowledge || !verifyKnowledge) return none;
        validateKnowledge(knowledge);
        if (knowledge.eventId !== event.eventId || !sameAudience(audience, knowledge.audience)
            || Date.parse(knowledge.learnedAt) < Date.parse(event.occurredAt)
            || event.kind === 'forgiveness-granted'
                && (audience.kind !== 'observer' || audience.observerAgentId !== event.forgiverActorId)) return none;
        if (!verifyEvent(Object.freeze({ ...event }))
            || !verifyKnowledge(Object.freeze({ ...knowledge, audience: Object.freeze({ ...knowledge.audience }) }),
                Object.freeze({ ...event }))) return none;
        return { applied: true, delta: rule.delta, subjectAgentId: event.subjectAgentId,
            audience: { ...audience }, eventId: event.eventId, knowledgeId: knowledge.knowledgeId,
            policyDigest: policy.digest };
    }
    if (!verifyEvent(Object.freeze({ ...event }))) return none;
    return { applied: true, delta: rule.delta, subjectAgentId: event.subjectAgentId,
        audience: { ...audience }, eventId: event.eventId, knowledgeId: null, policyDigest: policy.digest };
}
