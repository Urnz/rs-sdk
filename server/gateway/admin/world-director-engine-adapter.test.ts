import { describe, expect, test } from 'bun:test';
import { selectWorldEvent } from './world-director.js';
import { EngineWorldDirectorAdapter } from './world-director-engine-adapter.js';
import { WorldDirectorStore } from './world-director-runtime.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('trusted engine World Director adapter', () => {
    test('forwards only the already validated inert outbox signal', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'rs-world-engine-adapter-'));
        const store = new WorldDirectorStore(join(directory, 'world.sqlite'));
        const queued = store.enqueue(selectWorldEvent('seed', 'cycle-adapter'));
        const received: unknown[] = [];
        const adapter = new EngineWorldDirectorAdapter(async signal => {
            received.push(signal);
            return { ok: true, commandId: 'command', eventId: signal.eventId, created: true, tick: 42 };
        });
        await adapter.publish(queued.outbox.signal);
        expect(received).toEqual([queued.outbox.signal]);
        expect(adapter.supportedKinds).toEqual(['economic-signal', 'resource-signal', 'social-signal', 'world-flavor']);
        store.close();
        rmSync(directory, { recursive: true, force: true });
    });
});
