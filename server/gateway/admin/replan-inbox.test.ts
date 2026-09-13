import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplanInboxStore } from './replan-inbox.js';

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
});
