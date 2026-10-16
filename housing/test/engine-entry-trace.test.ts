import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { ThievingEvidenceStore, type EngineThievingEvidence } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome } from '../../thieving-procedures/engine-bridge.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog, loadHousingUnitCatalog } from '../config.js';
import { recordEngineHousingEntryTrace } from '../engine-entry-trace.js';
import { loadHousingSecurityPolicy } from '../security.js';
import { HousingTraceRollStore } from '../trace-roll-store.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
const at = '2030-01-01T10:00:00.000Z', later = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(name: string): string { const root = mkdtempSync(join(tmpdir(), 'housing-engine-trace-'));
    roots.push(root); return join(root, `${name}.sqlite`); }
const properties = loadPropertyCatalog(join(config, 'properties.json'));
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const policy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy,
    new Set(properties.properties.map(value => value.propertyId)));
const engineEvent: EngineThievingEvidence = { eventId: 'entry-one', playerUsername: 'thief1',
    procedureKind: 'property-burglary', target: { kind: 'loc', typeId: 4673,
        instanceIndex: null, name: 'Property door', x: 2969, z: 3328, level: 0 },
    effect: 'entry-completed', transferredItems: [], thievingXpDelta: 10,
    startedAtEngineTick: 100, endedAtEngineTick: 102, occurredAt: at,
    propertyAccess: { propertyId: 'falador.south-house', entryPointId: 'front-door',
        owner: { kind: 'player', id: 'victim' }, propertyStateVersion: 2,
        actorAuthorized: false, lockLevel: 35 } };

describe('engine-owned Property entry to housing trace', () => {
    test('uses exact persisted event, outcome and one durable roll on replay', () => {
        const source = new ThievingEvidenceStore(path('engine'));
        const thieving = new ThievingProcedureStore(path('thieving'));
        const rolls = new HousingTraceRollStore(path('rolls'), thieving);
        try {
            const event = source.append(engineEvent);
            ingestEngineThievingOutcome(event.eventId, source, thieving, () => 'agent-thief', later);
            const first = recordEngineHousingEntryTrace(event.eventId, source, thieving, rolls,
                properties, policy, hierarchy, effects, units, later);
            const editedCatalog = { ...properties, properties: properties.properties.map(value =>
                value.propertyId === 'falador.south-house' ? { ...value, security: { ...value.security,
                    lockLevel: 40 } } : value) };
            const again = recordEngineHousingEntryTrace(event.eventId, source, thieving, rolls,
                editedCatalog, policy, hierarchy, effects, units, '2030-01-01T10:02:00.000Z');
            expect(again).toEqual(first);
            expect(rolls.get('outcome:entry-one')).toMatchObject({ observationId: 'trace:entry-one',
                outcomeReceiptDigest: thieving.getOutcome('outcome:entry-one')!.receiptDigest });
            expect(first.observation?.suspectAgentId ?? null).toBeNull();
            expect(source.verifyChain()).toBeTrue();
            expect(thieving.verifyAuditChain()).toBeTrue();
            expect(rolls.verifyAuditChain()).toBeTrue();
        } finally { rolls.close(); thieving.close(); source.close(); }
    });
    test('rejects authorized entry and mismatched Property coordinates before issuing a roll', () => {
        const source = new ThievingEvidenceStore(path('engine'));
        const thieving = new ThievingProcedureStore(path('thieving'));
        const rolls = new HousingTraceRollStore(path('rolls'), thieving);
        try {
            const authorized = source.append({ ...engineEvent, propertyAccess: { ...engineEvent.propertyAccess!,
                actorAuthorized: true } });
            ingestEngineThievingOutcome(authorized.eventId, source, thieving, () => 'agent-thief', later);
            expect(() => recordEngineHousingEntryTrace(authorized.eventId, source, thieving, rolls,
                properties, policy, hierarchy, effects, units, later)).toThrow('denied Property burglary');
            expect(rolls.get('outcome:entry-one')).toBeNull();
            const other = source.append({ ...engineEvent, eventId: 'entry-two',
                target: { ...engineEvent.target, x: 2970 } });
            ingestEngineThievingOutcome(other.eventId, source, thieving, () => 'agent-thief', later);
            expect(() => recordEngineHousingEntryTrace(other.eventId, source, thieving, rolls,
                properties, policy, hierarchy, effects, units, later)).toThrow('does not match');
            expect(rolls.get('outcome:entry-two')).toBeNull();
        } finally { rolls.close(); thieving.close(); source.close(); }
    });
    test('keeps legacy entry evidence readable but refuses a new trace without a lock snapshot', () => {
        const source = new ThievingEvidenceStore(path('engine'));
        const thieving = new ThievingProcedureStore(path('thieving'));
        const rolls = new HousingTraceRollStore(path('rolls'), thieving);
        try {
            const { lockLevel: _legacyMissing, ...oldAccess } = engineEvent.propertyAccess!;
            const event = source.append({ ...engineEvent, propertyAccess: oldAccess });
            expect(source.verifyChain()).toBeTrue();
            ingestEngineThievingOutcome(event.eventId, source, thieving, () => 'agent-thief', later);
            expect(() => recordEngineHousingEntryTrace(event.eventId, source, thieving, rolls,
                properties, policy, hierarchy, effects, units, later)).toThrow('event-time lock level');
            expect(rolls.get('outcome:entry-one')).toBeNull();
        } finally { rolls.close(); thieving.close(); source.close(); }
    });
});
