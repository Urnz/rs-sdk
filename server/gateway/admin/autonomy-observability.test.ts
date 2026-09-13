import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { SqliteInferenceQueueClaimStore } from '../../../llm-runtime/inference-queue-store.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { readAutonomyObservability, type AgentView } from './autonomy-observability.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function view(agentId: string, enrollment: AgentView['autonomyEnrollment'], blockers: string[] = []): AgentView {
    return { identity: { agentId }, controlProfile: { avatarPlayerUsername: agentId },
        autonomyEnrollment: enrollment, decisionContextBlockers: blockers, goalProposals: [],
        planner: { kind: 'ready' }, recentEpisodes: [], workingMemory: null };
}

describe('autonomy observability dashboard', () => {
    test('ships the dashboard container, status feed and explicit wait labels', () => {
        const html = readFileSync(join(import.meta.dir, 'public', 'index.html'), 'utf8');
        const script = readFileSync(join(import.meta.dir, 'public', 'admin.js'), 'utf8');
        expect(html).toContain('id="autonomy-dashboard"');
        expect(script).toContain("api('/api/admin/autonomy/status')");
        for (const label of ['admin jóváhagyás', 'friss state', 'capability', 'fail-closed reconciliation']) {
            expect(script).toContain(label);
        }
        for (const field of ['replanQueue', 'inferenceQueue', 'costToday', 'lastVerifiedProgressAt', 'nextWakeupAt']) {
            expect(script).toContain(field);
        }
    });

    test('summarizes state, wait reason, queues, lease, daily cost and progress without mutation', () => {
        const root = mkdtempSync(join(tmpdir(), 'rs-autonomy-observability-')); directories.push(root);
        const agentPath = join(root, 'agents.sqlite'), inboxPath = join(root, 'inbox.sqlite');
        const inferencePath = join(root, 'inference.sqlite');
        const store = new AgentStateStore(agentPath);
        for (const agentId of ['worker', 'blocked']) store.createIdentity({ agentId, playerUsername: agentId,
            displayName: agentId, background: 'Observer fixture.', personalityTraits: ['careful'],
            controlProfile: { role: 'player', subjectKind: 'player', subjectId: agentId,
                avatarPlayerUsername: agentId, decisionIntervalMs: 60_000, maxDecisionsPerDay: 20,
                dailyLlmBudgetMicros: 1_000, dailyOperationalBudgetGp: 100 } },
        '2026-09-11T10:00:00.000Z');
        const worker = store.createAutonomyEnrollment('worker', { status: 'desired', policyId: 'local',
            policyVersion: '1.0.0', nextWakeupAt: '2026-09-11T11:00:00.000Z' }, '2026-09-11T10:00:00.000Z');
        store.createAutonomyEnrollment('blocked', { status: 'quarantined', policyId: 'local',
            policyVersion: '1.0.0', quarantineReason: 'Ambiguous settlement.' }, '2026-09-11T10:00:00.000Z');
        const profile = store.getControlProfile('worker')!;
        store.recordDecision('worker', profile.revision, { decisionId: 'decision.dashboard', trigger: 'event',
            llmCostMicros: 250, operationalBudgetGp: 40, contextDigest: 'b'.repeat(64) },
        '2026-09-11T10:10:00.000Z');
        store.close();
        const inbox = new ReplanInboxStore(inboxPath);
        inbox.enqueue({ eventId: '11111111-1111-4111-8111-111111111111', agentId: 'worker',
            type: 'manual-request', sourceKey: 'dashboard:test', occurredAt: '2026-09-11T10:20:00.000Z',
            summary: 'Observe queue.' }, '2026-09-11T10:20:00.000Z');
        inbox.close();
        const inference = new SqliteInferenceQueueClaimStore(inferencePath);
        inference.admit({ requestId: 'inference.dashboard', agentId: 'worker', priority: 10,
            enqueuedAt: '2026-09-11T10:21:00.000Z' }, 10);
        expect(inference.listForAgent('worker')).toHaveLength(1);
        inference.close();

        const result = readAutonomyObservability([
            { ...view('worker', { ...worker, status: 'desired', leaseOwner: null, leaseExpiresAt: null,
                nextWakeupAt: '2026-09-11T11:00:00.000Z', failureCount: 0, quarantineReason: null },
            ['No fresh online state is available.']), recentEpisodes: [{ trust: 'trusted', source: 'skill',
                occurredAt: '2026-09-11T10:15:00.000Z' }] },
            view('blocked', { status: 'quarantined', nextWakeupAt: null, leaseOwner: null,
                leaseExpiresAt: null, failureCount: 3, quarantineReason: 'Ambiguous settlement.' })
        ], { agentPath, inboxPath, inferencePath, now: '2026-09-11T10:30:00.000Z' });
        expect(result.agents[0]).toMatchObject({ agentId: 'worker', status: 'backoff', waitingFor: 'fresh-state',
            replanQueue: { pending: 1, claimed: 0 }, inferenceQueue: { pending: 1, claimed: 0 },
            costToday: { llmMicros: 250, operationalGp: 40, decisions: 1 },
            lastVerifiedProgressAt: '2026-09-11T10:15:00.000Z', nextWakeupAt: '2026-09-11T11:00:00.000Z' });
        expect(result.agents[1]).toMatchObject({ status: 'quarantined',
            waitingFor: 'fail-closed-reconciliation' });
    });
});
