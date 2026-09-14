import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { ReplanInboxStore } from './replan-inbox.js';
import { SimulationClockStore } from '../../../simulation-clock/index.js';

const directories: string[] = [];
const event = { eventId: '11111111-1111-4111-8111-111111111111', agentId: 'ferrye14',
    type: 'skill-finished' as const, sourceKey: 'skill:run-1', occurredAt: '2026-09-08T10:00:00.000Z',
    summary: 'Verified skill run completed.' };

function path(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-replan-inbox-'));
    directories.push(directory);
    return join(directory, 'inbox.sqlite');
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('durable replan inbox', () => {
    test('deduplicates an exact stable source and rejects changed reuse across restart', () => {
        const databasePath = path();
        let store = new ReplanInboxStore(databasePath);
        const created = store.enqueue(event, '2026-09-08T10:00:01.000Z');
        expect(created).toMatchObject({ created: true, record: { status: 'pending', attempt: 0, revision: 1 } });
        store.close();
        store = new ReplanInboxStore(databasePath);
        expect(store.enqueue({ ...event, eventId: '22222222-2222-4222-8222-222222222222' },
            '2026-09-08T10:00:02.000Z')).toEqual({ created: false, record: created.record });
        expect(() => store.enqueue({ ...event, summary: 'Changed payload.' }))
            .toThrow('reused with a different payload');
        store.close();
    });

    test('claims atomically, retries with backoff, and persists a terminal outcome', () => {
        const store = new ReplanInboxStore(path());
        store.enqueue(event, '2026-09-08T10:00:00.000Z');
        const claimed = store.claimDue('gateway:one', '2026-09-08T10:01:00.000Z', 10,
            '2026-09-08T10:00:01.000Z')[0]!;
        expect(claimed).toMatchObject({ status: 'claimed', attempt: 1, leaseOwner: 'gateway:one', revision: 2 });
        expect(store.claimDue('gateway:two', '2026-09-08T10:01:00.000Z', 10,
            '2026-09-08T10:00:02.000Z')).toEqual([]);
        const pending = store.retry(event.eventId, claimed.revision, 'gateway:one', 'Transient failure.',
            '2026-09-08T10:02:00.000Z', '2026-09-08T10:00:03.000Z');
        expect(pending).toMatchObject({ status: 'pending', attempt: 1, nextAttemptAt: '2026-09-08T10:02:00.000Z' });
        expect(store.claimDue('gateway:two', '2026-09-08T10:03:00.000Z', 10,
            '2026-09-08T10:01:59.000Z')).toEqual([]);
        const reclaimed = store.claimDue('gateway:two', '2026-09-08T10:03:00.000Z', 10,
            '2026-09-08T10:02:00.000Z')[0]!;
        const completed = store.resolve(event.eventId, reclaimed.revision, 'gateway:two', 'skipped: no work');
        expect(completed).toMatchObject({ status: 'completed', attempt: 2,
            terminalOutcome: 'skipped: no work', leaseOwner: null });
        store.close();
    });

    test('recovers an expired lease before claiming it for one new owner', () => {
        const store = new ReplanInboxStore(path());
        store.enqueue(event, '2026-09-08T10:00:00.000Z');
        store.claimDue('gateway:dead', '2026-09-08T10:01:00.000Z', 1, '2026-09-08T10:00:00.000Z');
        expect(store.nextClaimableForAgent('ferrye14', '2026-09-08T10:00:59.000Z')).toBeNull();
        expect(store.nextClaimableForAgent('ferrye14', '2026-09-08T10:01:00.000Z'))
            .toMatchObject({ status: 'claimed', leaseOwner: 'gateway:dead' });
        const recovered = store.claimDue('gateway:new', '2026-09-08T10:03:00.000Z', 1,
            '2026-09-08T10:01:00.000Z')[0]!;
        expect(recovered).toMatchObject({ status: 'claimed', attempt: 2, leaseOwner: 'gateway:new', revision: 4 });
        expect(() => store.resolve(event.eventId, recovered.revision, 'gateway:dead', 'stale'))
            .toThrow('ownership changed');
        store.close();
    });

    test('claims one exact event without consuming unrelated due work', () => {
        const store = new ReplanInboxStore(path());
        store.enqueue(event, '2026-09-08T10:00:00.000Z');
        store.enqueue({ ...event, eventId: '22222222-2222-4222-8222-222222222222',
            sourceKey: 'skill:run-2' }, '2026-09-08T10:00:00.000Z');
        expect(store.claim(event.eventId, 'gateway:one', '2026-09-08T10:01:00.000Z',
            '2026-09-08T10:00:01.000Z')).toMatchObject({ event, status: 'claimed', attempt: 1 });
        expect(store.claimDue('gateway:two', '2026-09-08T10:01:00.000Z', 10,
            '2026-09-08T10:00:01.000Z')).toEqual([
            expect.objectContaining({ event: expect.objectContaining({ sourceKey: 'skill:run-2' }) })
        ]);
        store.close();
    });

    test('preserves wall occurrence while binding one replay-safe simulation stamp', () => {
        const inboxPath = path();
        const clockPath = join(inboxPath, '..', 'clock.sqlite');
        let clock = new SimulationClockStore(clockPath);
        clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
            seed: 'replan-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } },
        wallTime: '2026-09-08T09:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        let store = new ReplanInboxStore(inboxPath, { store: clock, clockId: 'world', engineTick: () => 77 });
        const created = store.enqueue(event, '2026-09-08T10:00:01.000Z');
        expect(created.record).toMatchObject({ event: { occurredAt: '2026-09-08T10:00:00.000Z' },
            simulationStamp: { sequence: 1, wallTime: '2026-09-08T10:00:01.000Z',
                simulationTime: '2030-01-01T01:00:01.000Z', engineTick: 77 } });
        store.close();
        clock.close();

        clock = new SimulationClockStore(clockPath);
        store = new ReplanInboxStore(inboxPath, { store: clock, clockId: 'world', engineTick: () => 1 });
        const replay = store.enqueue({ ...event, eventId: '22222222-2222-4222-8222-222222222222' },
            '2026-09-08T11:00:00.000Z');
        expect(replay).toEqual({ created: false, record: created.record });
        expect(clock.get('world')?.nextEventSequence).toBe(2);
        store.close();
        clock.close();
    });

    test('migrates a v1 event and backfills its immutable stamp on replay', () => {
        const inboxPath = path();
        const legacy = new Database(inboxPath, { create: true, strict: true });
        legacy.run(`CREATE TABLE replan_inbox (
            event_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,event_type TEXT NOT NULL,source_key TEXT NOT NULL,
            payload TEXT NOT NULL,payload_digest TEXT NOT NULL,status TEXT NOT NULL,
            attempt INTEGER NOT NULL,next_attempt_at TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,
            terminal_outcome TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
            revision INTEGER NOT NULL,UNIQUE(agent_id,event_type,source_key))`);
        const payload = JSON.stringify(event);
        const digestPayload = JSON.stringify({ agentId: event.agentId, type: event.type, sourceKey: event.sourceKey,
            occurredAt: event.occurredAt, summary: event.summary, selectionSeed: null });
        const digest = createHash('sha256').update(digestPayload).digest('hex');
        legacy.run(`INSERT INTO replan_inbox VALUES (?1,?2,?3,?4,?5,?6,'pending',0,?7,NULL,NULL,NULL,NULL,?7,?7,1)`,
            [event.eventId, event.agentId, event.type, event.sourceKey, payload, digest,
                '2026-09-08T10:00:01.000Z']);
        legacy.run('PRAGMA user_version = 1');
        legacy.close();

        const clock = new SimulationClockStore(join(inboxPath, '..', 'clock.sqlite'));
        clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
            seed: 'migration-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } },
        wallTime: '2026-09-08T09:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        const migrated = new ReplanInboxStore(inboxPath, { store: clock, clockId: 'world' });
        expect(migrated.get(event.eventId)?.simulationStamp).toBeNull();
        expect(migrated.enqueue(event, '2026-09-08T10:00:02.000Z')).toMatchObject({ created: false,
            record: { event: { occurredAt: event.occurredAt }, simulationStamp: { sequence: 1,
                simulationTime: '2030-01-01T01:00:02.000Z' } } });
        migrated.close();
        clock.close();
    });
});
