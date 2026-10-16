import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GovernanceStore } from '../../server/gateway/admin/governance.js';
import { JurisdictionFinePolicyStore, digestJurisdictionFinePolicy } from '../index.js';

const roots: string[] = [];
const t0 = '2030-01-01T09:00:00.000Z', t1 = '2030-01-01T10:00:00.000Z';
const t2 = '2030-01-01T11:00:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
    const root = mkdtempSync(join(tmpdir(), 'fine-policy-store-')); roots.push(root);
    const path = join(root, 'governance.sqlite'), governance = new GovernanceStore(path);
    governance.createFaction({ factionId: 'city', kind: 'city', name: 'City' }, t0);
    governance.createJurisdiction({ jurisdictionId: 'city-law', factionId: 'city',
        kind: 'city', name: 'City law' }, t0);
    return { path, governance, policies: new JurisdictionFinePolicyStore(path) };
}
function create(policies: JurisdictionFinePolicyStore, policyId: string, version: number,
    maxFineGp = 20) {
    return policies.create({ policyId, jurisdictionId: 'city-law', version, maxFineGp,
        createdByAgentId: 'city-clerk' }, t0);
}

describe('persistent jurisdiction fine policy', () => {
    test('versions, supersedes and preserves incident-time caps after reopening', () => {
        const { path, governance, policies } = setup();
        try {
            const first = create(policies, 'fine-v1', 1);
            expect(first.status).toBe('draft');
            expect(policies.listEffectiveAt('city-law', t1)).toEqual([]);
            expect(create(policies, 'fine-v1', 1)).toEqual(first);
            expect(() => create(policies, 'fine-v3', 3)).toThrow('must follow');
            const activated = policies.activate(first.policyId, first.revision, 'city-judge', t1);
            expect(activated.policyDigest).toBe(digestJurisdictionFinePolicy({ schemaVersion: 1,
                policyId: 'fine-v1', jurisdictionId: 'city-law', version: 1, createdAt: t0,
                effectiveFrom: t1, maxFineGp: 20 }));
            const second = create(policies, 'fine-v2', 2, 40);
            policies.activate(second.policyId, second.revision, 'city-judge', t2);
            expect(policies.get('fine-v1')).toMatchObject({ status: 'superseded', endedAt: t2 });
            expect(policies.listEffectiveAt('city-law', t1)[0]?.maxFineGp).toBe(20);
            expect(policies.listEffectiveAt('city-law', t2)[0]?.maxFineGp).toBe(40);
            expect(policies.activate('fine-v2', 1, 'city-judge', t2).policyId).toBe('fine-v2');
            expect(policies.listAudit().map(entry => entry.action))
                .toEqual(['created', 'activated', 'created', 'superseded', 'activated']);
            expect(policies.verifyAuditChain()).toBeTrue();
            policies.close();
            const reopened = new JurisdictionFinePolicyStore(path);
            expect(reopened.listEffectiveAt('city-law', t1)[0]?.policyId).toBe('fine-v1');
            reopened.close();
        } finally { governance.close(); }
    });

    test('revocation closes future effect without retroactively changing a past incident', () => {
        const { governance, policies } = setup();
        try {
            const draft = create(policies, 'fine-v1', 1);
            const active = policies.activate(draft.policyId, draft.revision, 'city-judge', t1);
            policies.revoke(active.policyId, active.revision, 'city-judge', t2);
            expect(policies.listEffectiveAt('city-law', t1)).toHaveLength(1);
            expect(policies.listEffectiveAt('city-law', t2)).toEqual([]);
            expect(policies.verifyAuditChain()).toBeTrue();
        } finally { policies.close(); governance.close(); }
    });

    test('rejects a disabled faction, invalid limits and retroactive activation', () => {
        const { governance, policies } = setup();
        try {
            expect(() => create(policies, 'fine-v1', 1, 0)).toThrow('limit');
            const draft = create(policies, 'fine-v1', 1);
            expect(() => policies.activate(draft.policyId, draft.revision, 'judge',
                '2029-12-31T00:00:00.000Z')).toThrow('predates');
            governance.setFactionStatus('city', 1, 'disabled', 'judge', 'Court closed', t1);
            expect(() => policies.activate(draft.policyId, draft.revision, 'judge', t2))
                .toThrow('disabled');
            expect(policies.listEffectiveAt('city-law', t2)).toEqual([]);
        } finally { policies.close(); governance.close(); }
    });

    test('fails closed on policy or audit tampering', () => {
        const { path, governance, policies } = setup();
        try {
            const draft = create(policies, 'fine-v1', 1);
            policies.activate(draft.policyId, draft.revision, 'judge', t1);
            const db = new Database(path);
            db.run("UPDATE governance_fine_policy SET max_fine_gp=1000 WHERE policy_id='fine-v1'");
            db.close();
            expect(policies.verifyAuditChain()).toBeFalse();
            expect(() => policies.listEffectiveAt('city-law', t1)).toThrow('audit chain');
        } finally { policies.close(); governance.close(); }
    });

    test('migrates a v9 database in place without touching existing jurisdiction data', () => {
        const { path, governance, policies } = setup();
        policies.close(); governance.close();
        const db = new Database(path);
        db.run('DROP TABLE governance_fine_policy_audit');
        db.run('DROP INDEX governance_active_fine_policy');
        db.run('DROP TABLE governance_fine_policy');
        db.run('UPDATE governance_schema SET version=9 WHERE singleton=1');
        db.close();
        const migrated = new GovernanceStore(path);
        try {
            expect(migrated.getJurisdiction('city-law')?.factionId).toBe('city');
            const fine = new JurisdictionFinePolicyStore(path);
            expect(create(fine, 'fine-v1', 1).status).toBe('draft');
            fine.close();
            const check = new Database(path);
            expect((check.query('SELECT version FROM governance_schema').get() as { version: number }).version)
                .toBe(10);
            check.close();
        } finally { migrated.close(); }
    });
});
