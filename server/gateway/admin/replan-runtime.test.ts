import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { AgentReplanCoordinator } from './replan-coordinator.js';
import { dispatchVerifiedCapabilityWakeups, evaluateAutonomousSkillPolicy } from './replan-runtime.js';
import type { SkillDefinition, SkillOperationName } from '../../../agent-skills/types.js';

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

function skill(operation: SkillOperationName = 'gather-loc'): SkillDefinition {
    return { schemaVersion: 1, id: 'mining.safe', version: '1.0.0', name: 'Safe mining',
        description: 'Mine and bank ore.', status: 'verified', tags: ['mining'], parameters: {},
        provenance: { authorKind: 'human', authorId: 'test', createdAt: '2026-08-31T10:00:00.000Z' },
        sharing: { visibility: 'shared' }, limits: { timeoutMs: 60_000, maxOperations: 20 },
        preconditions: [], steps: [{ kind: 'operation', id: 'step', operation, arguments: {} }] };
}

describe('autonomous skill execution policy', () => {
    const config = { enabled: true, allowedSkills: [{ id: 'mining.safe', version: '1.0.0' }],
        maxOperations: 50, maxTimeoutMs: 120_000 };

    test('allows only the exact verified bounded skill reference', () => {
        expect(evaluateAutonomousSkillPolicy(config, skill())).toMatchObject({ allowed: true });
        expect(evaluateAutonomousSkillPolicy({ ...config, allowedSkills: [] }, skill()))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('allowlist') });
        expect(evaluateAutonomousSkillPolicy(config, { ...skill(), limits: { timeoutMs: 60_000, maxOperations: 51 } }))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('limit') });
    });

    test('forbids economic transfers and composed calls even when allowlisted', () => {
        expect(evaluateAutonomousSkillPolicy(config, skill('buy-from-shop')))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('forbidden') });
        expect(evaluateAutonomousSkillPolicy(config, { ...skill(), steps: [{ kind: 'call', id: 'nested',
            skill: { id: 'procedure.route', version: '1.0.0' }, arguments: {} }] }))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('Composed') });
    });
});
