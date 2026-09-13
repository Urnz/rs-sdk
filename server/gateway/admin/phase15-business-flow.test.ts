import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { BusinessManagerStore } from './business-manager.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { createAdminPlayerActionRequest, delegateBusinessPlayerAction,
    recoverAdminPlayerActionSettlements, settleAdminPlayerActionReward } from './agent-state.js';
import { evaluateAutonomousSkillPolicy } from './replan-runtime.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';
import { recoverSkillTerminalWakeups } from './skill-terminal-recovery.js';
import { ingestAgentMemories } from './agent-memory-ingestion.js';
import { ReplanInboxStore } from './replan-inbox.js';
import type { AdminSkillRun } from './skill-history.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

const skill: SkillDefinition = { schemaVersion: 1, id: 'mining.safe', version: '1.0.0', name: 'Safe mining',
    description: 'Mine one verified batch.', status: 'verified', tags: ['mining'], parameters: {},
    provenance: { authorKind: 'human', authorId: 'test', createdAt: '2026-09-01T00:00:00.000Z' },
    sharing: { visibility: 'shared' }, limits: { timeoutMs: 60_000, maxOperations: 20 }, preconditions: [],
    steps: [{ kind: 'operation', id: 'mine', operation: 'gather-loc', arguments: {} }] };

describe('phase 15 Business work-order acceptance flow', () => {
    test('carries two players through policy, exact journal, treasury, memory, goal and replan', async () => {
        const root = mkdtempSync(join(tmpdir(), 'phase15-business-flow-')); roots.push(root);
        const agentPath = join(root, 'agents.sqlite'), businessPath = join(root, 'businesses.sqlite');
        const treasuryPath = join(root, 'institution-treasury.sqlite'), inboxPath = join(root, 'inbox.sqlite');
        const agents = new AgentStateStore(agentPath);
        const workers = ['worker-a', 'worker-b'];
        agents.createIdentity({ agentId: 'forge-mind', displayName: 'Forge Mind',
            background: 'Private local Business agent.', personalityTraits: ['prudent'], controlProfile: {
                role: 'institution', subjectKind: 'business', subjectId: 'varrock-forge',
                decisionIntervalMs: 60_000, maxDecisionsPerDay: 20,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 2_000 } });
        for (const worker of workers) {
            agents.createIdentity({ agentId: worker, playerUsername: worker, displayName: worker,
                background: 'Private local worker.', personalityTraits: ['reliable'], controlProfile: {
                    role: 'player', subjectKind: 'player', subjectId: worker, avatarPlayerUsername: worker,
                    decisionIntervalMs: 60_000, maxDecisionsPerDay: 20,
                    dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 1_000 } });
            agents.setSkillKnowledge(worker, { id: skill.id, version: skill.version }, 'known', null);
            agents.createGoal(worker, { goalId: `${worker}.life`, horizon: 'life', title: 'Prosper' });
            agents.createGoal(worker, { goalId: `${worker}.career`, parentGoalId: `${worker}.life`,
                horizon: 'long-term', title: 'Work' });
            agents.createGoal(worker, { goalId: `${worker}.current`, parentGoalId: `${worker}.career`,
                horizon: 'current', title: 'Supply the forge' });
            const enrollment = agents.createAutonomyEnrollment(worker, { status: 'desired',
                policyId: 'private-local-default', policyVersion: '1.0.0' });
            agents.claimAutonomyEnrollment(worker, enrollment.revision, 'gateway:test',
                new Date(Date.now() + 600_000).toISOString());
        }
        agents.close();

        const businesses = new BusinessManagerStore(businessPath);
        businesses.create({ businessId: 'varrock-forge', name: 'Varrock Forge',
            summary: 'Bounded private workshop.', ownerAgentId: 'forge-mind' });
        const proposal = businesses.proposePolicy('varrock-forge', { proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            proposerAgentId: 'forge-mind', objective: 'Pay exact verified mining work.', mode: 'balanced',
            maxRewardGp: 400, preferredSkills: [{ id: skill.id, version: skill.version }] });
        businesses.resolvePolicy('varrock-forge', proposal.proposalId, proposal.revision, 'approve', 'Approved.');
        workers.forEach((worker, index) => businesses.hire('varrock-forge', { workerAgentId: worker, role: 'worker',
            title: 'Miner', wageGp: 400, requiredSkill: { id: skill.id, version: skill.version } }, undefined,
        `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`));
        businesses.close();
        const treasury = new InstitutionTreasuryStore(treasuryPath);
        const account = treasury.ensure('business', 'varrock-forge');
        treasury.setBalance('business', 'varrock-forge', account.revision, 2_000); treasury.close();

        const policy = evaluateAutonomousSkillPolicy({ enabled: true,
            allowedSkills: [{ id: skill.id, version: skill.version, operations: ['gather-loc'] }],
            maxOperations: 20, maxTimeoutMs: 60_000 }, skill);
        expect(policy).toMatchObject({ allowed: true });
        expect(evaluateAuthorizationEnvelope(policy.authorization!, skill, {})).toMatchObject({ allowed: true });

        const runs: AdminSkillRun[] = [];
        const requestIds: string[] = [];
        const settlements: string[] = [];
        for (const [index, worker] of workers.entries()) {
            const request = createAdminPlayerActionRequest('forge-mind', { requestId: `forge.job-${index}`,
                assigneeAgentId: worker, skill: { id: skill.id, version: skill.version }, parameters: {},
                objective: 'Mine one verified batch.', rewardGp: 400 }, agentPath);
            requestIds.push(request.requestId);
            const runId = `${index + 1}1111111-1111-4111-8111-111111111111`;
            const delegated = delegateBusinessPlayerAction(request.requestId, runId, agentPath);
            expect(delegated).toMatchObject({ request: { status: 'running', runId },
                policyId: proposal.proposalId });
            const store = new AgentStateStore(agentPath);
            store.createGoal(worker, { goalId: `${worker}.job`, parentGoalId: `${worker}.current`,
                horizon: 'immediate', title: 'Complete forge work', skill: { id: skill.id, version: skill.version },
                execution: { policy: 'one-shot', binding: { sourceKind: 'work-order',
                    sourceId: request.requestId, parameters: {} } } });
            const profile = store.getControlProfile(worker)!;
            store.recordDecision(worker, profile.revision, { decisionId: `${worker}.decision`, trigger: 'event' });
            store.recordSkillDispatch({ runId, decisionId: `${worker}.decision`, agentId: worker,
                goalId: `${worker}.job`, skill: { id: skill.id, version: skill.version },
                binding: store.getGoalExecution(`${worker}.job`)!.binding,
                policyId: 'private-local-default', policyVersion: '1.0.0' });
            store.close();
            const now = new Date();
            runs.push({ runId, username: worker, skill: { id: skill.id, version: skill.version },
                status: 'completed', reason: 'Completed.', message: 'Verified ore batch.', operations: 1,
                durationMs: 1_000, parameters: {}, startedAt: now.toISOString(),
                finishedAt: new Date(now.getTime() + 1_000).toISOString(), events: [{ runId,
                    type: 'step.succeeded', timestamp: new Date(now.getTime() + 500).toISOString(),
                    skill: { id: skill.id, version: skill.version }, stepId: 'mine', operation: 'gather-loc',
                    data: { inventoryDelta: [{ id: 436, name: 'Copper ore', count: 1, delta: 1 }] } }] });
        }

        const recovered = await recoverSkillTerminalWakeups(inboxPath, { agentPath, loadRuns: async () => runs });
        expect(recovered.reconciledWorkOrderRunIds.sort()).toEqual(runs.map(run => run.runId).sort());
        for (const requestId of requestIds) {
            const store = new AgentStateStore(agentPath);
            const settling = store.getPlayerActionRequest(requestId)!;
            store.close();
            expect(settling.status).toBe('settling'); settlements.push(settling.settlementId!);
            await settleAdminPlayerActionReward(settling.settlementId!, agentPath,
                async (username, amount, settlementId) => ({ ok: true, commandId: `command-${username}`,
                    settlementId, username, amount, reward: { status: 'committed', coinsBefore: 0, coinsAfter: amount } }));
        }
        const memory = await ingestAgentMemories({ databasePath: agentPath, loadRuns: async () => runs });
        expect(memory).toMatchObject({ matchedRuns: 2, createdEpisodes: 4, errors: [] });
        const replayedRecovery = await recoverSkillTerminalWakeups(inboxPath,
            { agentPath, loadRuns: async () => runs });
        expect(replayedRecovery).toMatchObject({ createdEventIds: [],
            existingEventIds: expect.arrayContaining(runs.map(run => run.runId)) });
        const replayedMemory = await ingestAgentMemories({ databasePath: agentPath, loadRuns: async () => runs });
        expect(replayedMemory).toMatchObject({ createdEpisodes: 0, existingEpisodes: 4, errors: [] });
        let replayRewardCalls = 0;
        expect(await recoverAdminPlayerActionSettlements(agentPath, async () => {
            replayRewardCalls++; throw new Error('Completed settlement must not replay.');
        })).toEqual({ attemptedSettlementIds: [], completedSettlementIds: [], errors: [] });
        expect(replayRewardCalls).toBe(0);
        const verified = new AgentStateStore(agentPath);
        for (const worker of workers) {
            expect(verified.getGoal(`${worker}.job`)?.status).toBe('completed');
            expect(verified.listEpisodes(worker)).toHaveLength(2);
            expect(verified.listEpisodes(worker).some(item => item.externalKey?.startsWith('skill-run:'))).toBeTrue();
            expect(verified.listGoalEvents(worker).filter(item => item.goalId === `${worker}.job`
                && item.kind === 'status-changed')).toHaveLength(1);
            expect(verified.listSkillDispatches(worker)).toHaveLength(1);
            expect(verified.listPlayerActionRequests(worker, 'incoming')[0]).toMatchObject({ status: 'completed',
                settlementId: expect.any(String) });
        }
        verified.close();
        const paid = new InstitutionTreasuryStore(treasuryPath);
        expect(paid.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 1_200, reservedGp: 0 });
        paid.close();
        const inbox = new ReplanInboxStore(inboxPath);
        for (const worker of workers) {
            const types = inbox.listForAgent(worker, 20).map(item => item.event.type);
            expect(types).toContain('skill-finished'); expect(types).toContain('goal-changed');
        }
        inbox.close();
    });
});
