import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CrimeCaseStore, CrimeEvidenceStore } from '../../crime-cases/index.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog, loadHousingUnitCatalog } from '../config.js';
import { loadHousingSecurityPolicy, projectHousingSecurity } from '../security.js';
import { recordHousingEntryTrace, type HousingPropertyAccessEvidence } from '../trace-discovery.js';
import { HousingTraceRollStore } from '../trace-roll-store.js';
import type { HousingAttackSurfaceObservation } from '../types.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
const at = '2030-01-01T10:00:00.000Z', later = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(name: string): string { const root = mkdtempSync(join(tmpdir(), 'housing-trace-'));
    roots.push(root); return join(root, `${name}.sqlite`); }
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const policy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy, new Set(['falador.south-house']));
const sourceDigest = 'a'.repeat(64);
const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence-1',
    procedureId: 'procedure.thieving.property-burglary', procedureVersion: '0.1.0',
    procedureKind: 'property-burglary', actorAgentId: 'hidden-thief', playerUsername: 'Thief1',
    target: { kind: 'loc', typeId: 100, instanceIndex: null, name: 'Door', x: 3000, z: 3000, level: 0 },
    result: 'succeeded', effect: 'entry-completed', transferredItems: [], thievingXpDelta: 1,
    startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event-1',
    sourceEvidenceDigest: sourceDigest, occurredAt: at };
const surface: HousingAttackSurfaceObservation = { observationId: 'surface-1', kind: 'property-entry',
    housingUnitId: 'falador.south-house.main', storageSurfaceId: null, storageSlots: 0,
    propertyLockLevel: 35, sourceEvidenceDigest: sourceDigest };
const access: HousingPropertyAccessEvidence = { sourceEventId: 'engine-event-1',
    sourceEvidenceDigest: sourceDigest, propertyId: 'falador.south-house', propertyStateVersion: 2,
    actorAuthorized: false, owner: { kind: 'player', id: 'victim' } };
function store(): ThievingProcedureStore { const active = new ThievingProcedureStore(path('thieving'));
    active.recordOutcome('receipt-1', outcome, () => true, at); return active; }
function run(active: ThievingProcedureStore, roll: number, observationId = 'trace-1',
    accessEvidence = access, surfaceEvidence = surface, verify = () => true) {
    return recordHousingEntryTrace(observationId, 'receipt-1', active, policy, hierarchy, effects, units,
        surfaceEvidence, accessEvidence, { roll, sourceEvidenceDigest: 'b'.repeat(64), occurredAt: later },
        verify, verify, verify, later);
}

describe('server-evidence-gated housing physical trace discovery', () => {
    test('persists one server roll across misses, replay and restart, bound to exact projection', () => {
        const thieving = store(), rollPath = path('roll');
        const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, () => true);
        let rolls = new HousingTraceRollStore(rollPath, thieving);
        try {
            const issued = rolls.issue('receipt-1', 'trace-1', security, later);
            expect(issued.roll).toBeGreaterThanOrEqual(0);
            expect(issued.roll).toBeLessThan(10_000);
            expect(rolls.issue('receipt-1', 'trace-1', security, '2030-01-01T10:02:00.000Z')).toEqual(issued);
            expect(() => rolls.issue('receipt-1', 'trace-2', security, later)).toThrow('different binding');
            expect(() => rolls.issue('receipt-1', 'trace-1', { ...security,
                projectionDigest: 'c'.repeat(64) }, later)).toThrow('different binding');
            expect(rolls.verifyAuditChain()).toBeTrue();
            rolls.close();
            rolls = new HousingTraceRollStore(rollPath, thieving);
            expect(rolls.get('receipt-1')).toEqual(issued);
            const verifyRoll = rolls.verifyRollFor.bind(rolls);
            const rollEvidence = { roll: issued.roll, occurredAt: issued.occurredAt,
                sourceEvidenceDigest: issued.sourceEvidenceDigest };
            const decision = recordHousingEntryTrace('trace-1', 'receipt-1', thieving, policy, hierarchy, effects,
                units, surface, access, rollEvidence, () => true, () => true, verifyRoll, later);
            expect(decision.discovered).toBe(issued.roll < security.traceBasisPoints);
            expect(decision.observation === null).toBe(!decision.discovered);
            expect(() => recordHousingEntryTrace('trace-2', 'receipt-1', thieving, policy, hierarchy, effects,
                units, surface, access, rollEvidence, () => true, () => true, verifyRoll, later))
                .toThrow('roll is not trusted');
            expect(() => recordHousingEntryTrace('trace-1', 'receipt-1', thieving, policy, hierarchy, effects,
                units, surface, access, { ...rollEvidence, roll: (issued.roll + 1) % 10_000 },
                () => true, () => true, verifyRoll, later)).toThrow('roll is not trusted');
        } finally { rolls.close(); thieving.close(); }
    });
    test('rejects unrelated outcomes and detects modified persistent rolls', () => {
        const thieving = store(), rollPath = path('roll');
        const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, () => true);
        const rolls = new HousingTraceRollStore(rollPath, thieving);
        try {
            expect(() => rolls.issue('missing', 'trace-1', security, later)).toThrow('successful Property burglary');
            expect(() => rolls.issue('receipt-1', 'trace-1', security, at.replace('10:00', '09:00')))
                .toThrow('does not bind');
            const issued = rolls.issue('receipt-1', 'trace-1', security, later);
            const database = new Database(rollPath);
            try { database.run('UPDATE housing_trace_roll SET roll=?1 WHERE outcome_receipt_id=?2',
                [(issued.roll + 1) % 10_000, 'receipt-1']);
            } finally { database.close(); }
            expect(rolls.verifyAuditChain()).toBeFalse();
            expect(rolls.verifyRollFor(issued, thieving.getOutcome('receipt-1')!,
                'trace-1', security.projectionDigest)).toBeFalse();
            expect(() => rolls.issue('receipt-1', 'trace-1', security, later)).toThrow('audit is invalid');
        } finally { rolls.close(); thieving.close(); }
    });
    test('records only a successful detected trace, then supports the independent case evidence chain', () => {
        const thieving = store();
        try { const detected = run(thieving, 1000);
            expect(detected.discovered).toBeTrue();
            expect(detected.observation).toMatchObject({ source: 'physical-trace', observerAgentId: null,
                actorIdentification: 'none', suspectAgentId: null });
            expect(JSON.stringify(detected.observation)).not.toContain('hidden-thief');
            expect(run(thieving, 1000)).toEqual(detected);
            const cases = new CrimeCaseStore(path('case'), thieving);
            try { const entry = cases.recordDiscovery('case-1', 'case-event-1', 'trace-1', later);
                expect(entry.suspectAgentId).toBeNull();
                const evidence = new CrimeEvidenceStore(path('evidence'), cases, thieving);
                try { expect(evidence.recordCaseEvidence('proof-1', 'case-event-1', later))
                    .toMatchObject({ kind: 'physical-trace', suspectAgentId: null });
                    expect(evidence.verifyAuditChain()).toBeTrue();
                } finally { evidence.close(); }
            } finally { cases.close(); }
        } finally { thieving.close(); }
    });
    test('returns a non-detection decision without creating observer knowledge', () => {
        const thieving = store();
        try { const missed = run(thieving, 9000);
            expect(missed).toMatchObject({ discovered: false, observation: null, traceBasisPoints: 3000 });
            expect(thieving.listDiscoveries('receipt-1')).toEqual([]);
            expect(thieving.verifyAuditChain()).toBeTrue();
        } finally { thieving.close(); }
    });
    test('rejects invented access, unrelated surfaces and untrusted rolls', () => {
        const thieving = store();
        try { expect(() => run(thieving, 1000, 'trace-1', { ...access, actorAuthorized: true }))
                .toThrow('denied Property access');
            expect(() => run(thieving, 1000, 'trace-1', { ...access, propertyId: 'other.house' }))
                .toThrow('denied Property access');
            expect(() => run(thieving, 1000, 'trace-1', access, { ...surface,
                sourceEvidenceDigest: 'c'.repeat(64) })).toThrow('does not bind');
            expect(() => run(thieving, 1000, 'trace-1', access, surface, () => false)).toThrow('not trusted');
            expect(() => recordHousingEntryTrace('trace-1', 'receipt-1', thieving, policy, hierarchy, effects, units,
                surface, access, { roll: 1000, sourceEvidenceDigest: 'b'.repeat(64), occurredAt: later },
                () => true, () => true, () => false, later)).toThrow('roll is not trusted');
            expect(thieving.listDiscoveries('receipt-1')).toEqual([]);
        } finally { thieving.close(); }
    });
    test('rejects an unrelated or unsuccessful Thieving outcome', () => {
        const thieving = store();
        try { thieving.recordOutcome('receipt-2', { ...outcome, evidenceId: 'engine-evidence-2',
                sourceEventId: 'engine-event-2', procedureKind: 'lockpick-door', effect: 'lock-opened' },
            () => true, at);
            expect(() => recordHousingEntryTrace('trace-2', 'receipt-2', thieving, policy, hierarchy, effects, units,
                surface, access, { roll: 1000, sourceEvidenceDigest: 'b'.repeat(64), occurredAt: later },
                () => true, () => true, () => true, later)).toThrow('successful Property burglary');
        } finally { thieving.close(); }
    });
});
