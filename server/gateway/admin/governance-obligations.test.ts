import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceStore } from './governance.js';
import { GovernancePolicyStore } from './governance-policy.js';
import { businessRevenueGovernanceEvent, digestGovernanceSourceEvent,
    GovernanceObligationStore, propertyTransferGovernanceEvent,
    type GovernanceSourceEvent, type GovernanceSourceEventVerifier } from './governance-obligations.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-obligations-'));
    directories.push(directory);
    return join(directory, 'governance.sqlite');
}

const verifier: GovernanceSourceEventVerifier = {
    async verify(event) {
        return { eventId: event.eventId, eventDigest: digestGovernanceSourceEvent(event),
            verifiedAt: '2026-09-06T16:00:00.000Z' };
    }
};

function configureNestedRevenuePolicies(path: string): void {
    const governance = new GovernanceStore(path);
    governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Misthalin' });
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
    governance.createJurisdiction({ jurisdictionId: 'misthalin-realm', factionId: 'misthalin',
        kind: 'realm', name: 'Misthalin' });
    governance.assignTerritory({ territoryId: 'misthalin-main', jurisdictionId: 'misthalin-realm',
        level: 0, minX: 3000, maxX: 3400, minZ: 3200, maxZ: 3600 });
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        parentJurisdictionId: 'misthalin-realm', kind: 'city', name: 'Varrock' });
    governance.assignTerritory({ territoryId: 'varrock-walls', jurisdictionId: 'varrock-city',
        level: 0, minX: 3170, maxX: 3290, minZ: 3370, maxZ: 3510 });
    governance.close();

    const policies = new GovernancePolicyStore(path);
    const realmTax = policies.create({ policyId: 'misthalin-revenue-v1', jurisdictionId: 'misthalin-realm',
        policyKey: 'revenue-tax', version: 1, kind: 'tax', trigger: 'business-revenue',
        name: 'Royal revenue tax', calculation: { mode: 'basis-points', rateBps: 500,
            minimumGp: 0, maximumGp: 10_000 }, createdByAgentId: 'royal-steward' });
    const cityTax = policies.create({ policyId: 'varrock-revenue-v1', jurisdictionId: 'varrock-city',
        policyKey: 'revenue-tax', version: 1, kind: 'tax', trigger: 'business-revenue',
        name: 'City revenue tax', calculation: { mode: 'basis-points', rateBps: 250,
            minimumGp: 0, maximumGp: 5_000 }, createdByAgentId: 'city-steward' });
    policies.activate(realmTax.policyId, realmTax.revision, 'misthalin-council', '2026-09-01T10:00:00.000Z');
    policies.activate(cityTax.policyId, cityTax.revision, 'varrock-council', '2026-09-01T10:00:00.000Z');
    policies.close();
}

function revenueEvent(): GovernanceSourceEvent {
    return { eventId: 'business:run-001:0:shop-sell', sourceDomain: 'business',
        trigger: 'business-revenue', sourceRef: 'economy-run:11111111-1111-4111-8111-111111111111',
        subject: { kind: 'business', id: 'varrock-forge' },
        location: { x: 3210, z: 3410, level: 0 }, basisGp: 10_000,
        occurredAt: '2026-09-05T12:00:00.000Z' };
}

describe('governance obligations', () => {
    test('creates nested obligations once in deterministic jurisdiction order', async () => {
        const path = databasePath();
        configureNestedRevenuePolicies(path);
        const obligations = new GovernanceObligationStore(path);
        const first = await obligations.process(revenueEvent(), verifier, '2026-09-06T16:00:00.000Z');
        expect(first.map(item => ({ jurisdictionId: item.jurisdictionId, amountGp: item.amountGp,
            creditor: item.creditor, sequence: item.sequence }))).toEqual([
            { jurisdictionId: 'misthalin-realm', amountGp: 500,
                creditor: { kind: 'faction', id: 'misthalin' }, sequence: 0 },
            { jurisdictionId: 'varrock-city', amountGp: 250,
                creditor: { kind: 'faction', id: 'varrock' }, sequence: 1 }
        ]);
        expect(first.every(item => item.debtor.id === 'varrock-forge' && item.status === 'due')).toBeTrue();
        expect(await obligations.process(revenueEvent(), verifier, '2026-09-07T16:00:00.000Z')).toEqual(first);
        expect(obligations.listForEvent(revenueEvent().eventId)).toHaveLength(2);
        obligations.close();
    });

    test('rejects changed reuse of a verified source event id', async () => {
        const path = databasePath();
        configureNestedRevenuePolicies(path);
        const obligations = new GovernanceObligationStore(path);
        await obligations.process(revenueEvent(), verifier);
        await expect(obligations.process({ ...revenueEvent(), basisGp: 20_000 }, verifier))
            .rejects.toThrow('reused with different verified content');
        await expect(obligations.process({ ...revenueEvent(), eventId: 'business:renamed-event' }, verifier))
            .rejects.toThrow('already processed under another id');
        expect(obligations.listForEvent(revenueEvent().eventId).map(item => item.amountGp)).toEqual([500, 250]);
        obligations.close();
    });

    test('uses the policy version effective when the event occurred, not the processing-time version', async () => {
        const path = databasePath();
        configureNestedRevenuePolicies(path);
        const policies = new GovernancePolicyStore(path);
        const replacement = policies.create({ policyId: 'varrock-revenue-v2', jurisdictionId: 'varrock-city',
            policyKey: 'revenue-tax', version: 2, kind: 'tax', trigger: 'business-revenue',
            name: 'City revenue tax amended', calculation: { mode: 'basis-points', rateBps: 1_000,
                minimumGp: 0, maximumGp: 10_000 }, createdByAgentId: 'city-steward' });
        policies.activate(replacement.policyId, replacement.revision, 'varrock-council',
            '2026-09-06T12:00:00.000Z');
        policies.close();

        const obligations = new GovernanceObligationStore(path);
        const historical = await obligations.process(revenueEvent(), verifier, '2026-09-07T00:00:00.000Z');
        expect(historical[1]).toMatchObject({ policyId: 'varrock-revenue-v1', policyVersion: 1, amountGp: 250 });
        const laterEvent = { ...revenueEvent(), eventId: 'business:run-002:0:shop-sell',
            sourceRef: 'economy-event:run-002:0:shop-sell',
            occurredAt: '2026-09-06T13:00:00.000Z' };
        const current = await obligations.process(laterEvent, verifier, '2026-09-07T00:00:00.000Z');
        expect(current[1]).toMatchObject({ policyId: 'varrock-revenue-v2', policyVersion: 2, amountGp: 1_000 });
        obligations.close();
    });

    test('reverses payer direction for a subsidy without using negative money', async () => {
        const path = databasePath();
        configureNestedRevenuePolicies(path);
        const policies = new GovernancePolicyStore(path);
        const subsidy = policies.create({ policyId: 'varrock-growth-v1', jurisdictionId: 'varrock-city',
            policyKey: 'growth-subsidy', version: 1, kind: 'subsidy', trigger: 'business-revenue',
            name: 'Growth subsidy', calculation: { mode: 'flat', amountGp: 100 },
            createdByAgentId: 'city-steward' });
        policies.activate(subsidy.policyId, subsidy.revision, 'varrock-council', '2026-09-01T11:00:00.000Z');
        policies.close();
        const obligations = new GovernanceObligationStore(path);
        const result = await obligations.process(revenueEvent(), verifier);
        expect(result.find(item => item.kind === 'subsidy')).toMatchObject({ amountGp: 100,
            debtor: { kind: 'faction', id: 'varrock' },
            creditor: { kind: 'business', id: 'varrock-forge' } });
        obligations.close();
    });

    test('adapts exact property transfers and completed business revenue only', () => {
        const property = { propertyId: 'varrock-workshop', displayName: 'Workshop', description: 'Forge',
            type: 'workshop' as const, location: { x: 3210, z: 3410, level: 0, region: 'Varrock' },
            purchasePrice: 25_000, entryPoints: [], revenue: { mode: 'none' as const, amount: 0,
                intervalMinutes: 0 }, maintenance: { amount: 0, intervalMinutes: 0 },
            permissions: { inspect: [], purchase: [], enter: [], manage: [] } };
        const transfer = propertyTransferGovernanceEvent({ transferId: 'transfer-001',
            propertyId: property.propertyId, from: { kind: 'player', id: 'seller' },
            to: { kind: 'business', id: 'varrock-forge' }, beforeVersion: 2, version: 3,
            createdAt: '2026-09-05T12:00:00.000Z' }, property, 25_000);
        expect(transfer).toMatchObject({ sourceDomain: 'property', trigger: 'property-transfer',
            subject: { kind: 'business', id: 'varrock-forge' }, basisGp: 25_000 });

        const economy = { id: '11111111-1111-4111-8111-111111111111:0:shop-sell',
            timestamp: '2026-09-05T12:00:00.000Z', runId: '11111111-1111-4111-8111-111111111111',
            username: 'worker', skillId: 'sell.iron', stepId: 'sell', kind: 'shop-sell' as const,
            itemsIn: [], itemsOut: [{ id: 2351, name: 'Iron bar', quantity: 10 }],
            coinsDelta: 1_000, counterparty: null, partial: false };
        expect(businessRevenueGovernanceEvent(economy, 'varrock-forge', property.location))
            .toMatchObject({ sourceDomain: 'business', basisGp: 1_000 });
        expect(() => businessRevenueGovernanceEvent({ ...economy, partial: true },
            'varrock-forge', property.location)).toThrow('not verified business revenue');
    });

    test('fails closed for mismatched evidence and cross-domain triggers', async () => {
        const path = databasePath();
        configureNestedRevenuePolicies(path);
        const obligations = new GovernanceObligationStore(path);
        await expect(obligations.process(revenueEvent(), { async verify(event) {
            return { eventId: event.eventId, eventDigest: 'f'.repeat(64),
                verifiedAt: '2026-09-06T16:00:00.000Z' };
        } })).rejects.toThrow('does not match normalized input');
        await expect(obligations.process({ ...revenueEvent(), sourceDomain: 'property' }, verifier))
            .rejects.toThrow('not allowed for its source domain');
        expect(obligations.getEvent(revenueEvent().eventId)).toBeNull();
        obligations.close();
    });
});
