import { describe, expect, test } from 'bun:test';

import { projectReintegrationAdjustment, validateReintegrationPolicy } from '../index.js';
import type { ReintegrationAudience, ReintegrationEvent, ReintegrationKnowledge,
    ReintegrationPolicy } from '../index.js';

const sourceEvidenceDigest = 'a'.repeat(64);
function policy(): ReintegrationPolicy {
    return validateReintegrationPolicy({ schemaVersion: 1, policyId: 'city-reintegration', version: '1.0.0',
        worldProfileId: 'local-world', effectiveFrom: '2026-01-01T00:00:00.000Z', expiresAt: null,
        rules: [
            { eventKind: 'restitution-completed', projection: 'reputation', delta: 2 },
            { eventKind: 'compensation-paid', projection: 'reputation', delta: 1 },
            { eventKind: 'community-service-completed', projection: 'reputation', delta: 1 },
            { eventKind: 'sentence-completed', projection: 'reputation', delta: 1 },
            { eventKind: 'forgiveness-granted', projection: 'reputation', delta: 1 },
            { eventKind: 'religious-penance-completed', projection: 'moral-standing', delta: 1 }
        ] });
}
function event(kind: ReintegrationEvent['kind'] = 'restitution-completed'): ReintegrationEvent {
    const common = { eventId: 'event-1', subjectAgentId: 'actor-1', worldProfileId: 'local-world',
        occurredAt: '2026-02-01T10:00:00.000Z',
        sourceEvidenceDigest };
    switch (kind) {
        case 'restitution-completed': return { ...common, kind, claimId: 'claim-1', victimActorId: 'victim-1' };
        case 'compensation-paid': return { ...common, kind, paymentId: 'payment-1', recipientActorId: 'victim-1' };
        case 'community-service-completed': return { ...common, kind, serviceOrderId: 'order-1', jurisdictionId: 'city' };
        case 'sentence-completed': return { ...common, kind, sentenceId: 'sentence-1', jurisdictionId: 'city' };
        case 'forgiveness-granted': return { ...common, kind, caseId: 'case-1', forgiverActorId: 'observer-1' };
        case 'religious-penance-completed': return { ...common, kind, riteId: 'rite-1', institutionId: 'temple-1' };
    }
}
const observer: ReintegrationAudience = { kind: 'observer', observerAgentId: 'observer-1',
    worldProfileId: 'local-world' };
function knowledge(audience: ReintegrationKnowledge['audience'] = observer as ReintegrationKnowledge['audience']): ReintegrationKnowledge {
    return { knowledgeId: 'knowledge-1', eventId: 'event-1', audience,
        learnedAt: '2026-02-01T10:00:01.000Z', sourceEvidenceDigest };
}
const trusted = () => true;

describe('read-only reintegration policy', () => {
    test('a source-attested event and audience-specific knowledge can improve only that observer', () => {
        const result = projectReintegrationAdjustment(policy(), event(), observer, knowledge(), trusted, trusted);
        expect(result).toMatchObject({ applied: true, delta: 2, subjectAgentId: 'actor-1',
            audience: observer, eventId: 'event-1', knowledgeId: 'knowledge-1' });
        expect(projectReintegrationAdjustment(policy(), event(), { kind: 'observer', observerAgentId: 'observer-2',
            worldProfileId: 'local-world' },
            knowledge(), trusted, trusted).applied).toBe(false);
    });

    test('only verified community knowledge can project community-specific reputation', () => {
        const audience = { kind: 'community' as const, communityId: 'town-1', worldProfileId: 'local-world' };
        expect(projectReintegrationAdjustment(policy(), event('community-service-completed'), audience,
            knowledge(audience), trusted, trusted)).toMatchObject({ applied: true, delta: 1, audience });
        expect(projectReintegrationAdjustment(policy(), event('community-service-completed'), audience,
            knowledge({ kind: 'community', communityId: 'town-2', worldProfileId: 'local-world' }),
            trusted, trusted).applied).toBe(false);
    });

    test('all civil and sentence event kinds require a trusted source and audience knowledge', () => {
        for (const kind of ['restitution-completed', 'compensation-paid', 'community-service-completed',
            'sentence-completed', 'forgiveness-granted'] as const)
            expect(projectReintegrationAdjustment(policy(), event(kind), observer, knowledge(), trusted, trusted).applied).toBe(true);
        expect(projectReintegrationAdjustment(policy(), event(), observer, knowledge(), undefined, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), observer, knowledge(), trusted, undefined).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), observer, knowledge(), () => false, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), observer, knowledge(), trusted, () => false).applied).toBe(false);
    });

    test('forgiveness is personal to the attested forgiver, not a community absolution', () => {
        const community = { kind: 'community' as const, communityId: 'town-1', worldProfileId: 'local-world' };
        expect(projectReintegrationAdjustment(policy(), event('forgiveness-granted'), community,
            knowledge(community), trusted, trusted).applied).toBe(false);
    });

    test('penance may affect only this world profile moral projection; prayer is not an event', () => {
        const moral = { kind: 'moral-standing' as const, worldProfileId: 'local-world' };
        expect(projectReintegrationAdjustment(policy(), event('religious-penance-completed'), moral,
            null, trusted)).toMatchObject({ applied: true, delta: 1, knowledgeId: null });
        expect(projectReintegrationAdjustment(policy(), event('religious-penance-completed'), observer,
            knowledge(), trusted, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event('religious-penance-completed'),
            { kind: 'moral-standing', worldProfileId: 'other-world' }, null, trusted).applied).toBe(false);
        expect(() => projectReintegrationAdjustment(policy(), { ...event(), kind: 'prayer' } as unknown as ReintegrationEvent,
            moral, null, trusted)).toThrow();
    });

    test('wrong event, early knowledge and policy interval fail closed', () => {
        expect(projectReintegrationAdjustment(policy(), { ...event(), worldProfileId: 'other-world' },
            observer, knowledge(), trusted, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), { ...observer, worldProfileId: 'other-world' },
            knowledge(), trusted, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), observer,
            { ...knowledge(), eventId: 'event-2' }, trusted, trusted).applied).toBe(false);
        expect(projectReintegrationAdjustment(policy(), event(), observer,
            { ...knowledge(), learnedAt: '2026-02-01T09:00:00.000Z' }, trusted, trusted).applied).toBe(false);
        const future = validateReintegrationPolicy({ schemaVersion: 1, policyId: 'future', version: '1.0.0',
            worldProfileId: 'local-world', effectiveFrom: '2027-01-01T00:00:00.000Z', expiresAt: null,
            rules: [{ eventKind: 'restitution-completed', projection: 'reputation', delta: 1 }] });
        expect(projectReintegrationAdjustment(future, event(), observer, knowledge(), trusted, trusted).applied).toBe(false);
    });

    test('tampering, invalid rules and malformed evidence are rejected', () => {
        const changed = policy();
        changed.rules[0]!.delta = 5;
        expect(() => projectReintegrationAdjustment(changed, event(), observer, knowledge(), trusted, trusted))
            .toThrow('digest mismatch');
        const definition = { schemaVersion: 1, policyId: 'test', version: '1.0.0', worldProfileId: 'local-world',
            effectiveFrom: '2026-01-01T00:00:00.000Z', expiresAt: null,
            rules: [{ eventKind: 'religious-penance-completed', projection: 'reputation', delta: 1 }] };
        expect(() => validateReintegrationPolicy(definition)).toThrow();
        expect(() => validateReintegrationPolicy({ ...definition, schemaVersion: 2 })).toThrow();
        expect(() => projectReintegrationAdjustment(policy(), { ...event(), sourceEvidenceDigest: 'bad' },
            observer, knowledge(), trusted, trusted)).toThrow();
    });
});
