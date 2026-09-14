import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Database } from 'bun:sqlite';
import { SimulationClockStore } from '../../../simulation-clock/index.js';
import { selectWorldEvent } from './world-director.js';
import { GatewayWorldDirectorScheduler, WorldDirectorDispatcher, WorldDirectorStore,
    loadWorldDirectorConfig, updateWorldDirectorConfig, validateWorldDirectorConfig,
    worldDirectorCycleKey, type TrustedWorldEventAdapter }
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

    test('binds one immutable simulation stamp and backfills an unstamped legacy signal', () => {
        const path = databasePath();
        let store = new WorldDirectorStore(path);
        const selection = selectWorldEvent('simulation-seed', 'cycle-simulation');
        const original = store.enqueue(selection, '2026-08-31T10:01:00.000Z').outbox;
        expect(original.simulationStamp).toBeNull();
        store.close();

        const clock = new SimulationClockStore(join(dirname(path), 'simulation.sqlite'));
        clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
            seed: 'world-director-test', rate: { simulationMilliseconds: 2, wallMilliseconds: 1 } },
        wallTime: '2026-08-31T11:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        store = new WorldDirectorStore(path, { store: clock, clockId: 'world', engineTick: () => 80 });
        const backfilled = store.getOutbox(original.signal.eventId)!;
        expect(backfilled.signal.queuedAt).toBe(original.signal.queuedAt);
        expect(backfilled.simulationStamp).toMatchObject({ sequence: 1, engineTick: 80,
            wallTime: '2026-08-31T11:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z',
            sourceDigest: selection.digest });
        expect(store.enqueue(selection, '2026-08-31T11:00:00.000Z').outbox.simulationStamp)
            .toEqual(backfilled.simulationStamp);
        expect(clock.get('world')?.nextEventSequence).toBe(2);
        store.close();
        clock.close();
    });

    test('migrates the original unversioned outbox schema in place', () => {
        const path = databasePath();
        const legacy = new Database(path, { create: true, strict: true });
        legacy.run(`CREATE TABLE world_director_cycle (
            cycle_key TEXT PRIMARY KEY, seed TEXT NOT NULL, selection_digest TEXT NOT NULL,
            template_id TEXT NOT NULL, template_version TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL, queued_at TEXT NOT NULL, delivered_at TEXT, revision INTEGER NOT NULL)`);
        legacy.run(`CREATE TABLE world_director_outbox (
            event_id TEXT PRIMARY KEY REFERENCES world_director_cycle(event_id), payload_json TEXT NOT NULL,
            status TEXT NOT NULL, attempts INTEGER NOT NULL, adapter_id TEXT, lease_token TEXT UNIQUE,
            lease_expires_at TEXT, last_error TEXT, updated_at TEXT NOT NULL, revision INTEGER NOT NULL)`);
        legacy.close(true);
        const migrated = new WorldDirectorStore(path);
        migrated.close();
        const verification = new Database(path, { readonly: true, strict: true });
        const version = verification.query('PRAGMA user_version').get() as { user_version: number };
        const columns = verification.query('PRAGMA table_info(world_director_outbox)').all() as Array<{ name: string }>;
        expect(version.user_version).toBe(1);
        expect(columns.map(column => column.name)).toContain('simulation_source_digest');
        verification.close(true);
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

    test('atomically persists a validated server configuration override', () => {
        const directory = mkdtempSync(join(tmpdir(), 'rs-world-director-config-'));
        directories.push(directory);
        const path = join(directory, 'world-director.json');
        const written = updateWorldDirectorConfig({ ...enabled, seed: 'server-specific', intervalMinutes: 120 }, path);
        expect(loadWorldDirectorConfig(path)).toEqual(written);
        expect(() => updateWorldDirectorConfig({ ...enabled, intervalMinutes: 1 }, path)).toThrow('5 to 10080');
        expect(loadWorldDirectorConfig(path)).toEqual(written);
    });
});
