import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteInferenceQueueClaimStore } from '../inference-queue-store.js';
import { InferenceQueue, InferenceQueueBacklogError, InferenceQueueRateLimitError } from '../queue.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function deferred() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

describe('shared inference queue', () => {
    test('bounds active plus pending backlog', async () => {
        const gate = deferred();
        const queue = new InferenceQueue({ maxBacklog: 2 });
        const active = queue.enqueue(async () => { await gate.promise; return 'active'; },
            { requestId: 'active', agentId: 'a', priority: 50 });
        const waiting = queue.enqueue(async () => 'waiting', { requestId: 'waiting', agentId: 'b', priority: 50 });
        await expect(queue.enqueue(async () => 'overflow',
            { requestId: 'overflow', agentId: 'c', priority: 50 })).rejects.toBeInstanceOf(InferenceQueueBacklogError);
        expect(queue.pending).toBe(2);
        gate.release();
        expect(await Promise.all([active, waiting])).toEqual(['active', 'waiting']);
    });

    test('honors priority and round-robins equal-priority agents', async () => {
        const gate = deferred();
        const order: string[] = [];
        const queue = new InferenceQueue();
        const first = queue.enqueue(async () => { order.push('a1'); await gate.promise; },
            { requestId: 'a1', agentId: 'a', priority: 50 });
        const low = queue.enqueue(async () => { order.push('low'); },
            { requestId: 'low', agentId: 'c', priority: 10 });
        const a2 = queue.enqueue(async () => { order.push('a2'); },
            { requestId: 'a2', agentId: 'a', priority: 80 });
        const b1 = queue.enqueue(async () => { order.push('b1'); },
            { requestId: 'b1', agentId: 'b', priority: 80 });
        const a3 = queue.enqueue(async () => { order.push('a3'); },
            { requestId: 'a3', agentId: 'a', priority: 80 });
        gate.release();
        await Promise.all([first, low, a2, b1, a3]);
        expect(order).toEqual(['a1', 'a2', 'b1', 'a3', 'low']);
    });

    test('persists exact-owner claims and recovers only after lease expiry', () => {
        const root = mkdtempSync(join(tmpdir(), 'inference-queue-')); roots.push(root);
        const path = join(root, 'claims.sqlite');
        const first = new SqliteInferenceQueueClaimStore(path);
        const second = new SqliteInferenceQueueClaimStore(path);
        first.admit({ requestId: 'request-1', agentId: 'a', priority: 50,
            enqueuedAt: '2026-09-10T10:00:00.000Z' }, 10);
        expect(first.claim('request-1', 'owner-a', '2026-09-10T10:01:00.000Z',
            '2026-09-10T10:00:00.000Z')).toBeTrue();
        expect(second.claim('request-1', 'owner-b', '2026-09-10T10:02:00.000Z',
            '2026-09-10T10:00:30.000Z')).toBeFalse();
        expect(second.claim('request-1', 'owner-b', '2026-09-10T10:03:00.000Z',
            '2026-09-10T10:01:01.000Z')).toBeTrue();
        second.complete('request-1', 'owner-b', 'completed', '2026-09-10T10:01:02.000Z');
        expect(second.get('request-1')).toMatchObject({ status: 'completed', attempt: 2, leaseOwner: null });
        first.admit({ requestId: 'request-1', agentId: 'a', priority: 50,
            enqueuedAt: '2026-09-10T10:04:00.000Z' }, 10);
        expect(first.claim('request-1', 'owner-c', '2026-09-10T10:05:00.000Z',
            '2026-09-10T10:04:00.000Z')).toBeTrue();
        first.complete('request-1', 'owner-c', 'failed', '2026-09-10T10:04:01.000Z', 'retryable');
        expect(first.get('request-1')).toMatchObject({ status: 'failed', attempt: 3, error: 'retryable' });
        first.close(); second.close();
    });

    test('expires abandoned persisted claims before enforcing the global backlog', () => {
        const root = mkdtempSync(join(tmpdir(), 'inference-queue-expiry-')); roots.push(root);
        const store = new SqliteInferenceQueueClaimStore(join(root, 'claims.sqlite'));
        store.admit({ requestId: 'stale', agentId: 'a', priority: 50,
            enqueuedAt: '2026-09-10T10:00:00.000Z' }, 1);
        expect(store.claim('stale', 'dead-owner', '2026-09-10T10:01:00.000Z',
            '2026-09-10T10:00:00.000Z')).toBeTrue();
        store.admit({ requestId: 'replacement', agentId: 'b', priority: 50,
            enqueuedAt: '2026-09-10T10:01:01.000Z' }, 1);
        expect(store.get('stale')).toMatchObject({ status: 'failed', leaseOwner: null });
        expect(store.get('replacement')).toMatchObject({ status: 'pending' });
        store.close();
    });

    test('retries typed provider rate limits with bounded exponential backoff', async () => {
        const queue = new InferenceQueue({ maxRateLimitRetries: 2, baseRateLimitBackoffMs: 1,
            maxRateLimitBackoffMs: 10 });
        let calls = 0;
        const result = await queue.completeWithRateLimitBackoff(async () => {
            calls++;
            if (calls < 3) throw new InferenceQueueRateLimitError('limited', 1);
            return 'ok';
        }, new AbortController().signal);
        expect(result).toBe('ok');
        expect(calls).toBe(3);
    });
});
