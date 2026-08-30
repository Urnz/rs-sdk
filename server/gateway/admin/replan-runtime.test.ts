import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { AgentReplanCoordinator } from './replan-coordinator.js';
import { dispatchVerifiedCapabilityWakeups } from './replan-runtime.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function verifiedGap(store: CapabilityGapStore) {
    const reported = await store.report({ agentId: 'agent-14', goalId: 'mine-copper',
        anchorGoalId: 'build-career', title: 'Mine copper' });
    const assigned = await store.transition(reported.gap.gapId, reported.gap.revision, 'assigned', {
        assignedWorkerId: 'skill-builder'
    });
    const draft = await store.transition(assigned.gapId, assigned.revision, 'draft', {
        draftSkill: { id: 'mining.copper', version: '0.1.0' }
    });
    const validating = await store.transition(draft.gapId, draft.revision, 'validating');
    const trial = await store.transition(validating.gapId, validating.revision, 'live-trial');
    return store.transition(trial.gapId, trial.revision, 'verified', {
        resolvedSkill: { id: 'mining.copper', version: '1.0.0' }
    });
}

describe('verified capability wakeups', () => {
    test('retries an offline agent and delivers a verified capability exactly once', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-capability-wakeup-'));
        directories.push(root);
        const store = new CapabilityGapStore(join(root, 'gaps.json'));
        await verifiedGap(store);
        let attempts = 0;
        const coordinator = new AgentReplanCoordinator({
            resolveAgentId: async () => null,
            listAgentIds: async () => [],
            plan: async (_agentId, event) => ({ runId: event.eventId,
                status: ++attempts === 1 ? 'skipped' : 'proposed', reason: attempts === 1 ? 'offline' : 'planned' }),
            append: () => undefined
        });

        const first = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:00.000Z');
        const second = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:01.000Z');
        const third = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:02.000Z');

        expect(first[0]?.outcome?.status).toBe('skipped');
        expect(second[0]?.outcome?.status).toBe('proposed');
        expect(third).toHaveLength(0);
        expect(attempts).toBe(2);
    });
});
