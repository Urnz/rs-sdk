import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSimulationClockRuntime, simulationClockProfileDigest, SimulationClockStore,
    validateSimulationClockProfile, playerTimeCapabilities,
    type SimulationClockProfile } from '../index.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'simulation-clock-'));
    directories.push(directory);
    return join(directory, 'clock.sqlite');
}

function profile(rate = 1, id = 'normal'): SimulationClockProfile {
    return { schemaVersion: 1, profileId: id, version: '1.0.0', seed: 'world-seed-16',
        rate: { simulationMilliseconds: rate, wallMilliseconds: 1 } };
}

describe('simulation clock profile', () => {
    test('is exact, versioned and reproducibly digested', () => {
        const value = validateSimulationClockProfile(profile(60, 'accelerated'));
        expect(value).toEqual(profile(60, 'accelerated'));
        expect(simulationClockProfileDigest(value)).toBe(simulationClockProfileDigest(profile(60, 'accelerated')));
        expect(() => validateSimulationClockProfile({ ...profile(), extra: true })).toThrow('exactly');
        expect(() => validateSimulationClockProfile({ ...profile(), version: 'latest' })).toThrow('semantic');
        expect(() => validateSimulationClockProfile({ ...profile(), seed: ' padded ' })).toThrow('seed');
        expect(() => validateSimulationClockProfile({ ...profile(), rate: {
            simulationMilliseconds: 1.5, wallMilliseconds: 1 } })).toThrow('integer');
    });
});

describe('persistent simulation clock', () => {
    test('initializes once from config and requires explicit profile reconfiguration', () => {
        const path = databasePath();
        const configPath = join(path, '..', 'clock.json');
        const config = { schemaVersion: 1, clockId: 'world', initialSimulationTime: '2030-01-01T00:00:00.000Z',
            profile: profile() };
        writeFileSync(configPath, JSON.stringify(config));
        let runtime = openSimulationClockRuntime(configPath, path, '2026-09-13T08:00:00.000Z');
        expect(runtime.created).toBeTrue();
        runtime.store.close();
        runtime = openSimulationClockRuntime(configPath, path, '2026-09-13T09:00:00.000Z');
        expect(runtime.created).toBeFalse();
        runtime.store.close();
        writeFileSync(configPath, JSON.stringify({ ...config, profile: profile(60, 'accelerated') }));
        expect(() => openSimulationClockRuntime(configPath, path, '2026-09-13T09:00:00.000Z'))
            .toThrow('explicit revisioned reconfiguration');
    });

    test('replays the same profile and inputs identically in independent stores', () => {
        const first = new SimulationClockStore(databasePath());
        const second = new SimulationClockStore(databasePath());
        for (const store of [first, second]) {
            store.create({ clockId: 'world', profile: profile(60, 'accelerated'),
                wallTime: '2026-09-13T08:00:00.000Z', simulationTime: '0001-01-01T00:00:00.000Z' });
        }
        const firstStamp = first.nextEventStamp('world', '2026-09-13T08:01:23.456Z', 10);
        const secondStamp = second.nextEventStamp('world', '2026-09-13T08:01:23.456Z', 20);
        expect({ ...firstStamp, engineTick: null }).toEqual({ ...secondStamp, engineTick: null });
        first.close();
        second.close();
    });

    test('projects deterministic accelerated time independently from engine ticks', () => {
        const store = new SimulationClockStore(databasePath());
        store.create({ clockId: 'world', profile: profile(60, 'accelerated'),
            wallTime: '2026-09-13T08:00:00.000Z', simulationTime: '0001-01-01T00:00:00.000Z' });
        const first = store.observe('world', '2026-09-13T08:01:00.000Z', 10);
        expect(first).toMatchObject({ simulationTime: '0001-01-01T01:00:00.000Z', engineTick: 10 });
        const second = store.observe('world', '2026-09-13T08:01:00.000Z', 999_999);
        expect(second.simulationTime).toBe(first.simulationTime);
        expect(() => store.observe('world', '2026-09-13T08:00:59.999Z')).toThrow('regression');
        expect(() => store.observe('world', '2026-09-13 08:01:00Z')).toThrow('canonical');
        store.close();
    });

    test('keeps continuity across rate changes, pause and resume', () => {
        const store = new SimulationClockStore(databasePath());
        let state = store.create({ clockId: 'world', profile: profile(),
            wallTime: '2026-09-13T08:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        state = store.reconfigure('world', state.revision, profile(60, 'experiment'),
            '2026-09-13T08:00:10.000Z');
        expect(state.anchorSimulationTime).toBe('2030-01-01T00:00:10.000Z');
        expect(store.observe('world', '2026-09-13T08:00:11.000Z').simulationTime)
            .toBe('2030-01-01T00:01:10.000Z');
        state = store.pause('world', state.revision, '2026-09-13T08:00:12.000Z');
        expect(state.lastSimulationTime).toBe('2030-01-01T00:02:10.000Z');
        expect(store.observe('world', '2026-09-13T09:00:00.000Z').simulationTime)
            .toBe('2030-01-01T00:02:10.000Z');
        state = store.resume('world', state.revision, '2026-09-13T09:00:00.000Z');
        expect(store.observe('world', '2026-09-13T09:00:01.000Z').simulationTime)
            .toBe('2030-01-01T00:03:10.000Z');
        store.close();
    });

    test('persists monotonic event sequence and time across a restart', () => {
        const path = databasePath();
        let store = new SimulationClockStore(path);
        store.create({ clockId: 'world', profile: profile(), wallTime: '2026-09-13T08:00:00.000Z',
            simulationTime: '2030-01-01T00:00:00.000Z' });
        expect(store.nextEventStamp('world', '2026-09-13T08:00:02.000Z', 50))
            .toMatchObject({ sequence: 1, simulationTime: '2030-01-01T00:00:02.000Z', engineTick: 50 });
        store.close();

        store = new SimulationClockStore(path);
        expect(store.nextEventStamp('world', '2026-09-13T08:00:03.000Z', 1))
            .toMatchObject({ sequence: 2, simulationTime: '2030-01-01T00:00:03.000Z', engineTick: 1 });
        expect(store.get('world')).toMatchObject({ nextEventSequence: 3, lastSimulationTime:
            '2030-01-01T00:00:03.000Z' });
        store.close();
    });

    test('binds an immutable event stamp idempotently across restart', () => {
        const path = databasePath();
        let store = new SimulationClockStore(path);
        store.create({ clockId: 'world', profile: profile(), wallTime: '2026-09-13T08:00:00.000Z',
            simulationTime: '2030-01-01T00:00:00.000Z' });
        const input = { clockId: 'world', domain: 'replan-inbox', sourceId: 'event:one',
            sourceDigest: 'a'.repeat(64), wallTime: '2026-09-13T08:00:02.000Z', engineTick: 50 };
        const created = store.bindEvent(input);
        expect(created).toMatchObject({ created: true, stamp: { sequence: 1, domain: 'replan-inbox',
            sourceId: 'event:one', sourceDigest: 'a'.repeat(64),
            simulationTime: '2030-01-01T00:00:02.000Z', engineTick: 50 } });
        store.close();

        store = new SimulationClockStore(path);
        expect(store.bindEvent({ ...input, wallTime: '2026-09-13T08:00:10.000Z', engineTick: 1 }))
            .toEqual({ created: false, stamp: created.stamp });
        expect(store.get('world')?.nextEventSequence).toBe(2);
        expect(() => store.bindEvent({ ...input, sourceDigest: 'b'.repeat(64) })).toThrow('different digest');
        store.bindEvent({ ...input, domain: 'bank-journal', sourceId: 'event:two',
            sourceDigest: 'c'.repeat(64), wallTime: '2026-09-13T08:00:11.000Z' });
        expect(store.listBoundEvents('world', 0, 1).map(event => [event.sequence, event.domain]))
            .toEqual([[1, 'replan-inbox']]);
        expect(store.listBoundEvents('world', 1).map(event => [event.sequence, event.domain]))
            .toEqual([[2, 'bank-journal']]);
        store.close();
    });

    test('uses optimistic revisions for configuration transitions', () => {
        const store = new SimulationClockStore(databasePath());
        const created = store.create({ clockId: 'world', profile: profile(),
            wallTime: '2026-09-13T08:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        const paused = store.pause('world', created.revision, '2026-09-13T08:00:01.000Z');
        expect(paused).toMatchObject({ status: 'paused', revision: 2 });
        expect(store.pause('world', paused.revision, '2026-09-13T08:00:03.000Z'))
            .toMatchObject({ status: 'paused', revision: 2,
                lastObservedWallTime: '2026-09-13T08:00:03.000Z' });
        expect(() => store.resume('world', created.revision, '2026-09-13T08:00:02.000Z'))
            .toThrow('revision conflict');
        store.close();
    });

    test('keeps presence, explicit sleep and world progression independent', () => {
        const store = new SimulationClockStore(databasePath());
        store.create({ clockId: 'world', profile: profile(), wallTime: '2026-09-13T08:00:00.000Z',
            simulationTime: '2030-01-01T00:00:00.000Z' });
        const online = store.recordPlayerPresence('world', 'ferrye14', 'online', '2026-09-13T08:00:01.000Z');
        expect(online).toMatchObject({ presence: 'online', rest: 'awake', offlineDelegation: 'disabled',
            revision: 1, updatedAt: '2030-01-01T00:00:01.000Z' });
        expect(playerTimeCapabilities(online)).toEqual({ worldClockAdvances: true,
            physicalExecutionAllowed: true, offlineDelegationAllowed: false,
            reason: 'The online, awake avatar may execute bounded physical actions.' });
        const sleeping = store.startPlayerSleep('world', 'ferrye14', {
            sleeperKind: 'npc-agent', sleepPlaceId: 'varrock-dorm-bed-1',
            access: { kind: 'physical-presence', evidenceId: 'arrival-1', sourceDigest: 'a'.repeat(64),
                validUntilSimulationTime: null }
        }, '2026-09-13T08:00:02.000Z');
        expect(sleeping.sleepContext).toMatchObject({ sleeperKind: 'npc-agent',
            sleepPlaceId: 'varrock-dorm-bed-1', startedAtSimulationTime: '2030-01-01T00:00:02.000Z' });
        const offline = store.recordPlayerPresence('world', 'ferrye14', 'offline',
            '2026-09-13T08:00:03.000Z');
        expect(offline).toMatchObject({ presence: 'offline', rest: 'sleeping', revision: 3,
            restChangedAt: '2030-01-01T00:00:02.000Z', presenceChangedAt: '2030-01-01T00:00:03.000Z' });
        expect(playerTimeCapabilities(offline)).toMatchObject({ worldClockAdvances: true,
            physicalExecutionAllowed: false, offlineDelegationAllowed: false });
        const disconnectedAwake = store.recordPlayerRest('world', 'ferrye14', 'awake',
            '2026-09-13T08:00:04.000Z');
        expect(disconnectedAwake).toMatchObject({ presence: 'offline', rest: 'awake', revision: 4 });
        expect(store.get('world')).toMatchObject({ lastSimulationTime: '2030-01-01T00:00:04.000Z' });
        store.close();
    });

    test('requires a valid bed entitlement for human sleep independently from logout', () => {
        const store = new SimulationClockStore(databasePath());
        store.create({ clockId: 'world', profile: profile(), wallTime: '2026-09-13T08:00:00.000Z',
            simulationTime: '2030-01-01T00:00:00.000Z' });
        store.recordPlayerPresence('world', 'human', 'online', '2026-09-13T08:00:01.000Z');
        expect(() => store.recordPlayerRest('world', 'human', 'sleeping',
            '2026-09-13T08:00:02.000Z')).toThrow('verified sleep-place access');
        expect(() => store.startPlayerSleep('world', 'human', { sleeperKind: 'human-player',
            sleepPlaceId: 'inn-bed-1', access: { kind: 'physical-presence', evidenceId: 'arrival-2',
                sourceDigest: 'b'.repeat(64), validUntilSimulationTime: null } },
        '2026-09-13T08:00:02.000Z')).toThrow('requires a bed entitlement');
        const sleeping = store.startPlayerSleep('world', 'human', { sleeperKind: 'human-player',
            sleepPlaceId: 'inn-bed-1', access: { kind: 'bed-entitlement', evidenceId: 'tenancy-1',
                sourceDigest: 'c'.repeat(64), validUntilSimulationTime: '2030-01-01T01:00:00.000Z' } },
        '2026-09-13T08:00:02.000Z');
        expect(sleeping).toMatchObject({ presence: 'online', rest: 'sleeping',
            offlineDelegation: 'disabled', sleepContext: { sleeperKind: 'human-player',
                sleepPlaceId: 'inn-bed-1' } });
        const loggedOut = store.recordPlayerPresence('world', 'human', 'offline',
            '2026-09-13T08:00:03.000Z');
        expect(loggedOut).toMatchObject({ presence: 'offline', rest: 'sleeping',
            sleepContext: { sleepPlaceId: 'inn-bed-1' } });
        expect(() => store.startPlayerSleep('world', 'expired', { sleeperKind: 'human-player',
            sleepPlaceId: 'inn-bed-2', access: { kind: 'bed-entitlement', evidenceId: 'tenancy-old',
                sourceDigest: 'd'.repeat(64), validUntilSimulationTime: '2030-01-01T00:00:01.000Z' } },
        '2026-09-13T08:00:04.000Z')).toThrow('expired');
        store.close();
    });

    test('migrates an empty database and rejects a newer schema', () => {
        const path = databasePath();
        const migrated = new SimulationClockStore(path);
        migrated.close();
        let inspected = new Database(path);
        expect((inspected.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
        inspected.run('DROP TABLE simulation_player_time_state');
        inspected.run('PRAGMA user_version = 2');
        inspected.close();
        const upgraded = new SimulationClockStore(path);
        expect(upgraded.listPlayerTimeStates('world')).toEqual([]);
        upgraded.close();
        inspected = new Database(path);
        expect((inspected.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
        inspected.run('PRAGMA user_version = 5');
        inspected.close();
        expect(() => new SimulationClockStore(path)).toThrow('newer than supported');
    });
});
