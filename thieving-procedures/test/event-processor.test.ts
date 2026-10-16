import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { RightsViolationStore } from '../../rights-violations/store.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog,
    loadHousingUnitCatalog } from '../../housing/config.js';
import { loadHousingSecurityPolicy } from '../../housing/security.js';
import { HousingTraceRollStore } from '../../housing/trace-roll-store.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { ThievingEvidenceStore, type EngineThievingEvidence } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { processEngineThievingBatch, resolveBoundAvatarAgent } from '../event-processor.js';
import { runThievingProcessorPage, ThievingEventCursorStore } from '../cursor-store.js';
import { ThievingProcedureStore } from '../store.js';
import { validateWitnessAttentionPolicy } from '../witness-attention.js';
import { WitnessAttentionDecisionStore } from '../witness-decision-store.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
const at = '2030-01-01T10:00:00.000Z', later = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(name: string): string { const root = mkdtempSync(join(tmpdir(), 'thieving-processor-'));
    roots.push(root); return join(root, `${name}.sqlite`); }
const properties = loadPropertyCatalog(join(config, 'properties.json'));
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const securityPolicy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy,
    new Set(properties.properties.map(value => value.propertyId)));
const witnessPolicy = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'certain-attention',
    version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });
const entry: EngineThievingEvidence = { eventId: 'entry-1', playerUsername: 'thief1',
    procedureKind: 'property-burglary', target: { kind: 'loc', typeId: 4673, instanceIndex: null,
        name: 'Property door', x: 2969, z: 3328, level: 0 }, effect: 'entry-completed',
    transferredItems: [], thievingXpDelta: 10, startedAtEngineTick: 100, endedAtEngineTick: 102,
    occurredAt: at, propertyAccess: { propertyId: 'falador.south-house', entryPointId: 'front-door',
        owner: { kind: 'player', id: 'victim' }, propertyStateVersion: 2, actorAuthorized: false, lockLevel: 35 },
    sightSnapshot: { actor: { x: 2969, z: 3328, level: 0 }, radius: 15,
        candidates: [{ username: 'nearby', x: 2970, z: 3328, level: 0 },
            { username: 'human1', x: 2971, z: 3328, level: 0 }] } };
function identity(agents: AgentStateStore, agentId: string, playerUsername: string): void {
    agents.createIdentity({ agentId, playerUsername, displayName: agentId,
        background: 'Test agent.', personalityTraits: ['careful'] }, at);
}

describe('bounded engine Thieving event processor', () => {
    test('promotes pickpocket, lockpick and container theft without inventing discovery or Property violations', () => {
        const source = new ThievingEvidenceStore(path('other-source'));
        const thieving = new ThievingProcedureStore(path('other-thieving'));
        const agents = new AgentStateStore(path('other-agents'));
        const rights = new RightsViolationStore(path('other-rights'));
        const traceRolls = new HousingTraceRollStore(path('other-trace'), thieving);
        const witnessDecisions = new WitnessAttentionDecisionStore(path('other-witness'), source, thieving, witnessPolicy);
        const cursor = new ThievingEventCursorStore(path('other-cursor'), source, thieving);
        try {
            identity(agents, 'agent-thief', 'thief1');
            for (const kind of ['pickpocket', 'lockpick-door', 'container-theft'] as const)
                source.append({ ...entry, eventId: `quiet-${kind}`, procedureKind: kind,
                    target: { kind: kind === 'pickpocket' ? 'npc' : 'loc', typeId: 1,
                        instanceIndex: kind === 'pickpocket' ? 4 : null,
                        name: kind, x: 2969, z: 3328, level: 0 },
                    effect: kind === 'lockpick-door' ? 'lock-opened' : 'item-transfer',
                    transferredItems: kind === 'lockpick-door' ? [] : [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
                    propertyAccess: undefined, sightSnapshot: undefined });
            source.append({ ...entry, eventId: 'misclassified-container', procedureKind: 'container-theft',
                target: { kind: 'npc', typeId: 2, instanceIndex: 5,
                    name: 'Historical target', x: 2969, z: 3328, level: 0 }, effect: 'item-transfer',
                transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], propertyAccess: undefined });
            const deps = { source, thieving, agents, rights, witnessDecisions, traceRolls,
                properties, units, hierarchy, effects, securityPolicy, witnessPolicy };
            expect(runThievingProcessorPage(deps, cursor, 10, later)).toMatchObject({ nextSequence: 4, blockedEventId: null });
            for (const event of source.listAfter(0)) {
                expect(thieving.getOutcome(`outcome:${event.eventId}`)).toMatchObject({
                    actorAgentId: 'agent-thief', procedureKind: event.procedureKind, effect: event.effect,
                    target: event.target, transferredItems: event.transferredItems, sourceEvidenceDigest: event.eventDigest });
                expect(thieving.listDiscoveries(`outcome:${event.eventId}`)).toEqual([]);
            }
            expect(witnessDecisions.get('misclassified-container', 'nearby')).toBeNull();
            expect(rights.list()).toEqual([]);
            expect(runThievingProcessorPage(deps, cursor, 10, later).processed).toEqual([]);
            expect(cursor.verifyAuditChain()).toBeTrue();
        } finally { cursor.close(); witnessDecisions.close(); traceRolls.close(); rights.close();
            agents.close(); thieving.close(); source.close(); }
    });

    test('resolves exact agent avatars, audits an unbound actor skip and continues the global stream', () => {
        const source = new ThievingEvidenceStore(path('source'));
        const thieving = new ThievingProcedureStore(path('thieving'));
        const agents = new AgentStateStore(path('agents'));
        const rights = new RightsViolationStore(path('rights'));
        const traceRolls = new HousingTraceRollStore(path('trace'), thieving);
        const witnessDecisions = new WitnessAttentionDecisionStore(path('witness'), source, thieving, witnessPolicy);
        const cursorPath = path('cursor');
        let cursor = new ThievingEventCursorStore(cursorPath, source, thieving);
        try {
            identity(agents, 'agent-thief', 'thief1');
            identity(agents, 'agent-nearby', 'nearby');
            identity(agents, 'agent-victim', 'victim');
            expect(resolveBoundAvatarAgent(agents, 'THIEF1')).toBe('agent-thief');
            expect(resolveBoundAvatarAgent(agents, 'human1')).toBeNull();
            source.append(entry);
            source.append({ ...entry, eventId: 'pick-2', playerUsername: 'latebot', procedureKind: 'pickpocket',
                target: { kind: 'npc', typeId: 1, instanceIndex: 4,
                    name: 'Man', x: 2969, z: 3329, level: 0 }, effect: 'item-transfer',
                transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
                propertyAccess: undefined, sightSnapshot: undefined });
            source.append({ ...entry, eventId: 'pick-3', procedureKind: 'pickpocket',
                target: { kind: 'npc', typeId: 2, instanceIndex: 5,
                    name: 'Woman', x: 2970, z: 3329, level: 0 }, effect: 'item-transfer',
                transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 4 }],
                propertyAccess: undefined, sightSnapshot: undefined });
            expect(() => cursor.advance({ nextSequence: 1, blockedEventId: null, skipped: [], processed: [{
                sequence: 1, eventId: 'entry-1', outcomeReceiptId: 'outcome:entry-1',
                traceDiscovered: null, noticedObservers: [], playerOnlyObservers: [], rightsProjection: 'recorded' }] }, later))
                .toThrow('does not match the next engine events');
            expect(cursor.current()).toBe(0);
            const deps = { source, thieving, agents, rights, witnessDecisions, traceRolls,
                properties, units, hierarchy, effects, securityPolicy, witnessPolicy };
            const first = runThievingProcessorPage(deps, cursor, 10, later);
            expect(first).toMatchObject({ nextSequence: 3, blockedEventId: null,
                processed: [{ eventId: 'entry-1', outcomeReceiptId: 'outcome:entry-1',
                    noticedObservers: ['human1', 'nearby'], playerOnlyObservers: ['human1'] },
                { eventId: 'pick-3', outcomeReceiptId: 'outcome:pick-3' }],
                skipped: [{ eventId: 'pick-2', reason: 'unbound-actor' }] });
            expect(typeof first.processed[0]!.traceDiscovered).toBe('boolean');
            expect(cursor.current()).toBe(3);
            expect(thieving.getOutcome('outcome:entry-1')).not.toBeNull();
            expect(witnessDecisions.get('entry-1', 'nearby')).not.toBeNull();
            expect(witnessDecisions.get('entry-1', 'human1')).toMatchObject({
                observerUsername: 'human1', observerAgentId: null });
            expect(thieving.listDiscoveries('outcome:entry-1'))
                .toHaveLength(first.processed[0]!.traceDiscovered ? 3 : 2);
            identity(agents, 'agent-human', 'human1');
            cursor.close();
            cursor = new ThievingEventCursorStore(cursorPath, source, thieving);
            expect(cursor.current()).toBe(3);
            expect(cursor.verifyAuditChain()).toBeTrue();
            const replay = processEngineThievingBatch(deps, 0, 10, '2030-01-01T10:02:00.000Z');
            expect(replay).toEqual(first);
            identity(agents, 'agent-late', 'latebot');
            const resumed = runThievingProcessorPage(deps, cursor, 10,
                '2030-01-01T10:03:00.000Z');
            expect(resumed).toMatchObject({ nextSequence: 3, blockedEventId: null,
                processed: [], skipped: [] });
            expect(thieving.getOutcome('outcome:pick-2')).toBeNull();
            expect(cursor.getSkipped('pick-2', source.get('pick-2')!.eventDigest)).toMatchObject({ reason: 'unbound-actor' });
            expect(cursor.current()).toBe(3);
            expect(cursor.verifyAuditChain()).toBeTrue();
            expect(traceRolls.verifyAuditChain()).toBeTrue();
            expect(witnessDecisions.verifyAuditChain()).toBeTrue();
            expect(thieving.verifyAuditChain()).toBeTrue();
            const database = new Database(cursorPath);
            try { database.run('UPDATE thieving_event_cursor SET to_sequence=10 WHERE sequence=1');
            } finally { database.close(); }
            expect(cursor.verifyAuditChain()).toBeFalse();
            expect(() => runThievingProcessorPage(deps, cursor, 10, later)).toThrow('cursor or source audit');
        } finally { cursor.close(); witnessDecisions.close(); traceRolls.close(); rights.close(); agents.close();
            thieving.close(); source.close(); }
    });
});
