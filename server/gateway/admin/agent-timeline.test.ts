import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { readAgentTimeline } from './agent-timeline.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('unified agent timeline', () => {
    test('correlates durable wake-up, context, policy, binding, evidence, memory, goal and next wake-up', () => {
        const root = mkdtempSync(join(tmpdir(), 'rs-agent-timeline-')); directories.push(root);
        const agentPath = join(root, 'agents.sqlite'), inboxPath = join(root, 'inbox.sqlite');
        const eventId = '11111111-1111-4111-8111-111111111111';
        const runId = '22222222-2222-4222-8222-222222222222';
        const digest = 'a'.repeat(64);
        const store = new AgentStateStore(agentPath);
        store.createIdentity({ agentId: 'worker', playerUsername: 'Worker', displayName: 'Worker',
            background: 'Timeline worker.', personalityTraits: ['careful'] }, '2026-09-11T10:00:00.000Z');
        const enrollment = store.createAutonomyEnrollment('worker', { status: 'desired', policyId: 'local',
            policyVersion: '1.0.0', nextWakeupAt: '2026-09-11T10:00:30.000Z' }, '2026-09-11T10:00:10.000Z');
        store.claimAutonomyEnrollment('worker', enrollment.revision, 'gateway:test',
            '2026-09-11T10:20:00.000Z', '2026-09-11T10:01:00.000Z');
        store.createGoal('worker', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        store.createGoal('worker', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term', title: 'Work' });
        store.createGoal('worker', { goalId: 'current', parentGoalId: 'career', horizon: 'current', title: 'Produce' });
        store.createGoal('worker', { goalId: 'task', parentGoalId: 'current', horizon: 'immediate', title: 'Mine',
            skill: { id: 'mining.safe', version: '1.0.0' }, execution: { policy: 'one-shot', binding: {
                sourceKind: 'goal', sourceId: 'task', parameters: { loads: 1 }
            } } }, '2026-09-11T10:01:10.000Z');
        const profile = store.getControlProfile('worker')!;
        store.recordDecision('worker', profile.revision, { decisionId: eventId, trigger: 'event',
            contextDigest: digest }, '2026-09-11T10:01:20.000Z');
        store.recordSkillDispatch({ runId, decisionId: eventId, agentId: 'worker', goalId: 'task',
            skill: { id: 'mining.safe', version: '1.0.0' }, binding: store.getGoalExecution('task')!.binding,
            policyId: 'local', policyVersion: '1.0.0' }, '2026-09-11T10:01:30.000Z');
        store.recordSkillRunOutcome(runId, 'completed', 'completed', 'One load banked.',
            '2026-09-11T10:02:00.000Z');
        store.createEpisode('worker', { episodeId: 'episode.timeline', kind: 'outcome', summary: 'Remembered outcome.',
            source: 'skill', occurredAt: '2026-09-11T10:02:10.000Z' });
        store.close();

        const inbox = new ReplanInboxStore(inboxPath);
        const queued = inbox.enqueue({ eventId, agentId: 'worker', type: 'manual-request', sourceKey: 'manual:timeline',
            occurredAt: '2026-09-11T10:01:00.000Z', summary: 'Run the task.' }, '2026-09-11T10:01:00.000Z');
        const claimed = inbox.claim(eventId, 'gateway:test', '2026-09-11T10:20:00.000Z',
            '2026-09-11T10:01:05.000Z')!;
        inbox.resolve(eventId, claimed.revision, 'gateway:test', JSON.stringify({
            timestamp: '2026-09-11T10:01:20.000Z', event: queued.record.event,
            gate: { accepted: true, reason: 'accepted', nextAllowedAt: '2026-09-11T10:01:20.000Z' },
            outcome: { runId, status: 'executing', reason: 'Policy admitted the exact skill.' }, error: null
        }), 'completed', '2026-09-11T10:01:40.000Z');
        inbox.close();

        const result = readAgentTimeline('worker', { agentPath, inboxPath });
        expect(new Set(result.entries.map(entry => entry.kind))).toEqual(new Set([
            'wake-up', 'policy-result', 'decision', 'parameter-binding', 'evidence',
            'memory-update', 'goal-update', 'next-wake-up'
        ]));
        expect(result.entries.find(entry => entry.kind === 'decision')?.details.contextDigest).toBe(digest);
        expect(result.entries.find(entry => entry.kind === 'parameter-binding')).toMatchObject({
            correlation: { decisionId: eventId, runId, goalId: 'task', sourceId: 'task' },
            details: { policyId: 'local', binding: { digest: expect.any(String), parameters: { loads: 1 } } }
        });
        expect(result.entries.find(entry => entry.kind === 'evidence')).toMatchObject({ status: 'completed',
            correlation: { decisionId: eventId, runId, goalId: 'task' } });
    });

    test('rejects unknown agents and unbounded limits', () => {
        const root = mkdtempSync(join(tmpdir(), 'rs-agent-timeline-')); directories.push(root);
        const agentPath = join(root, 'agents.sqlite');
        const store = new AgentStateStore(agentPath); store.close();
        expect(() => readAgentTimeline('missing', { agentPath })).toThrow('Unknown agent timeline');
        expect(() => readAgentTimeline('missing', { agentPath, limit: 1001 })).toThrow('timeline limit');
    });
});
