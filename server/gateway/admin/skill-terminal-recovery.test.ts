import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { AdminSkillRun } from './skill-history.js';
import { recoverOrphanedSkillWakeups, recoverSkillTerminalWakeups } from './skill-terminal-recovery.js';
import type { SkillMarkerReconciliation } from './supervisor.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { EconomicContractStore } from './economic-contracts.js';

const directories: string[] = [];

function setup(): { agentPath: string; inboxPath: string } {
    const directory = mkdtempSync(join(tmpdir(), 'rs-skill-terminal-recovery-'));
    directories.push(directory);
    const agentPath = join(directory, 'agents.sqlite');
    const store = new AgentStateStore(agentPath);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Recovery test.', personalityTraits: ['careful'] }, '2026-09-08T10:00:00.000Z');
    const desired = store.createAutonomyEnrollment('ferrye14', { status: 'desired',
        policyId: 'private-local-default', policyVersion: '1.0.0' }, '2026-09-08T10:00:00.000Z');
    store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:dead',
        '2026-09-08T10:20:00.000Z', '2026-09-08T10:01:00.000Z');
    store.close();
    return { agentPath, inboxPath: join(directory, 'inbox.sqlite') };
}

function run(overrides: Partial<AdminSkillRun> = {}): AdminSkillRun {
    return { runId: '11111111-1111-4111-8111-111111111111', username: 'ferrye14',
        skill: { id: 'copper-to-bank', version: '1.0.0' }, status: 'completed', reason: 'completed',
        message: 'Ore was banked.', operations: 4, durationMs: 2_000,
        parameters: {}, startedAt: '2026-09-08T10:02:00.000Z', finishedAt: '2026-09-08T10:03:00.000Z', events: [],
        ...overrides };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('terminal skill journal recovery', () => {
    test('enqueues an exact terminal wakeup once for the running enrollment across repeated scans', async () => {
        const paths = setup();
        const options = { agentPath: paths.agentPath, loadRuns: async () => [run()] };
        expect(await recoverSkillTerminalWakeups(paths.inboxPath, options)).toMatchObject({
            scannedRuns: 1, matchedEnrollments: 1,
            createdEventIds: ['11111111-1111-4111-8111-111111111111'], existingEventIds: []
        });
        expect(await recoverSkillTerminalWakeups(paths.inboxPath, options)).toMatchObject({
            createdEventIds: [], existingEventIds: ['11111111-1111-4111-8111-111111111111']
        });
        const inbox = new ReplanInboxStore(paths.inboxPath);
        expect(inbox.get('11111111-1111-4111-8111-111111111111')).toMatchObject({ status: 'pending',
            event: { agentId: 'ferrye14', type: 'skill-finished', sourceKey:
                'skill:11111111-1111-4111-8111-111111111111:terminal' } });
        inbox.close();
    });

    test('reconciles a paid work-order journal once and preserves its restart settlement id', async () => {
        const paths = setup();
        const store = new AgentStateStore(paths.agentPath);
        store.createIdentity({ agentId: 'forge', displayName: 'Forge', background: 'Institution.',
            personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'business',
                subjectId: 'forge', decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 1_000 } },
        '2026-09-08T10:00:00.000Z');
        store.setSkillKnowledge('ferrye14', run().skill, 'known', null,
            '2026-09-08T10:00:05.000Z');
        const request = store.createPlayerActionRequest('forge', { requestId: 'forge.recovery-job',
            assigneeAgentId: 'ferrye14', skill: run().skill, parameters: {}, objective: 'Bank ore.',
            rewardGp: 500 }, '2026-09-08T10:00:10.000Z');
        const accepted = store.setPlayerActionRequestStatus(request.requestId, 'ferrye14', request.revision,
            'accepted', 'Accepted.', '2026-09-08T10:00:20.000Z');
        const approved = store.approvePlayerActionRequest(request.requestId, 'ferrye14', accepted.revision,
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-08T10:30:00.000Z',
            '2026-09-08T10:00:30.000Z');
        store.startApprovedPlayerAction(request.requestId, 'ferrye14', approved.revision,
            approved.approvalId!, run().runId, '2026-09-08T10:00:40.000Z');
        store.close();

        const options = { agentPath: paths.agentPath, loadRuns: async () => [run()] };
        const first = await recoverSkillTerminalWakeups(paths.inboxPath, options);
        expect(first.reconciledWorkOrderRunIds).toEqual([run().runId]);
        const afterFirst = new AgentStateStore(paths.agentPath);
        const settling = afterFirst.getPlayerActionRequest(request.requestId)!;
        expect(settling).toMatchObject({ status: 'settling', runId: run().runId,
            settlementId: expect.any(String) });
        const settlementId = settling.settlementId;
        afterFirst.close();

        const replay = await recoverSkillTerminalWakeups(paths.inboxPath, options);
        expect(replay.reconciledWorkOrderRunIds).toEqual([run().runId]);
        const afterReplay = new AgentStateStore(paths.agentPath);
        expect(afterReplay.getPlayerActionRequest(request.requestId)).toMatchObject({
            status: 'settling', settlementId, revision: settling.revision
        });
        afterReplay.close();
    });

    test('maps non-success terminals to failure and ignores foreign or pre-lease journals', async () => {
        const paths = setup();
        const failed = run({ runId: '22222222-2222-4222-8222-222222222222', status: 'limit-reached' });
        const result = await recoverSkillTerminalWakeups(paths.inboxPath, { agentPath: paths.agentPath,
            loadRuns: async () => [run({ runId: '33333333-3333-4333-8333-333333333333', username: 'other' }),
                run({ runId: '44444444-4444-4444-8444-444444444444',
                    startedAt: '2026-09-08T09:00:00.000Z' }), failed] });
        expect(result).toMatchObject({ scannedRuns: 3, matchedEnrollments: 1,
            createdEventIds: ['22222222-2222-4222-8222-222222222222'] });
        const inbox = new ReplanInboxStore(paths.inboxPath);
        expect(inbox.get(failed.runId)?.event.type).toBe('skill-failed');
        inbox.close();
    });

    test('commits a linked terminal outcome before emitting the durable goal-change wakeup', async () => {
        const paths = setup();
        const store = new AgentStateStore(paths.agentPath);
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        store.createGoal('ferrye14', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term', title: 'Mine' });
        store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: 'career', horizon: 'current', title: 'Capital' });
        store.createGoal('ferrye14', { goalId: 'bank-ore', parentGoalId: 'capital', horizon: 'immediate',
            title: 'Bank ore', skill: { id: 'copper-to-bank', version: '1.0.0' }, execution: {
                policy: 'one-shot', binding: { sourceKind: 'goal', sourceId: 'bank-ore', parameters: {} }
            } }, '2026-09-08T10:01:30.000Z');
        const profile = store.getControlProfile('ferrye14')!;
        store.recordDecision('ferrye14', profile.revision, { decisionId: 'decision.recovery', trigger: 'event' },
            '2026-09-08T10:01:40.000Z');
        const binding = store.getGoalExecution('bank-ore')!.binding;
        store.recordSkillDispatch({ runId: run().runId, decisionId: 'decision.recovery', agentId: 'ferrye14',
            goalId: 'bank-ore', skill: { id: 'copper-to-bank', version: '1.0.0' }, binding,
            policyId: 'private-local-default', policyVersion: '1.0.0' }, '2026-09-08T10:01:50.000Z');
        store.close();

        await recoverSkillTerminalWakeups(paths.inboxPath, { agentPath: paths.agentPath, loadRuns: async () => [run()] });
        const verified = new AgentStateStore(paths.agentPath);
        expect(verified.getSkillRunOutcome(run().runId)).toMatchObject({ status: 'completed', classification: 'completed' });
        expect(verified.getGoal('bank-ore')?.status).toBe('completed');
        const completedEvent = verified.listGoalEvents('ferrye14').find(event => event.goalId === 'bank-ore'
            && event.kind === 'status-changed');
        verified.close();
        const inbox = new ReplanInboxStore(paths.inboxPath);
        const goalWakeupExists = inbox.listForAgent('ferrye14', 100).some(item => item.event.sourceKey
            === `goal:bank-ore:event:${completedEvent!.sequence}:at:${completedEvent!.occurredAt}`);
        inbox.close();
        expect(goalWakeupExists).toBe(true);
    });

    test('submits an exact contract-obligation run journal idempotently', async () => {
        const paths = setup();
        const contractPath = join(dirname(paths.agentPath), 'economic-contracts.sqlite');
        const contracts = new EconomicContractStore(contractPath);
        const offer = contracts.create({ creatorAgentId: 'ferrye14', counterpartyAgentId: 'buyer1',
            kind: 'service', title: 'Bank ore', summary: 'Provide one verified banking service.',
            creatorProvides: { gp: 0, items: [], service: 'Bank ore',
                skill: { id: 'copper-to-bank', version: '1.0.0' } },
            counterpartyProvides: { gp: 0, items: [], service: 'Inspect delivery',
                skill: { id: 'inspect-delivery', version: '1.0.0' } },
            expiresAt: '2026-09-09T10:00:00.000Z' }, '2026-09-08T10:00:00.000Z',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const accepted = contracts.accept(offer.offerId, 'buyer1', offer.revision,
            '2026-09-08T10:01:00.000Z', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        contracts.close();

        const store = new AgentStateStore(paths.agentPath);
        store.createIdentity({ agentId: 'buyer1', playerUsername: 'Buyer1', displayName: 'Buyer',
            background: 'Contract counterparty.', personalityTraits: ['careful'] }, '2026-09-08T10:00:00.000Z');
        store.createGoal('ferrye14', { goalId: 'life-contract', horizon: 'life', title: 'Prosper' });
        store.createGoal('ferrye14', { goalId: 'career-contract', parentGoalId: 'life-contract',
            horizon: 'long-term', title: 'Serve' });
        store.createGoal('ferrye14', { goalId: 'current-contract', parentGoalId: 'career-contract',
            horizon: 'current', title: 'Fulfil contract' });
        store.createGoal('ferrye14', { goalId: 'obligation-contract', parentGoalId: 'current-contract',
            horizon: 'immediate', title: 'Bank ore', skill: { id: 'copper-to-bank', version: '1.0.0' },
            execution: { policy: 'one-shot', binding: { sourceKind: 'contract-obligation',
                sourceId: accepted.contract.contractId, parameters: {} } } }, '2026-09-08T10:01:20.000Z');
        const profile = store.getControlProfile('ferrye14')!;
        store.recordDecision('ferrye14', profile.revision, { decisionId: 'decision.contract', trigger: 'event' },
            '2026-09-08T10:01:30.000Z');
        store.recordSkillDispatch({ runId: run().runId, decisionId: 'decision.contract', agentId: 'ferrye14',
            goalId: 'obligation-contract', skill: { id: 'copper-to-bank', version: '1.0.0' },
            binding: store.getGoalExecution('obligation-contract')!.binding,
            policyId: 'private-local-default', policyVersion: '1.0.0' }, '2026-09-08T10:01:50.000Z');
        store.close();

        const options = { agentPath: paths.agentPath, economicContractsPath: contractPath,
            loadRuns: async () => [run()] };
        await recoverSkillTerminalWakeups(paths.inboxPath, options);
        await recoverSkillTerminalWakeups(paths.inboxPath, options);
        const verifiedContracts = new EconomicContractStore(contractPath);
        expect(verifiedContracts.getContract(accepted.contract.contractId)).toMatchObject({
            partyASatisfied: true,
            evidence: [{ runId: run().runId, actorAgentId: 'ferrye14', matchedService: true }]
        });
        verifiedContracts.close();
    });

    test('turns a proven-dead exact marker without a journal into one orphan failure event', async () => {
        const paths = setup();
        const markers: SkillMarkerReconciliation[] = [{ username: 'ferrye14', status: 'stale-removed',
            reason: 'Marker PID is no longer alive.', snapshot: { runId: '55555555-5555-4555-8555-555555555555',
                status: 'error', pid: null, skill: 'mining.safe@1.0.0',
                startedAt: '2026-09-08T10:02:00.000Z', exitCode: null, logPath: 'test.log' } }];
        const options = { agentPath: paths.agentPath, loadRun: async () => null };
        expect(await recoverOrphanedSkillWakeups(paths.inboxPath, markers, options)).toMatchObject({
            examinedMarkers: 1, createdEventIds: ['55555555-5555-4555-8555-555555555555']
        });
        expect(await recoverOrphanedSkillWakeups(paths.inboxPath, markers, options)).toMatchObject({
            createdEventIds: [], existingEventIds: ['55555555-5555-4555-8555-555555555555']
        });
        const inbox = new ReplanInboxStore(paths.inboxPath);
        expect(inbox.get('55555555-5555-4555-8555-555555555555')).toMatchObject({ event: {
            type: 'skill-failed', occurredAt: '2026-09-08T10:02:00.000Z',
            sourceKey: 'skill:55555555-5555-4555-8555-555555555555:terminal'
        } });
        inbox.close();
    });

    test('does not invent an orphan event when the terminal journal exists', async () => {
        const paths = setup();
        const completed = run();
        const markers: SkillMarkerReconciliation[] = [{ username: 'ferrye14', status: 'stale-removed',
            reason: 'Marker PID is no longer alive.', snapshot: { runId: completed.runId, status: 'error', pid: null,
                skill: 'copper-to-bank@1.0.0', startedAt: completed.startedAt, exitCode: null, logPath: 'test.log' } }];
        expect(await recoverOrphanedSkillWakeups(paths.inboxPath, markers, {
            agentPath: paths.agentPath, loadRun: async () => completed
        })).toMatchObject({ journaledRunIds: [completed.runId], createdEventIds: [] });
    });
});
