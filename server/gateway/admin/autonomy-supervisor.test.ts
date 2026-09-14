import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { AgentReplanCoordinator, ReplanRecord } from './replan-coordinator.js';
import { autonomyFailureFingerprint, GatewayAgentAutonomySupervisor } from './autonomy-supervisor.js';

const directories: string[] = [];

function setup(nextWakeupAt: string | null = null): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-autonomy-supervisor-'));
    directories.push(directory);
    const path = join(directory, 'agents.sqlite');
    const store = new AgentStateStore(path);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Autonomy supervisor test agent.', personalityTraits: ['careful'] });
    store.createAutonomyEnrollment('ferrye14', { status: 'desired', policyId: 'private-local-default',
        policyVersion: '1.0.0', nextWakeupAt }, '2026-09-08T08:00:00.000Z');
    store.close();
    return path;
}

function coordinator(plan: (event: LlmReplanEvent) => Promise<ReplanRecord>): AgentReplanCoordinator {
    return { submit: plan } as unknown as AgentReplanCoordinator;
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('gateway autonomy supervisor', () => {
    test('claims due startup work and releases a non-executing result with bounded retry', async () => {
        const path = setup();
        const events: LlmReplanEvent[] = [];
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            events.push(event);
            const during = new AgentStateStore(path);
            expect(during.getAutonomyEnrollment(event.agentId)).toMatchObject({
                status: 'running', leaseOwner: 'gateway:test'
            });
            during.close();
            return { timestamp: event.occurredAt, event, gate: { accepted: true, reason: 'accepted',
                nextAllowedAt: '2026-09-08T08:00:05.000Z' },
            outcome: { runId: event.eventId, status: 'skipped', reason: 'Bot is offline.' }, error: null };
        }), { agentPath: path, leaseOwner: 'gateway:test', retryMs: 30_000 });

        const results = await supervisor.tick('2026-09-08T08:00:00.000Z', true);
        expect(results).toEqual([expect.objectContaining({ agentId: 'ferrye14', status: 'released' })]);
        expect(events).toEqual([expect.objectContaining({ type: 'autonomy-startup',
            sourceKey: 'autonomy:ferrye14:revision:2' })]);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired',
            leaseOwner: null, nextWakeupAt: '2026-09-08T08:00:30.000Z', revision: 3 });
        reopened.close();
    });

    test('keeps the lease while the existing skill executor is running', async () => {
        const path = setup('2026-09-08T08:01:00.000Z');
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => ({
            timestamp: event.occurredAt, event, gate: { accepted: true, reason: 'accepted',
                nextAllowedAt: '2026-09-08T08:01:05.000Z' },
            outcome: { runId: '11111111-1111-4111-8111-111111111111', status: 'executing',
                reason: 'Exact verified skill started.' }, error: null
        })), { agentPath: path, leaseOwner: 'gateway:test' });

        expect(await supervisor.tick('2026-09-08T08:00:59.000Z')).toEqual([]);
        expect(await supervisor.tick('2026-09-08T08:01:00.000Z')).toEqual([
            expect.objectContaining({ status: 'executing' })
        ]);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({
            status: 'running', leaseOwner: 'gateway:test', nextWakeupAt: null, revision: 2
        });
        reopened.close();
    });

    test('backs off identical failures exponentially and opens a durable quarantine circuit', async () => {
        const path = setup();
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => ({
            timestamp: event.occurredAt, event, gate: { accepted: true, reason: 'accepted',
                nextAllowedAt: event.occurredAt }, outcome: { runId: event.eventId, status: 'skipped',
                decision: { kind: 'execute-skill', skill: { id: 'mining.safe', version: '1.0.0' } },
                reason: `Provider timeout for run ${event.eventId}.` }, error: null
        })), { agentPath: path, leaseOwner: 'gateway:test', retryMs: 30_000,
            maxRetryMs: 120_000, maxIdenticalFailures: 3 });

        await supervisor.tick('2026-09-08T08:00:00.000Z');
        let store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('ferrye14')).toMatchObject({ failureCount: 1,
            nextWakeupAt: '2026-09-08T08:00:30.000Z' });
        store.close();
        expect(await supervisor.tick('2026-09-08T08:00:01.000Z')).toEqual([]);
        await supervisor.tick('2026-09-08T08:00:30.000Z');
        store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('ferrye14')).toMatchObject({ failureCount: 2,
            nextWakeupAt: '2026-09-08T08:01:30.000Z' });
        store.close();
        expect(await supervisor.tick('2026-09-08T08:01:30.000Z')).toEqual([
            expect.objectContaining({ status: 'failed', reason: expect.stringContaining('circuit opened') })
        ]);
        store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'quarantined',
            failureCount: 3, nextWakeupAt: null, leaseOwner: null,
            lastFailureFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            quarantineReason: expect.stringContaining('identical failures') });
        store.close();
        expect(await supervisor.tick('2026-09-08T09:00:00.000Z')).toEqual([]);
    });

    test('fingerprints ignore volatile ids but change with the exact selected skill', () => {
        const record = (eventId: string, skill: string): ReplanRecord => ({
            timestamp: '2026-09-08T08:00:00.000Z', event: { eventId, agentId: 'ferrye14',
                type: 'skill-failed', sourceKey: `skill:${eventId}`, occurredAt: '2026-09-08T08:00:00.000Z',
                summary: 'Failed.' }, gate: { accepted: true, reason: 'accepted',
                nextAllowedAt: '2026-09-08T08:00:00.000Z' }, outcome: { runId: eventId, status: 'failed',
                decision: { kind: 'execute-skill', skill: { id: skill, version: '1.0.0' } },
                reason: `Run ${eventId} timed out after 30000 ms.` }, error: null });
        const first = record('11111111-1111-4111-8111-111111111111', 'mining.safe');
        const second = record('22222222-2222-4222-8222-222222222222', 'mining.safe');
        expect(autonomyFailureFingerprint(first)).toBe(autonomyFailureFingerprint(second));
        expect(autonomyFailureFingerprint(first)).not.toBe(autonomyFailureFingerprint(
            record('33333333-3333-4333-8333-333333333333', 'mining.other')));
    });

    test('prioritizes a recovered durable event after acquiring the current gateway lease', async () => {
        const path = setup('2026-09-08T09:00:00.000Z');
        const recovered: LlmReplanEvent = { eventId: '11111111-1111-4111-8111-111111111111',
            agentId: 'ferrye14', type: 'skill-finished', sourceKey: 'skill:run-1:terminal',
            occurredAt: '2026-09-08T07:59:59.000Z', summary: 'Recovered terminal skill event.' };
        const events: LlmReplanEvent[] = [];
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            events.push(event);
            return { timestamp: event.occurredAt, event, gate: { accepted: true, reason: 'accepted',
                nextAllowedAt: '2026-09-08T08:00:05.000Z' },
            outcome: { runId: event.eventId, status: 'skipped', reason: 'No next action.' }, error: null };
        }), { agentPath: path, leaseOwner: 'gateway:new', nextEvent: () => recovered });

        expect(await supervisor.tick('2026-09-08T08:00:00.000Z', true)).toEqual([
            expect.objectContaining({ status: 'released' })
        ]);
        expect(events).toEqual([recovered]);
    });

    test('fails closed for an unsupported persisted policy', async () => {
        const path = setup();
        let calls = 0;
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            calls++;
            throw new Error(event.eventId);
        }), { agentPath: path, policy: { id: 'another-policy', version: '1.0.0' } });
        expect(await supervisor.tick('2026-09-08T08:00:00.000Z')).toEqual([
            expect.objectContaining({ status: 'skipped', reason: expect.stringContaining('Unsupported') })
        ]);
        expect(calls).toBe(0);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired', revision: 1 });
        reopened.close();
    });

    test('does not claim an avatar while an adopted skill is still active', async () => {
        const path = setup();
        let calls = 0;
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            calls++;
            throw new Error(event.eventId);
        }), { agentPath: path, activeSkill: username => username === 'ferrye14' ? { status: 'running' } : null });
        expect(await supervisor.tick('2026-09-08T08:00:00.000Z', true)).toEqual([
            expect.objectContaining({ status: 'skipped', reason: expect.stringContaining('must finish') })
        ]);
        expect(calls).toBe(0);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired', revision: 1 });
        reopened.close();
    });

    test('persists a retry instead of claiming while the desired bot session starts', async () => {
        const path = setup();
        let calls = 0;
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            calls++;
            throw new Error(event.eventId);
        }), { agentPath: path, retryMs: 30_000,
            ensureAvatar: async () => ({ ready: false, reason: 'Bot process started.' }) });
        expect(await supervisor.tick('2026-09-08T08:00:00.000Z', true)).toEqual([
            expect.objectContaining({ status: 'skipped', reason: 'Bot process started.' })
        ]);
        expect(calls).toBe(0);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired',
            nextWakeupAt: '2026-09-08T08:00:30.000Z', revision: 2 });
        reopened.close();
    });

    test('does not execute an explicitly sleeping avatar even when its session is online', async () => {
        const path = setup(); let plans = 0;
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            plans++; throw new Error(event.eventId);
        }), { agentPath: path, retryMs: 30_000,
            ensureAvatar: async () => ({ ready: true, status: 'adopted', reason: 'Avatar online.' }),
            timeCapabilities: () => ({ worldClockAdvances: true, physicalExecutionAllowed: false,
                offlineDelegationAllowed: false, reason: 'Sleeping is an explicit physical state.' }) });
        expect(await supervisor.tick('2026-09-08T08:00:00.000Z')).toEqual([
            expect.objectContaining({ status: 'skipped', reason: 'Sleeping is an explicit physical state.' })
        ]);
        expect(plans).toBe(0);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired',
            nextWakeupAt: '2026-09-08T08:00:30.000Z', revision: 2 });
        reopened.close();
    });

    test('bounds repeated avatar respawns with exponential backoff and requires fresh state before planning', async () => {
        const path = setup();
        let plans = 0;
        const states: Array<'spawned' | 'failed'> = ['spawned', 'failed', 'failed'];
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            plans++;
            throw new Error(event.eventId);
        }), { agentPath: path, retryMs: 30_000, maxRetryMs: 120_000, maxIdenticalFailures: 3,
            ensureAvatar: async () => {
                const status = states.shift() ?? 'failed';
                return { ready: false, status, reason: `Avatar ${status}.` };
            } });
        await supervisor.tick('2026-09-08T08:00:00.000Z', true);
        expect(await supervisor.tick('2026-09-08T08:00:01.000Z')).toEqual([]);
        await supervisor.tick('2026-09-08T08:00:30.000Z');
        expect(await supervisor.tick('2026-09-08T08:01:29.000Z')).toEqual([]);
        expect(await supervisor.tick('2026-09-08T08:01:30.000Z')).toEqual([
            expect.objectContaining({ status: 'failed', reason: expect.stringContaining('recovery circuit') })
        ]);
        expect(plans).toBe(0);
        const store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'quarantined',
            failureCount: 3, nextWakeupAt: null });
        store.close();
    });

    test('does not recover or claim work while the durable emergency stop is active', async () => {
        const path = setup();
        const store = new AgentStateStore(path);
        store.setAutonomyEmergencyStop(store.getAutonomyControl().revision, true, 'Test stop.',
            '2026-09-08T08:00:00.000Z');
        store.close();
        let calls = 0;
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator(async event => {
            calls++;
            throw new Error(event.eventId);
        }), { agentPath: path });

        expect(await supervisor.tick('2026-09-08T08:01:00.000Z', true)).toEqual([]);
        expect(calls).toBe(0);
        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('ferrye14')).toMatchObject({ status: 'desired', revision: 1 });
        reopened.close();
    });
});
