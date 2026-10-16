import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingEvidenceStore } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome, ThievingProcedureStore } from '../index.js';

const paths: string[] = [];
function path(name: string): string {
    const value = join(tmpdir(), `${name}-${crypto.randomUUID()}.sqlite`);
    paths.push(value);
    return value;
}

afterEach(() => {
    for (const value of paths.splice(0)) {
        for (const suffix of ['', '-wal', '-shm']) if (existsSync(value + suffix)) rmSync(value + suffix);
    }
});

describe('engine Thieving outcome bridge', () => {
    test('requires an explicit avatar binding and promotes immutable source evidence once', () => {
        const source = new ThievingEvidenceStore(path('engine-thieving'));
        const destination = new ThievingProcedureStore(path('procedure-thieving'));
        const event = source.append({ eventId: 'event-one', playerUsername: 'thief1', procedureKind: 'pickpocket',
            target: { kind: 'npc', typeId: 1, instanceIndex: 4, name: 'Man', x: 3200, z: 3201, level: 0 },
            effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
            thievingXpDelta: 80, startedAtEngineTick: 5, endedAtEngineTick: 6,
            occurredAt: '2026-09-21T18:00:00.000Z' });
        expect(() => ingestEngineThievingOutcome(event.eventId, source, destination, () => null))
            .toThrow('not bound to an agent');
        const first = ingestEngineThievingOutcome(event.eventId, source, destination,
            username => username === 'thief1' ? 'agent-thief' : null, '2026-09-21T18:00:01.000Z');
        const replay = ingestEngineThievingOutcome(event.eventId, source, destination,
            () => 'agent-thief', '2026-09-21T18:00:02.000Z');
        expect(replay).toEqual(first);
        expect(first.actorAgentId).toBe('agent-thief');
        expect(first.sourceEvidenceDigest).toBe(event.eventDigest);
        expect(destination.verifyAuditChain()).toBeTrue();
        source.close();
        destination.close();
    });
});
