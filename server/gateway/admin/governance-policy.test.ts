import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceStore } from './governance.js';
import { calculateGovernancePolicyAmount, GovernancePolicyStore,
    type CreateGovernancePolicy } from './governance-policy.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function store(): { governance: GovernanceStore; policies: GovernancePolicyStore } {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-policy-'));
    directories.push(directory);
    const path = join(directory, 'governance.sqlite');
    const governance = new GovernanceStore(path);
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        kind: 'city', name: 'Varrock' });
    return { governance, policies: new GovernancePolicyStore(path) };
}

function tax(overrides: Partial<CreateGovernancePolicy> = {}): CreateGovernancePolicy {
    return { policyId: 'varrock-sales-tax-v1', jurisdictionId: 'varrock-city',
        policyKey: 'sales-tax', version: 1, kind: 'tax', trigger: 'business-revenue',
        name: 'Varrock sales tax', calculation: { mode: 'basis-points', rateBps: 500,
            minimumGp: 2, maximumGp: 1_000 }, createdByAgentId: 'varrock-steward', ...overrides };
}

describe('versioned governance policy', () => {
    test('calculates bounded flat and basis-point policies deterministically', () => {
        const { governance, policies } = store();
        const proportional = policies.create(tax(), '2026-09-06T13:00:00.000Z');
        const flat = policies.create(tax({ policyId: 'varrock-registration-fee-v1',
            policyKey: 'registration-fee', kind: 'fee', trigger: 'business-registration',
            name: 'Business registration fee', calculation: { mode: 'flat', amountGp: 125 } }));
        expect(calculateGovernancePolicyAmount(proportional, 10)).toBe(2);
        expect(calculateGovernancePolicyAmount(proportional, 10_000)).toBe(500);
        expect(calculateGovernancePolicyAmount(proportional, 1_000_000)).toBe(1_000);
        expect(calculateGovernancePolicyAmount(flat, 0)).toBe(125);
        policies.close(); governance.close();
    });

    test('versions a policy family and atomically supersedes its active version', () => {
        const { governance, policies } = store();
        const first = policies.create(tax());
        expect(policies.create(tax())).toEqual(first);
        expect(() => policies.create(tax({ createdByAgentId: 'foreign-agent' })))
            .toThrow('reused with different content');
        const active = policies.activate(first.policyId, first.revision, 'varrock-council',
            '2026-09-06T14:00:00.000Z');
        expect(policies.activate(first.policyId, first.revision, 'varrock-council')).toEqual(active);
        expect(() => policies.activate(first.policyId, first.revision, 'foreign-agent'))
            .toThrow('different approver');
        const second = policies.create(tax({ policyId: 'varrock-sales-tax-v2', version: 2,
            calculation: { mode: 'basis-points', rateBps: 600, minimumGp: 2, maximumGp: 1_200 } }));

        expect(() => policies.activate(second.policyId, 2, 'varrock-council'))
            .toThrow('changed before activation');
        expect(policies.listActive('varrock-city')).toEqual([active]);
        const replacement = policies.activate(second.policyId, second.revision, 'varrock-council',
            '2026-09-06T15:00:00.000Z');
        expect(replacement).toMatchObject({ version: 2, status: 'active', revision: 2 });
        expect(policies.get(first.policyId)).toMatchObject({ status: 'superseded', revision: 3 });
        expect(policies.listAudit('varrock-city').map(item => item.action))
            .toEqual(['created', 'activated', 'created', 'superseded', 'activated']);
        policies.close(); governance.close();
    });

    test('supports each policy kind only through its allowlisted typed trigger', () => {
        const { governance, policies } = store();
        const inputs: CreateGovernancePolicy[] = [
            tax(),
            tax({ policyId: 'varrock-import-v1', policyKey: 'import', kind: 'tariff',
                trigger: 'goods-import', name: 'Import tariff' }),
            tax({ policyId: 'varrock-transfer-fee-v1', policyKey: 'transfer-fee', kind: 'fee',
                trigger: 'property-transfer', name: 'Transfer fee' }),
            tax({ policyId: 'varrock-development-v1', policyKey: 'development', kind: 'subsidy',
                trigger: 'property-development', name: 'Development subsidy' })
        ];
        for (const input of inputs) policies.create(input);
        expect(() => policies.create(tax({ policyId: 'unsafe-v1', policyKey: 'unsafe',
            kind: 'tariff', trigger: 'business-revenue' }))).toThrow('not allowed');
        expect(policies.listActive('varrock-city')).toEqual([]);
        policies.close(); governance.close();
    });

    test('keeps drafts inert, filters active policies by trigger and audits revocation', () => {
        const { governance, policies } = store();
        const revenue = policies.create(tax());
        const ownership = policies.create(tax({ policyId: 'varrock-land-tax-v1', policyKey: 'land-tax',
            trigger: 'property-ownership', name: 'Varrock land tax' }));
        policies.activate(revenue.policyId, revenue.revision, 'varrock-council');
        policies.activate(ownership.policyId, ownership.revision, 'varrock-council');
        expect(policies.listActive('varrock-city', 'business-revenue').map(item => item.policyKey))
            .toEqual(['sales-tax']);
        const revoked = policies.revoke(revenue.policyId, 2, 'varrock-council');
        expect(revoked).toMatchObject({ status: 'revoked', revision: 3 });
        expect(policies.revoke(revenue.policyId, 2, 'varrock-council')).toEqual(revoked);
        expect(() => policies.revoke(revenue.policyId, 2, 'foreign-agent')).toThrow('different actor');
        expect(policies.listActive('varrock-city', 'business-revenue')).toEqual([]);
        policies.close(); governance.close();
    });

    test('rejects skipped versions, unknown jurisdictions and unsafe calculation bounds', () => {
        const { governance, policies } = store();
        expect(() => policies.create(tax({ version: 2 }))).toThrow('must follow');
        expect(() => policies.create(tax({ jurisdictionId: 'missing' }))).toThrow('Jurisdiction does not exist');
        expect(() => policies.create(tax({ calculation: { mode: 'basis-points', rateBps: 10_001,
            minimumGp: 0, maximumGp: 100 } }))).toThrow('rateBps');
        expect(() => policies.create(tax({ calculation: { mode: 'basis-points', rateBps: 100,
            minimumGp: 101, maximumGp: 100 } }))).toThrow('bounds');
        policies.close(); governance.close();
    });
});
