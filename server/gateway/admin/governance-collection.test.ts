import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceStore } from './governance.js';
import { GovernancePolicyStore } from './governance-policy.js';
import { digestGovernanceSourceEvent, GovernanceObligationStore,
    type GovernanceSourceEvent } from './governance-obligations.js';
import { GovernanceCollectionService } from './governance-collection.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-collection-'));
    directories.push(directory);
    const governancePath = join(directory, 'governance.sqlite');
    const treasuryPath = join(directory, 'treasury.sqlite');
    const governance = new GovernanceStore(governancePath);
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock',
        treasuryActorId: 'varrock-tax' }, '2026-09-01T00:00:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        kind: 'city', name: 'Varrock City' }, '2026-09-01T00:01:00.000Z');
    governance.assignTerritory({ territoryId: 'varrock-walls', jurisdictionId: 'varrock-city',
        level: 0, minX: 3200, maxX: 3300, minZ: 3400, maxZ: 3500 }, '2026-09-01T00:02:00.000Z');
    governance.close();
    const policies = new GovernancePolicyStore(governancePath);
    const draft = policies.create({ policyId: 'market-tax-1', jurisdictionId: 'varrock-city',
        policyKey: 'market-tax', version: 1, kind: 'tax', trigger: 'business-revenue', name: 'Market tax',
        calculation: { mode: 'basis-points', rateBps: 500, minimumGp: 0, maximumGp: 1_000 },
        createdByAgentId: 'steward' }, '2026-09-01T01:00:00.000Z');
    policies.activate(draft.policyId, draft.revision, 'council', '2026-09-01T02:00:00.000Z');
    policies.close();
    return { governancePath, treasuryPath };
}

function revenueEvent(eventId = 'business:sale-1', occurredAt = '2026-09-02T12:00:00.000Z'):
    GovernanceSourceEvent {
    return { eventId, sourceDomain: 'business', trigger: 'business-revenue',
        sourceRef: `economy-${eventId}`, subject: { kind: 'business', id: 'blue-moon' },
        location: { level: 0, x: 3250, z: 3450 }, basisGp: 10_000, occurredAt };
}

const verifier = { verify: async (event: Readonly<GovernanceSourceEvent>) => ({
    eventId: event.eventId, eventDigest: digestGovernanceSourceEvent(event),
    verifiedAt: '2026-09-02T12:01:00.000Z'
}) };

async function createObligation(governancePath: string, event = revenueEvent()) {
    const obligations = new GovernanceObligationStore(governancePath);
    try { return (await obligations.process(event, verifier, '2026-09-02T12:02:00.000Z'))[0]!; }
    finally { obligations.close(); }
}

describe('governance collection, exemptions and arrears', () => {
    test('books nested jurisdiction taxes once from the same verified event', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'rs-governance-nested-booking-'));
        directories.push(directory);
        const governancePath = join(directory, 'governance.sqlite');
        const treasuryPath = join(directory, 'treasury.sqlite');
        const governance = new GovernanceStore(governancePath);
        governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Misthalin' });
        governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
        governance.createJurisdiction({ jurisdictionId: 'misthalin-realm', factionId: 'misthalin',
            kind: 'realm', name: 'Misthalin Realm' });
        governance.assignTerritory({ territoryId: 'misthalin-main', jurisdictionId: 'misthalin-realm',
            level: 0, minX: 3000, maxX: 3400, minZ: 3200, maxZ: 3600 });
        governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
            parentJurisdictionId: 'misthalin-realm', kind: 'city', name: 'Varrock City' });
        governance.assignTerritory({ territoryId: 'varrock-walls', jurisdictionId: 'varrock-city',
            level: 0, minX: 3200, maxX: 3300, minZ: 3400, maxZ: 3500 });
        governance.close();
        const policies = new GovernancePolicyStore(governancePath);
        for (const definition of [
            { policyId: 'realm-tax-1', jurisdictionId: 'misthalin-realm', policyKey: 'realm-tax', amountGp: 100 },
            { policyId: 'city-tax-1', jurisdictionId: 'varrock-city', policyKey: 'city-tax', amountGp: 50 }
        ]) {
            const draft = policies.create({ ...definition, version: 1, kind: 'tax',
                trigger: 'business-revenue', name: definition.policyId,
                calculation: { mode: 'flat', amountGp: definition.amountGp }, createdByAgentId: 'admin' },
            '2026-09-01T00:00:00.000Z');
            policies.activate(draft.policyId, draft.revision, 'admin', '2026-09-01T01:00:00.000Z');
        }
        policies.close();
        const source = { ...revenueEvent('business:nested-sale'), location: { level: 0, x: 3250, z: 3450 } };
        const obligationStore = new GovernanceObligationStore(governancePath);
        const obligations = await obligationStore.process(source, verifier, '2026-09-02T12:02:00.000Z');
        expect(obligations.map(item => [item.jurisdictionId, item.amountGp]))
            .toEqual([['misthalin-realm', 100], ['varrock-city', 50]]);
        obligationStore.close();
        const treasury = new InstitutionTreasuryStore(treasuryPath);
        treasury.ensure('business', 'blue-moon');
        treasury.setBalance('business', 'blue-moon', 1, 1_000);
        treasury.ensure('faction', 'misthalin');
        treasury.ensure('faction', 'varrock');
        treasury.close();
        const collection = new GovernanceCollectionService(governancePath, treasuryPath);
        const settlementIds = ['44444444-4444-4444-8444-444444444444',
            '55555555-5555-4555-8555-555555555555'];
        obligations.forEach((obligation, index) => {
            collection.collectInstitutionObligation(obligation.obligationId, settlementIds[index]!, 'collector');
            collection.collectInstitutionObligation(obligation.obligationId, settlementIds[index]!, 'collector');
        });
        collection.close();
        const booked = new InstitutionTreasuryStore(treasuryPath);
        expect(booked.get('business', 'blue-moon')?.balanceGp).toBe(850);
        expect(booked.get('faction', 'misthalin')?.balanceGp).toBe(100);
        expect(booked.get('faction', 'varrock')?.balanceGp).toBe(50);
        expect(booked.listTransfers()).toHaveLength(2);
        booked.close();
    });

    test('applies an effective exemption before obligation generation and audits revocation', async () => {
        const paths = fixture();
        const collection = new GovernanceCollectionService(paths.governancePath, paths.treasuryPath);
        const exemption = collection.createExemption({ exemptionId: 'charity-relief',
            jurisdictionId: 'varrock-city', policyKey: 'market-tax',
            beneficiary: { kind: 'business', id: 'blue-moon' },
            validFrom: '2026-09-02T00:00:00.000Z', validUntil: '2026-10-01T00:00:00.000Z',
            reason: 'Registered charitable market service.', createdByAgentId: 'council' },
        '2026-09-02T01:00:00.000Z');
        const obligations = new GovernanceObligationStore(paths.governancePath);
        expect(await obligations.process(revenueEvent(), verifier, '2026-09-02T12:02:00.000Z')).toEqual([]);
        obligations.close();
        expect(collection.revokeExemption(exemption.exemptionId, exemption.revision, 'council',
            'Charitable registration expired.', '2026-09-03T00:00:00.000Z'))
            .toMatchObject({ status: 'revoked', revision: 2 });
        expect(collection.listExemptionAudit(exemption.exemptionId).map(item => item.action))
            .toEqual(['created', 'revoked']);
        const later = new GovernanceObligationStore(paths.governancePath);
        expect(await later.process(revenueEvent('business:sale-after-revocation',
            '2026-09-04T12:00:00.000Z'), verifier, '2026-09-04T12:02:00.000Z')).toHaveLength(1);
        later.close();
        collection.close();
    });

    test('collects institution debt through one idempotent atomic treasury transfer', async () => {
        const paths = fixture();
        const obligation = await createObligation(paths.governancePath);
        const treasury = new InstitutionTreasuryStore(paths.treasuryPath);
        treasury.ensure('business', 'blue-moon');
        treasury.setBalance('business', 'blue-moon', 1, 2_000);
        treasury.ensure('faction', 'varrock-tax');
        treasury.close();
        const collection = new GovernanceCollectionService(paths.governancePath, paths.treasuryPath);
        expect(collection.listArrears('2026-09-10T12:02:00.000Z')).toHaveLength(1);
        const settlementId = '11111111-1111-4111-8111-111111111111';
        const first = collection.collectInstitutionObligation(obligation.obligationId,
            settlementId, 'tax-collector', '2026-09-10T12:03:00.000Z');
        const replay = collection.collectInstitutionObligation(obligation.obligationId,
            settlementId, 'tax-collector', '2026-09-10T12:04:00.000Z');
        expect(first).toEqual(replay);
        expect(first).toMatchObject({ resolution: { kind: 'collected', settlementId },
            transfer: { payerActorId: 'blue-moon', payeeActorId: 'varrock-tax', amountGp: 500 } });
        expect(collection.listArrears('2026-09-10T12:05:00.000Z')).toEqual([]);
        expect(collection.listObligationAudit(obligation.obligationId).map(item => item.action))
            .toEqual(['collected']);
        collection.close();
        const balances = new InstitutionTreasuryStore(paths.treasuryPath);
        expect(balances.get('business', 'blue-moon')?.balanceGp).toBe(1_500);
        expect(balances.get('faction', 'varrock-tax')?.balanceGp).toBe(500);
        expect(balances.listTransfers()).toHaveLength(1);
        balances.close();
    });

    test('keeps failed collection in arrears and requires an audited reason to waive it', async () => {
        const paths = fixture();
        const obligation = await createObligation(paths.governancePath,
            revenueEvent('business:sale-2', '2026-09-02T13:00:00.000Z'));
        const collection = new GovernanceCollectionService(paths.governancePath, paths.treasuryPath);
        expect(() => collection.collectInstitutionObligation(obligation.obligationId,
            '22222222-2222-4222-8222-222222222222', 'tax-collector', '2026-09-10T13:00:00.000Z'))
            .toThrow('Insufficient institution treasury funds');
        expect(collection.listObligationAudit(obligation.obligationId).map(item => item.action))
            .toEqual(['collection-failed']);
        expect(collection.listArrears('2026-09-10T13:01:00.000Z')).toHaveLength(1);
        expect(() => collection.waiveObligation(obligation.obligationId, 'admin', 'short'))
            .toThrow('reason is invalid');
        expect(collection.waiveObligation(obligation.obligationId, 'admin',
            'Court-approved debt cancellation.', '2026-09-10T13:02:00.000Z'))
            .toMatchObject({ kind: 'waived', actorAgentId: 'admin' });
        expect(collection.listObligationAudit(obligation.obligationId).map(item => item.action))
            .toEqual(['collection-failed', 'waived']);
        expect(collection.listArrears('2026-09-10T13:03:00.000Z')).toEqual([]);
        collection.close();
    });
});
