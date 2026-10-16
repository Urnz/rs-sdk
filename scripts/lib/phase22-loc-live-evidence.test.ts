import { describe, expect, test } from 'bun:test';
import { matchLiveLocProcedure, waitForLiveLocProcedure } from '../run-phase22-procedures-live.js';
import type { SkillRunResult } from '../../agent-skills/types.js';
import type { EngineThievingEvidenceRecord } from '../../server/engine/src/mods/ThievingEvidenceStore.js';

function fixture() {
    const run = { username: 'testactor', status: 'completed', skill: { id: 'procedure.thieving.lockpick-door', version: '1.0.0' },
        events: [{ type: 'step.succeeded', operation: 'thieve-lockpick', data: { outcome: 'succeeded',
            target: { kind: 'loc', id: 2550, name: 'Door', x: 2674, z: 3305 }, thievingXpDelta: 95, inventoryDelta: [] } }] } as unknown as SkillRunResult;
    const event = { eventId: 'engine:one', playerUsername: 'testactor', procedureKind: 'lockpick-door', effect: 'lock-opened',
        target: { kind: 'loc', typeId: 2550, instanceIndex: null, name: 'Door', x: 2674, z: 3305, level: 0 },
        thievingXpDelta: 950, transferredItems: [] } as unknown as EngineThievingEvidenceRecord;
    return { run, event };
}
describe('live loc journal correlation', () => {
    test('waits for delayed real engine commit without relaxing exact matching', async () => {
        const { run, event } = fixture(); let waits = 0, reads = 0;
        const matched = await waitForLiveLocProcedure(run, 'lockpick-door', () => { reads++; return waits < 2 ? [] : [event]; },
            async () => { waits++; });
        expect(matched).toEqual(event); expect(waits).toBe(2); expect(reads).toBe(3);
    });
    test('missing evidence stops after six ticks with no inferred success', async () => {
        const { run } = fixture(); let waits = 0;
        await expect(waitForLiveLocProcedure(run, 'lockpick-door', () => [], async () => { waits++; }))
            .rejects.toThrow('no authoritative outcome');
        expect(waits).toBe(6);
    });
    test('wrong or ambiguous authoritative source fails immediately, never retried into a match', async () => {
        const { run, event } = fixture(); let waits = 0;
        for (const candidates of [[{ ...event, playerUsername: 'other' }], [{ ...event, effect: 'entry-completed' }],
            [{ ...event, target: { ...event.target, x: 2675 } }], [{ ...event, thievingXpDelta: 500 }],
            [{ ...event, transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 1 }] }], [event, event]]) {
            await expect(waitForLiveLocProcedure(run, 'lockpick-door', () => candidates as EngineThievingEvidenceRecord[],
                async () => { waits++; })).rejects.toThrow('No unique exact');
        }
        expect(waits).toBe(0);
    });
    test('whole-XP client flooring permits less than one XP of quantization only', () => {
        const { run, event } = fixture();
        expect(matchLiveLocProcedure(run, 'lockpick-door', [{ ...event, thievingXpDelta: 958 }])).toEqual({ ...event, thievingXpDelta: 958 });
        expect(() => matchLiveLocProcedure(run, 'lockpick-door', [{ ...event, thievingXpDelta: 960 }])).toThrow('No unique exact');
    });
});
