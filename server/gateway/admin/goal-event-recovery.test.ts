import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { DurableAgentReplanCoordinator } from './durable-replan-coordinator.js';
import { enqueueLatestGoalEventWakeup, recoverGoalEventWakeups } from './goal-event-recovery.js';
import { ReplanInboxStore } from './replan-inbox.js';

const directories: string[] = [];

function setup(status: 'desired' | 'paused' = 'desired') {
    const root = mkdtempSync(join(tmpdir(), 'rs-goal-wakeup-'));
    directories.push(root);
    const agentPath = join(root, 'agents.sqlite');
    const inboxPath = join(root, 'inbox.sqlite');
    const store = new AgentStateStore(agentPath);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Goal wakeup test agent.', personalityTraits: ['patient'] }, '2026-09-08T10:00:00.000Z');
    store.createAutonomyEnrollment('ferrye14', { status, policyId: 'private-local-default',
        policyVersion: '1.0.0' }, '2026-09-08T10:01:00.000Z');
    const life = store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' },
        '2026-09-08T10:02:00.000Z');
    const long = store.createGoal('ferrye14', { goalId: 'career', parentGoalId: life.goalId,
        horizon: 'long-term', title: 'Build a career' }, '2026-09-08T10:03:00.000Z');
    const current = store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: long.goalId,
        horizon: 'current', title: 'Build capital' }, '2026-09-08T10:04:00.000Z');
    const immediate = store.createGoal('ferrye14', { goalId: 'mine', parentGoalId: current.goalId,
        horizon: 'immediate', title: 'Mine copper' }, '2026-09-08T10:05:00.000Z');
    store.close();
    const coordinator = new DurableAgentReplanCoordinator({ resolveAgentId: async () => null,
        listAgentIds: async () => [], plan: async (_agentId, event) => ({ runId: event.eventId,
            status: 'skipped', reason: 'Planner must not run during goal enqueue.' }), append: () => undefined
    }, { path: inboxPath });
    return { agentPath, inboxPath, immediate, coordinator };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('goal event wakeup recovery', () => {
    test('queues a new immediate goal once from its committed AgentState event', () => {
        const paths = setup();
        expect(enqueueLatestGoalEventWakeup(paths.coordinator, 'ferrye14', 'mine', paths.agentPath)).toBeTrue();
        expect(recoverGoalEventWakeups(paths.inboxPath, paths.agentPath)).toMatchObject({
            scannedEvents: 4, createdEventIds: [], existingEventIds: [expect.any(String)]
        });
        const inbox = new ReplanInboxStore(paths.inboxPath);
        expect(inbox.nextClaimableForAgent('ferrye14', '2026-09-08T10:05:00.000Z')).toMatchObject({ event: {
            type: 'goal-changed',
            sourceKey: 'goal:mine:event:4:at:2026-09-08T10:05:00.000Z',
            occurredAt: '2026-09-08T10:05:00.000Z'
        } });
        inbox.close();
    });

    test('recovers completed, blocked and abandoned transitions with stable source keys', () => {
        for (const [index, status] of ['completed', 'blocked', 'abandoned'].entries()) {
            const paths = setup();
            const store = new AgentStateStore(paths.agentPath);
            store.setGoalStatus('mine', paths.immediate.revision, status as 'completed' | 'blocked' | 'abandoned',
                `2026-09-08T10:0${6 + index}:00.000Z`);
            store.close();
            const first = recoverGoalEventWakeups(paths.inboxPath, paths.agentPath);
            expect(first.createdEventIds).toHaveLength(1);
            expect(recoverGoalEventWakeups(paths.inboxPath, paths.agentPath).existingEventIds)
                .toEqual(first.createdEventIds);
            const inbox = new ReplanInboxStore(paths.inboxPath);
            expect(inbox.nextClaimableForAgent('ferrye14', `2026-09-08T10:0${6 + index}:00.000Z`))
                .toMatchObject({ event: { sourceKey: `goal:mine:event:5:at:2026-09-08T10:0${6 + index}:00.000Z`,
                    summary: expect.stringContaining(status) } });
            inbox.close();
        }
    });

    test('ignores goal events for paused enrollments', () => {
        const paths = setup('paused');
        expect(recoverGoalEventWakeups(paths.inboxPath, paths.agentPath)).toEqual({
            scannedEvents: 0, createdEventIds: [], existingEventIds: []
        });
    });
});
