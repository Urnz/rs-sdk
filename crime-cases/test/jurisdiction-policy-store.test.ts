import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GovernanceStore } from '../../server/gateway/admin/governance.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore, CrimeEvidenceStore, JurisdictionCrimePolicyStore,
    createJurisdictionFindingVerifier } from '../index.js';

const roots: string[] = [];
const t0 = '2030-01-01T09:00:00.000Z', t1 = '2030-01-01T10:00:00.000Z';
const t2 = '2030-01-01T11:00:00.000Z', t3 = '2030-01-01T12:00:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() { const root = mkdtempSync(join(tmpdir(), 'crime-policy-store-')); roots.push(root);
    return { governance: join(root, 'governance.sqlite'), thieving: join(root, 'thieving.sqlite'),
        cases: join(root, 'cases.sqlite'), evidence: join(root, 'evidence.sqlite') }; }
function setup() {
    const path = paths(), governance = new GovernanceStore(path.governance);
    governance.createFaction({ factionId: 'city', kind: 'city', name: 'City' }, t0);
    governance.createJurisdiction({ jurisdictionId: 'city-law', factionId: 'city',
        kind: 'city', name: 'City law' }, t0);
    governance.assignTerritory({ territoryId: 'city-map', jurisdictionId: 'city-law',
        level: 0, minX: 3200, maxX: 3250, minZ: 3200, maxZ: 3250 }, t0);
    const policies = new JurisdictionCrimePolicyStore(path.governance);
    return { path, governance, policies };
}
function create(policies: JurisdictionCrimePolicyStore, policyId: string, version: number,
    responsibleEvidenceKinds: Array<'direct-identification' | 'physical-trace'> = ['direct-identification']) {
    return policies.create({ policyId, jurisdictionId: 'city-law', version,
        responsibleEvidenceKinds, createdByAgentId: 'city-clerk' }, t0);
}

describe('persistent jurisdiction crime policy', () => {
    test('keeps distinct rules for independent jurisdiction families', () => {
        const { governance, policies } = setup();
        try {
            governance.createFaction({ factionId: 'manor', kind: 'manor', name: 'Manor' }, t0);
            governance.createJurisdiction({ jurisdictionId: 'manor-law', factionId: 'manor',
                kind: 'manor', name: 'Manor law' }, t0);
            const city = create(policies, 'city-v1', 1);
            const manor = policies.create({ policyId: 'manor-v1', jurisdictionId: 'manor-law', version: 1,
                responsibleEvidenceKinds: ['direct-identification', 'physical-trace'],
                createdByAgentId: 'manor-steward' }, t0);
            policies.activate(city.policyId, city.revision, 'city-judge', t1);
            policies.activate(manor.policyId, manor.revision, 'manor-judge', t1);
            expect(policies.listEffectiveAt('city-law', t1)[0]?.responsibleEvidenceKinds)
                .toEqual(['direct-identification']);
            expect(policies.listEffectiveAt('manor-law', t1)[0]?.responsibleEvidenceKinds)
                .toEqual(['direct-identification', 'physical-trace']);
            expect(policies.verifyAuditChain()).toBeTrue();
        } finally { policies.close(); governance.close(); }
    });

    test('atomically versions, activates, supersedes and retains historical rules', () => {
        const { path, governance, policies } = setup();
        try {
            const first = create(policies, 'city-v1', 1);
            expect(first.status).toBe('draft');
            expect(policies.listEffectiveAt('city-law', t1)).toEqual([]);
            expect(policies.create({ policyId: 'city-v1', jurisdictionId: 'city-law', version: 1,
                responsibleEvidenceKinds: ['direct-identification'], createdByAgentId: 'city-clerk' }, t0))
                .toEqual(first);
            expect(() => create(policies, 'city-v3', 3)).toThrow('must follow');
            policies.activate('city-v1', first.revision, 'city-judge', t1);
            const second = create(policies, 'city-v2', 2, ['direct-identification', 'physical-trace']);
            policies.activate('city-v2', second.revision, 'city-judge', t2);
            expect(policies.get('city-v1')).toMatchObject({ status: 'superseded', endedAt: t2 });
            expect(policies.listEffectiveAt('city-law', t1)[0]).toMatchObject({
                policyId: 'city-v1', responsibleEvidenceKinds: ['direct-identification'] });
            expect(policies.listEffectiveAt('city-law', t2)[0]).toMatchObject({
                policyId: 'city-v2', responsibleEvidenceKinds: ['direct-identification', 'physical-trace'] });
            expect(policies.activate('city-v2', 1, 'city-judge', t2).policyId).toBe('city-v2');
            expect(policies.listAudit().map(entry => entry.action))
                .toEqual(['created', 'activated', 'created', 'superseded', 'activated']);
            expect(policies.verifyAuditChain()).toBeTrue();
            policies.close();
            const reopened = new JurisdictionCrimePolicyStore(path.governance);
            expect(reopened.verifyAuditChain()).toBeTrue();
            expect(reopened.listEffectiveAt('city-law', t1)[0]?.policyId).toBe('city-v1');
            reopened.close();
        } finally { governance.close(); }
    });

    test('revocation closes future effect without rewriting an earlier incident', () => {
        const { governance, policies } = setup();
        try {
            const draft = create(policies, 'city-v1', 1);
            const active = policies.activate('city-v1', draft.revision, 'city-judge', t1);
            policies.revoke('city-v1', active.revision, 'city-judge', t2);
            expect(policies.listEffectiveAt('city-law', t1)[0]?.policyId).toBe('city-v1');
            expect(policies.listEffectiveAt('city-law', t2)).toEqual([]);
            expect(policies.revoke('city-v1', 1, 'city-judge', t3).status).toBe('revoked');
            expect(policies.verifyAuditChain()).toBeTrue();
        } finally { policies.close(); governance.close(); }
    });

    test('rejects disabled-faction writes, stale revision and tampered audit rows', () => {
        const { path, governance, policies } = setup();
        try {
            const draft = create(policies, 'city-v1', 1);
            expect(() => policies.activate('city-v1', 99, 'city-judge', t1)).toThrow('changed');
            expect(policies.listAudit()).toHaveLength(1);
            governance.setFactionStatus('city', 1, 'disabled', 'city-judge', 'Court closed today', t1);
            expect(() => policies.activate('city-v1', draft.revision, 'city-judge', t1))
                .toThrow('disabled');
            governance.setFactionStatus('city', 2, 'active', 'city-judge', 'Court reopened today', t2);
            policies.activate('city-v1', draft.revision, 'city-judge', t2);
            const db = new Database(path.governance, { strict: true });
            db.run("UPDATE governance_crime_policy_audit SET actor_agent_id='intruder' WHERE sequence=2");
            db.close(true);
            expect(policies.verifyAuditChain()).toBeFalse();
            expect(() => policies.listEffectiveAt('city-law', t2)).toThrow('audit chain');
        } finally { policies.close(); governance.close(); }
    });

    test('migrates a v8 Governance database additively and rejects unknown future schema', () => {
        const path = paths().governance;
        const initial = new GovernanceStore(path);
        initial.createFaction({ factionId: 'city', kind: 'city', name: 'City' }, t0);
        initial.close();
        const legacy = new Database(path, { strict: true });
        legacy.run('DROP TABLE governance_fine_policy_audit');
        legacy.run('DROP INDEX governance_active_fine_policy');
        legacy.run('DROP TABLE governance_fine_policy');
        legacy.run('DROP TABLE governance_crime_policy_audit');
        legacy.run('DROP TABLE governance_crime_policy');
        legacy.run('UPDATE governance_schema SET version=8 WHERE singleton=1');
        legacy.close(true);
        const migrated = new GovernanceStore(path);
        expect(migrated.getFaction('city')?.name).toBe('City');
        migrated.close();
        const db = new Database(path, { strict: true });
        expect(db.query('SELECT version FROM governance_schema WHERE singleton=1').get())
            .toEqual({ version: 10 });
        db.run('UPDATE governance_schema SET version=11 WHERE singleton=1');
        db.close(true);
        expect(() => new GovernanceStore(path)).toThrow('Unsupported governance schema version');
    });

    test('finding verifier reads historical persisted policy and still requires authority', () => {
        const { path, governance, policies } = setup();
        const thieving = new ThievingProcedureStore(path.thieving);
        const cases = new CrimeCaseStore(path.cases, thieving);
        const evidence = new CrimeEvidenceStore(path.evidence, cases, thieving);
        try {
            const draft = create(policies, 'city-v1', 1);
            const active = policies.activate('city-v1', draft.revision, 'city-judge', t0);
            const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-1',
                procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0',
                procedureKind: 'pickpocket', actorAgentId: 'thief', playerUsername: 'Thief1',
                target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man',
                    x: 3222, z: 3218, level: 0 }, result: 'succeeded', effect: 'item-transfer',
                transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
                startedAtEngineTick: 1, endedAtEngineTick: 2, sourceEventId: 'event-1',
                sourceEvidenceDigest: 'b'.repeat(64), occurredAt: t1 };
            thieving.recordOutcome('receipt-1', outcome, () => true, t1);
            thieving.recordDiscovery('observation-1', { evidenceId: 'engine-witness',
                outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'guard',
                actorIdentification: 'direct', suspectAgentId: 'thief', facts: ['Witnessed theft.'],
                sourceEvidenceDigest: 'c'.repeat(64), occurredAt: t1 }, () => true, t1);
            cases.recordDiscovery('case-1', 'discovery-1', 'observation-1', t1);
            cases.recordIdentification('case-1', 'identification-1', 'observation-1', t1);
            evidence.recordCaseEvidence('proof-1', 'identification-1', t1);
            const second = create(policies, 'city-v2', 2, ['direct-identification', 'physical-trace']);
            policies.activate('city-v2', second.revision, 'city-judge', t2);
            const request = { findingId: 'finding-1', caseId: 'case-1', jurisdictionId: 'city-law',
                suspectAgentId: 'thief', conclusion: 'responsible' as const, evidenceIds: ['proof-1'],
                policyId: 'city-v1', policyDigest: active.policyDigest!,
                authorityEvidenceDigest: 'd'.repeat(64), occurredAt: t3 };
            const verifier = createJurisdictionFindingVerifier(policies, { governance, cases, thieving,
                verifyAuthority: () => 'd'.repeat(64) });
            expect(evidence.recordFinding(request, verifier, t3).policyId).toBe('city-v1');
            expect(evidence.verifyAuditChain()).toBeTrue();
        } finally { evidence.close(); cases.close(); thieving.close(); policies.close(); governance.close(); }
    });
});
