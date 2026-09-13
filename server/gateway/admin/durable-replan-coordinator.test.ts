import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { DurableAgentReplanCoordinator } from './durable-replan-coordinator.js';
import type { AgentReplanCoordinatorDependencies, ReplanRecord } from './replan-coordinator.js';
import { AUTONOMY_LEASE_OWNER_MISMATCH_REASON } from './replan-coordinator.js';
import { ReplanInboxStore } from './replan-inbox.js';

const directories: string[] = [];
const event: LlmReplanEvent = { eventId: '11111111-1111-4111-8111-111111111111', agentId: 'ferrye14',
    type: 'skill-finished', sourceKey: 'skill:run-1', occurredAt: '2026-09-08T10:00:00.000Z',
    summary: 'Verified run completed.' };

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-durable-replan-'));
    directories.push(directory);
    return join(directory, 'inbox.sqlite');
}

function dependencies(plans: LlmReplanEvent[], records: ReplanRecord[]): AgentReplanCoordinatorDependencies {
    return { resolveAgentId: async () => 'ferrye14', listAgentIds: async () => ['ferrye14'],
        plan: async (agentId, input) => { plans.push(input); return { runId: input.eventId,
            status: 'skipped', reason: `${agentId}: no action` }; }, append: record => { records.push(record); } };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('durable replan coordinator admission', () => {
    test('returns the persisted terminal record for an exact replay without planning twice', async () => {
        const path = databasePath();
        const plans: LlmReplanEvent[] = [];
        const records: ReplanRecord[] = [];
        const coordinator = new DurableAgentReplanCoordinator(dependencies(plans, records), {
            path, leaseOwner: 'gateway:test'
        });
        const first = await coordinator.submit(event, '2026-09-08T10:00:01.000Z');
        const replay = await coordinator.submit({ ...event,
            eventId: '22222222-2222-4222-8222-222222222222' }, '2026-09-08T10:00:02.000Z');
        expect(replay).toEqual(first);
        expect(plans).toHaveLength(1);
        expect(records).toHaveLength(1);
    });

    test('replays an event whose previous gateway lease expired', async () => {
        const path = databasePath();
        const store = new ReplanInboxStore(path);
        store.enqueue(event, '2026-09-08T10:00:00.000Z');
        store.claim(event.eventId, 'gateway:dead', '2026-09-08T10:01:00.000Z', '2026-09-08T10:00:00.000Z');
        store.close();
        const plans: LlmReplanEvent[] = [];
        const records: ReplanRecord[] = [];
        const coordinator = new DurableAgentReplanCoordinator(dependencies(plans, records), {
            path, leaseOwner: 'gateway:new'
        });
        expect(await coordinator.replayDue('2026-09-08T10:01:00.000Z')).toEqual([
            expect.objectContaining({ event, outcome: expect.objectContaining({ status: 'skipped' }) })
        ]);
        expect(plans).toHaveLength(1);
        const reopened = new ReplanInboxStore(path);
        expect(reopened.get(event.eventId)).toMatchObject({ status: 'completed', attempt: 2 });
        reopened.close();
    });

    test('reconstructs non-urgent agent cooldown from the terminal journal after restart', async () => {
        const path = databasePath();
        const plans: LlmReplanEvent[] = [];
        const records: ReplanRecord[] = [];
        await new DurableAgentReplanCoordinator(dependencies(plans, records), {
            path, leaseOwner: 'gateway:old'
        }).submit({ ...event, type: 'autonomy-idle' }, '2026-09-08T10:00:00.000Z');
        const restarted = new DurableAgentReplanCoordinator(dependencies(plans, records), {
            path, leaseOwner: 'gateway:new'
        });
        const cooledDown = await restarted.submit({ ...event,
            eventId: '22222222-2222-4222-8222-222222222222', type: 'autonomy-idle', sourceKey: 'idle:next'
        }, '2026-09-08T10:00:01.000Z');
        expect(cooledDown).toMatchObject({ gate: { accepted: false, reason: 'cooldown',
            nextAllowedAt: '2026-09-08T10:00:05.000Z' }, outcome: null });
        expect(plans).toHaveLength(1);
    });

    test('retries an event when another gateway instance still owns the autonomy lease', async () => {
        const path = databasePath();
        let ownsLease = false;
        const records: ReplanRecord[] = [];
        const coordinator = new DurableAgentReplanCoordinator({
            resolveAgentId: async () => 'ferrye14', listAgentIds: async () => ['ferrye14'],
            plan: async (_agentId, input) => ({ runId: input.eventId, status: 'skipped',
                reason: ownsLease ? 'No next action.' : AUTONOMY_LEASE_OWNER_MISMATCH_REASON }),
            append: record => { records.push(record); }
        }, { path, leaseOwner: 'replan:new', retryMs: 1_000 });

        expect(await coordinator.submit(event, '2026-09-08T10:00:01.000Z')).toMatchObject({
            outcome: { reason: AUTONOMY_LEASE_OWNER_MISMATCH_REASON }
        });
        let store = new ReplanInboxStore(path);
        expect(store.get(event.eventId)).toMatchObject({ status: 'pending', attempt: 1,
            nextAttemptAt: '2026-09-08T10:00:02.000Z', lastError: AUTONOMY_LEASE_OWNER_MISMATCH_REASON });
        store.close();

        ownsLease = true;
        expect(await coordinator.replayDue('2026-09-08T10:00:02.000Z')).toEqual([
            expect.objectContaining({ outcome: expect.objectContaining({ reason: 'No next action.' }) })
        ]);
        store = new ReplanInboxStore(path);
        expect(store.get(event.eventId)).toMatchObject({ status: 'completed', attempt: 2 });
        store.close();
        expect(records).toHaveLength(2);
    });

    test('durably enqueues observed events without planning outside the supervisor lease', async () => {
        const path = databasePath();
        const plans: LlmReplanEvent[] = [], records: ReplanRecord[] = [];
        const coordinator = new DurableAgentReplanCoordinator(dependencies(plans, records), { path });
        const player = { lifeId: 1, isDead: false, lastDeathTick: null } as any;
        coordinator.observeWorldState('Ferrye14', { tick: 1, player, gameMessages: [] });
        coordinator.observeWorldState('Ferrye14', { tick: 2, player, gameMessages: [
            { tick: 2, type: 4, sender: 'Trader', text: 'Trader wishes to trade with you.' } as any
        ] });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(plans).toHaveLength(0);
        expect(records).toHaveLength(0);
        const store = new ReplanInboxStore(path);
        expect(store.listForAgent('ferrye14')).toEqual([expect.objectContaining({ status: 'pending',
            event: expect.objectContaining({ type: 'offer-received' }) })]);
        store.close();
    });
});
