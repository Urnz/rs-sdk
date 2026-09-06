import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdminPropertyView } from './properties.js';
import { GovernanceStore } from './governance.js';
import { GovernancePolicyStore } from './governance-policy.js';
import { digestGovernanceSourceEvent, GovernanceObligationStore,
    type GovernanceSourceEvent } from './governance-obligations.js';
import { GovernanceCollectionService } from './governance-collection.js';
import { digestManorPropertyEvidence, GovernanceManorService,
    type ManorPropertyEvidence } from './governance-manor.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function event(id: string, occurredAt: string): GovernanceSourceEvent {
    return { eventId: `business:${id}`, sourceDomain: 'business', trigger: 'business-revenue',
        sourceRef: `economy:${id}`, subject: { kind: 'business', id: 'draynor-shop' },
        location: { level: 0, x: 3100, z: 3300 }, basisGp: 1_000, occurredAt };
}

const eventVerifier = { verify: async (value: Readonly<GovernanceSourceEvent>) => ({
    eventId: value.eventId, eventDigest: digestGovernanceSourceEvent(value),
    verifiedAt: '2026-09-07T18:00:00.000Z'
}) };

function property(version: number): AdminPropertyView {
    return { propertyId: 'draynor-manor', displayName: 'Draynor Manor', description: 'Untrusted.',
        type: 'estate', location: { x: 3100, z: 3300, level: 0, region: 'Draynor' }, purchasePrice: 1,
        state: { status: 'owned', owner: { kind: 'faction', id: 'estate.draynor' },
            acquiredAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', version } };
}

const propertyVerifier = { verify: async (value: Readonly<ManorPropertyEvidence>) => ({
    propertyId: value.propertyId, evidenceDigest: digestManorPropertyEvidence(value),
    verifiedAt: '2026-09-07T10:00:00.000Z'
}) };

async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-lifecycle-'));
    directories.push(directory);
    const governancePath = join(directory, 'governance.sqlite');
    const treasuryPath = join(directory, 'treasury.sqlite');
    const governance = new GovernanceStore(governancePath);
    governance.createFaction({ factionId: 'draynor-manor', kind: 'manor', name: 'Draynor Manor',
        treasuryActorId: 'estate.draynor' }, '2026-09-01T00:00:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'draynor-estate', factionId: 'draynor-manor',
        kind: 'manor', name: 'Draynor Estate' }, '2026-09-01T00:01:00.000Z');
    governance.assignTerritory({ territoryId: 'draynor-land', jurisdictionId: 'draynor-estate',
        level: 0, minX: 3000, maxX: 3200, minZ: 3200, maxZ: 3400 }, '2026-09-01T00:02:00.000Z');
    governance.close();
    const policies = new GovernancePolicyStore(governancePath);
    const draft = policies.create({ policyId: 'rent-tax-1', jurisdictionId: 'draynor-estate',
        policyKey: 'rent-tax', version: 1, kind: 'tax', trigger: 'business-revenue', name: 'Rent tax',
        calculation: { mode: 'flat', amountGp: 100 }, createdByAgentId: 'steward' },
    '2026-09-01T01:00:00.000Z');
    policies.activate(draft.policyId, draft.revision, 'steward', '2026-09-01T02:00:00.000Z');
    policies.close();
    const obligations = new GovernanceObligationStore(governancePath);
    const existing = (await obligations.process(event('before-disable', '2026-09-07T11:00:00.000Z'),
        eventVerifier, '2026-09-07T11:01:00.000Z'))[0]!;
    obligations.close();
    const manors = new GovernanceManorService(governancePath);
    await manors.reconcileProperty('draynor-estate', property(1), propertyVerifier,
        'steward', 'Verified initial manor ownership.', '2026-09-07T11:02:00.000Z');
    manors.close();
    const treasury = new InstitutionTreasuryStore(treasuryPath);
    treasury.ensure('business', 'draynor-shop');
    treasury.setBalance('business', 'draynor-shop', 1, 1_000);
    treasury.ensure('faction', 'estate.draynor');
    treasury.close();
    return { governancePath, treasuryPath, existing };
}

describe('safe governance faction lifecycle', () => {
    test('disables writes and new obligations while preserving all existing read models', async () => {
        const paths = await fixture();
        const governance = new GovernanceStore(paths.governancePath);
        const disabled = governance.setFactionStatus('draynor-manor', 1, 'disabled', 'admin',
            'Temporarily suspend this governance unit.', '2026-09-07T12:00:00.000Z');
        expect(disabled).toMatchObject({ status: 'disabled', revision: 2,
            disabledAt: '2026-09-07T12:00:00.000Z' });
        expect(governance.getFaction('draynor-manor')).toEqual(disabled);
        expect(() => governance.createBudget({ budgetId: 'disabled-budget', factionId: 'draynor-manor',
            version: 1, name: 'Disabled write', validFrom: '2026-09-08T00:00:00.000Z',
            validUntil: '2027-09-08T00:00:00.000Z', revenueTargetGp: 1, spendingLimitGp: 1,
            createdByAgentId: 'steward' })).toThrow('disabled and read-only');
        governance.close();

        const obligations = new GovernanceObligationStore(paths.governancePath);
        expect(await obligations.process(event('while-disabled', '2026-09-07T12:30:00.000Z'),
            eventVerifier, '2026-09-07T12:31:00.000Z')).toEqual([]);
        expect(obligations.getObligation(paths.existing.obligationId)).toEqual(paths.existing);
        obligations.close();

        const collection = new GovernanceCollectionService(paths.governancePath, paths.treasuryPath);
        expect(collection.listArrears('2026-09-07T13:00:00.000Z', 0)).toHaveLength(1);
        expect(() => collection.collectInstitutionObligation(paths.existing.obligationId,
            '33333333-3333-4333-8333-333333333333', 'collector')).toThrow('disabled and read-only');
        collection.close();
        const manors = new GovernanceManorService(paths.governancePath);
        expect(manors.getPortfolio('draynor-estate').properties).toHaveLength(1);
        await expect(manors.reconcileProperty('draynor-estate', property(2), propertyVerifier,
            'steward', 'Blocked ownership refresh.')).rejects.toThrow('disabled and read-only');
        manors.close();
        const treasury = new InstitutionTreasuryStore(paths.treasuryPath);
        expect(treasury.get('business', 'draynor-shop')?.balanceGp).toBe(1_000);
        treasury.close();
    });

    test('audits re-enabling without retroactively charging events from the disabled interval', async () => {
        const paths = await fixture();
        const governance = new GovernanceStore(paths.governancePath);
        const disabled = governance.setFactionStatus('draynor-manor', 1, 'disabled', 'admin',
            'Suspend during governance maintenance.', '2026-09-07T12:00:00.000Z');
        const enabled = governance.setFactionStatus('draynor-manor', disabled.revision, 'active', 'admin',
            'Maintenance completed and reviewed.', '2026-09-07T14:00:00.000Z');
        expect(enabled).toMatchObject({ status: 'active', revision: 3, disabledAt: null });
        expect(governance.setFactionStatus('draynor-manor', disabled.revision, 'active', 'admin',
            'Maintenance completed and reviewed.', '2026-09-07T14:00:00.000Z')).toEqual(enabled);
        expect(() => governance.setFactionStatus('draynor-manor', disabled.revision, 'active', 'other-admin',
            'Different replay provenance.', '2026-09-07T14:00:00.000Z')).toThrow('different audit provenance');
        expect(governance.isFactionActiveAt('draynor-manor', '2026-09-07T13:00:00.000Z')).toBe(false);
        expect(governance.isFactionActiveAt('draynor-manor', '2026-09-07T15:00:00.000Z')).toBe(true);
        expect(governance.listFactionLifecycleAudit('draynor-manor').map(item => item.action))
            .toEqual(['disabled', 'enabled']);
        governance.close();
        const obligations = new GovernanceObligationStore(paths.governancePath);
        expect(await obligations.process(event('delayed-disabled', '2026-09-07T13:00:00.000Z'),
            eventVerifier, '2026-09-07T15:00:00.000Z')).toEqual([]);
        expect(await obligations.process(event('after-enable', '2026-09-07T15:30:00.000Z'),
            eventVerifier, '2026-09-07T15:31:00.000Z')).toHaveLength(1);
        obligations.close();
    });
});
