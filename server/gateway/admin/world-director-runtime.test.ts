import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectWorldEvent } from './world-director.js';
import { GatewayWorldDirectorScheduler, WorldDirectorDispatcher, WorldDirectorStore,
    validateWorldDirectorConfig, worldDirectorCycleKey, type TrustedWorldEventAdapter }
    from './world-director-runtime.js';

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-world-director-'));
    directories.push(directory);
    return join(directory, 'world-director.sqlite');
}

describe('World Director durable cycle ledger', () => {
    test('atomically queues one immutable signal and treats an exact replay as idempotent', () => {
        const path = databasePath();
        const store = new WorldDirectorStore(path);
        const selection = selectWorldEvent('experiment-a', 'cycle-7');
        const first = store.enqueue(selection, '2026-08-31T10:00:00.000Z');
        const replay = store.enqueue(selection, '2026-08-31T11:00:00.000Z');

        expect(first.created).toBeTrue();
        expect(replay.created).toBeFalse();
        expect(replay.cycle).toEqual(first.cycle);
        expect(replay.outbox).toMatchObject({ status: 'pending', attempts: 0,
            signal: { cycleKey: 'cycle-7', selectionDigest: selection.digest } });
        expect(store.listCycles()).toHaveLength(1);
        expect(store.listOutbox()).toHaveLength(1);
        store.close();
    });

    test('rejects reusing a cycle key after the deterministic inputs change', () => {
        const store = new WorldDirectorStore(databasePath());
        store.enqueue(selectWorldEvent('experiment-a', 'cycle-7'));
        expect(() => store.enqueue(selectWorldEvent('experiment-b', 'cycle-7'))).toThrow('already bound');
        store.close();
    });
});

describe('World Director trusted outbox adapter', () => {
    test('leases a supported signal and marks both outbox and cycle delivered exactly once', async () => {
        const store = new WorldDirectorStore(databasePath());
        const queued = store.enqueue(selectWorldEvent('seed', 'cycle-1'), '2026-08-31T10:00:00.000Z');
        const delivered: string[] = [];
        const adapter: TrustedWorldEventAdapter = { adapterId: 'test-observer',
            supportedKinds: [queued.outbox.signal.kind],
            publish: async signal => { delivered.push(signal.eventId); } };
        const dispatcher = new WorldDirectorDispatcher(store, adapter);

        expect(await dispatcher.tick('2026-08-31T10:01:00.000Z')).toMatchObject({ status: 'delivered', attempts: 1 });
        expect(await dispatcher.tick('2026-08-31T10:02:00.000Z')).toBeNull();
        expect(delivered).toEqual([queued.cycle.eventId]);
        expect(store.getCycle('cycle-1')).toMatchObject({ status: 'delivered', revision: 2 });
        store.close();
    });

    test('records adapter failure and retries through a new one-time lease', async () => {
        const store = new WorldDirectorStore(databasePath());
        const queued = store.enqueue(selectWorldEvent('seed', 'cycle-retry'));
        let calls = 0;
        const adapter: TrustedWorldEventAdapter = { adapterId: 'retry-adapter',
            supportedKinds: [queued.outbox.signal.kind], publish: async () => {
                calls++;
                if (calls === 1) throw new Error('temporary adapter failure');
            } };
        const dispatcher = new WorldDirectorDispatcher(store, adapter);

        expect(await dispatcher.tick('2026-08-31T10:00:00.000Z')).toMatchObject({
            status: 'failed', attempts: 1, lastError: 'Error: temporary adapter failure' });
        expect(await dispatcher.tick('2026-08-31T10:01:00.000Z')).toMatchObject({ status: 'delivered', attempts: 2 });
        expect(calls).toBe(2);
        store.close();
    });

    test('recovers an expired delivery lease and rejects the superseded token', () => {
        const store = new WorldDirectorStore(databasePath());
        const queued = store.enqueue(selectWorldEvent('seed', 'cycle-crash'));
        const kinds = [queued.outbox.signal.kind];
        const abandoned = store.claimNext('crashed-adapter', kinds, 30_000, '2026-08-31T10:00:00.000Z')!;
        expect(store.claimNext('replacement-adapter', kinds, 30_000, '2026-08-31T10:00:20.000Z')).toBeNull();
        const recovered = store.claimNext('replacement-adapter', kinds, 30_000, '2026-08-31T10:00:31.000Z')!;
        expect(recovered.leaseToken).not.toBe(abandoned.leaseToken);
        expect(recovered.attempts).toBe(2);
        expect(() => store.complete(queued.cycle.eventId, abandoned.leaseToken!, '2026-08-31T10:00:32.000Z'))
            .toThrow('lease is invalid');
        expect(store.complete(queued.cycle.eventId, recovered.leaseToken!, '2026-08-31T10:00:33.000Z').status)
            .toBe('delivered');
        store.close();
    });
});

describe('World Director scheduler', () => {
    const enabled = validateWorldDirectorConfig({ schemaVersion: 1, enabled: true, seed: 'experiment-a',
        epoch: '2026-01-01T00:00:00.000Z', intervalMinutes: 60 });

    test('derives stable interval keys and atomically queues each interval once', () => {
        const path = databasePath();
        expect(worldDirectorCycleKey(enabled, '2026-01-01T00:59:59.999Z')).toBe('cycle-0');
        expect(worldDirectorCycleKey(enabled, '2026-01-01T01:00:00.000Z')).toBe('cycle-1');
        const scheduler = new GatewayWorldDirectorScheduler({ loadConfig: () => enabled,
            templates: [selectWorldEvent('seed', 'template-source').template], storePath: path });
        expect(scheduler.tick('2026-01-01T01:15:00.000Z').status).toBe('queued');
        expect(scheduler.tick('2026-01-01T01:45:00.000Z').status).toBe('already-queued');
        expect(scheduler.tick('2026-01-01T02:00:00.000Z').status).toBe('queued');
    });

    test('does not create a database cycle while disabled', () => {
        const disabled = { ...enabled, enabled: false };
        const scheduler = new GatewayWorldDirectorScheduler({ loadConfig: () => disabled,
            templates: [], storePath: databasePath() });
        expect(scheduler.tick('2026-08-31T10:00:00.000Z')).toEqual({
            status: 'disabled', reason: 'World Director is disabled.', cycle: null });
    });
});
