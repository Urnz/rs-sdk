import { expect, test } from 'bun:test';
import type { SkillRunResult } from '../../agent-skills/types.js';
import type { EngineThievingEvidenceRecord } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { matchLivePickpocket } from './phase22-live-evidence.js';

const run: SkillRunResult = { runId: 'run', username: 'testbot', skill: { id: 'procedure.thieving.pickpocket', version: '1.0.0' },
    status: 'completed', reason: 'completed', message: '', operations: 1, durationMs: 100,
    events: [{ runId: 'run', type: 'step.succeeded', timestamp: '2026-09-26T19:00:00.000Z',
        skill: { id: 'procedure.thieving.pickpocket', version: '1.0.0' }, operation: 'thieve-pickpocket',
        data: { outcome: 'succeeded', target: { kind: 'npc', id: 1, index: 4, name: 'Man' },
            inventoryDelta: [{ id: 995, delta: 3 }] } }] };
const event: EngineThievingEvidenceRecord = { eventId: 'engine', playerUsername: 'testbot', procedureKind: 'pickpocket',
    target: { kind: 'npc', typeId: 1, instanceIndex: 4, name: 'Man', x: 3222, z: 3218, level: 0 },
    effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 80,
    startedAtEngineTick: 10, endedAtEngineTick: 11, occurredAt: '2026-09-26T19:00:00.000Z',
    eventDigest: 'digest', previousHash: 'previous', recordHash: 'record' };

test('live correlation requires one exact NPC instance and item delta', () => {
    expect(matchLivePickpocket(run, [event])).toBe(event);
    expect(() => matchLivePickpocket(run, [])).toThrow('no unique exact');
    expect(() => matchLivePickpocket(run, [event, { ...event, eventId: 'other' }])).toThrow('no unique exact');
});
test('live correlation rejects other actors, target types/instances, effects and item gains', () => {
    for (const candidate of [{ ...event, playerUsername: 'other' },
        { ...event, target: { ...event.target, typeId: 2 } },
        { ...event, target: { ...event.target, instanceIndex: 5 } },
        { ...event, effect: 'entry-completed' as const }, { ...event, thievingXpDelta: 0 },
        { ...event, transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 6 }] }])
        expect(() => matchLivePickpocket(run, [candidate])).toThrow('no unique exact');
});
test('failed runs and missing or nonpositive SDK observations cannot become acceptance', () => {
    expect(() => matchLivePickpocket({ ...run, status: 'failed' }, [event])).toThrow('Completed exact-version');
    expect(() => matchLivePickpocket({ ...run, events: [] }, [event])).toThrow('One successful');
    for (const delta of [0, -3]) {
        const modified = structuredClone(run);
        modified.events[0]!.data!.inventoryDelta = [{ id: 995, delta }];
        expect(() => matchLivePickpocket(modified, [event])).toThrow('positive inventory');
    }
});
