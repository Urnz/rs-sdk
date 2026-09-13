import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AGENT_STATE_SCHEMA_VERSION, AgentStateStore } from '../index.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-autonomy-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

function addIdentity(store: AgentStateStore, agentId = 'ferrye14'): void {
    store.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
        background: 'Autonomy enrollment test agent.', personalityTraits: ['careful'] },
    '2026-09-08T08:00:00.000Z');
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('durable autonomy enrollment', () => {
    test('survives reopening and preserves the exact policy plus next wakeup', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        addIdentity(store);
        expect(store.createAutonomyEnrollment('ferrye14', {
            status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0',
            nextWakeupAt: '2026-09-08T08:05:00.000Z'
        }, '2026-09-08T08:01:00.000Z')).toMatchObject({
            agentId: 'ferrye14', status: 'desired', policyId: 'private-local-default',
            policyVersion: '1.0.0', nextWakeupAt: '2026-09-08T08:05:00.000Z', revision: 1
        });
        store.close();

        store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('ferrye14')).toMatchObject({
            status: 'desired', leaseOwner: null, leaseExpiresAt: null, failureCount: 0
        });
        expect(store.listAutonomyEnrollments('desired').map(item => item.agentId)).toEqual(['ferrye14']);
        store.close();
    });

    test('uses optimistic revisions for leased, paused and quarantined transitions', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        const desired = store.createAutonomyEnrollment('ferrye14', {
            status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0'
        }, '2026-09-08T08:01:00.000Z');
        const running = store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:primary',
            '2026-09-08T08:03:00.000Z', '2026-09-08T08:02:00.000Z');
        expect(running).toMatchObject({ status: 'running', leaseOwner: 'gateway:primary', revision: 2 });
        expect(() => store.setAutonomyEnrollment('ferrye14', desired.revision, {
            status: 'paused', policyId: desired.policyId, policyVersion: desired.policyVersion
        }, '2026-09-08T08:02:30.000Z')).toThrow('changed before update');

        const fingerprint = 'a'.repeat(64);
        const quarantined = store.setAutonomyEnrollment('ferrye14', running.revision, {
            status: 'quarantined', policyId: running.policyId, policyVersion: running.policyVersion,
            failureCount: 3, lastFailureFingerprint: fingerprint,
            quarantineReason: 'Repeated deterministic skill failure.'
        }, '2026-09-08T08:03:00.000Z');
        expect(quarantined).toMatchObject({ status: 'quarantined', failureCount: 3,
            lastFailureFingerprint: fingerprint, leaseOwner: null, nextWakeupAt: null, revision: 3 });
        store.close();
    });

    test('claims due work atomically, renews ownership and recovers an expired lease', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        const desired = store.createAutonomyEnrollment('ferrye14', {
            status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0',
            nextWakeupAt: '2026-09-08T08:02:00.000Z'
        }, '2026-09-08T08:00:00.000Z');
        expect(() => store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:one',
            '2026-09-08T08:05:00.000Z', '2026-09-08T08:01:00.000Z')).toThrow('not due');
        const running = store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:one',
            '2026-09-08T08:05:00.000Z', '2026-09-08T08:02:00.000Z');
        expect(() => store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:two',
            '2026-09-08T08:06:00.000Z', '2026-09-08T08:02:01.000Z')).toThrow('not claimable');
        const renewed = store.renewAutonomyLease('ferrye14', running.revision, 'gateway:one',
            '2026-09-08T08:07:00.000Z', '2026-09-08T08:03:00.000Z');
        expect(renewed).toMatchObject({ status: 'running', leaseExpiresAt: '2026-09-08T08:07:00.000Z', revision: 3 });
        expect(store.recoverExpiredAutonomyLeases('2026-09-08T08:06:59.000Z')).toEqual([]);
        expect(store.recoverExpiredAutonomyLeases('2026-09-08T08:07:00.000Z')).toEqual([
            expect.objectContaining({ agentId: 'ferrye14', status: 'desired', leaseOwner: null,
                nextWakeupAt: '2026-09-08T08:07:00.000Z', revision: 4 })
        ]);
        store.close();
    });

    test('provides idempotent reviewed pause, resume and quarantine release transitions', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        const desired = store.createAutonomyEnrollment('ferrye14', {
            status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0'
        }, '2026-09-08T08:00:00.000Z');
        const paused = store.pauseAutonomyEnrollment('ferrye14', desired.revision,
            '2026-09-08T08:01:00.000Z');
        expect(paused).toMatchObject({ status: 'paused', revision: 2 });
        expect(store.pauseAutonomyEnrollment('ferrye14', desired.revision)).toEqual(paused);
        const resumed = store.resumeAutonomyEnrollment('ferrye14', paused.revision,
            '2026-09-08T08:02:00.000Z');
        expect(resumed).toMatchObject({ status: 'desired', nextWakeupAt: '2026-09-08T08:02:00.000Z', revision: 3 });
        expect(store.resumeAutonomyEnrollment('ferrye14', paused.revision)).toEqual(resumed);
        const quarantined = store.setAutonomyEnrollment('ferrye14', resumed.revision, {
            ...resumed, status: 'quarantined', nextWakeupAt: null,
            failureCount: 1, lastFailureFingerprint: 'b'.repeat(64), quarantineReason: 'Test failure.'
        }, '2026-09-08T08:03:00.000Z');
        const released = store.releaseAutonomyQuarantine('ferrye14', quarantined.revision,
            '2026-09-08T08:04:00.000Z');
        expect(released).toMatchObject({ status: 'paused', quarantineReason: null, revision: 5 });
        expect(store.releaseAutonomyQuarantine('ferrye14', quarantined.revision)).toEqual(released);
        store.close();
    });

    test('persists an idempotent global emergency stop independently of enrollments', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        expect(store.getAutonomyControl()).toMatchObject({ emergencyStop: false, revision: 1 });
        const stopped = store.setAutonomyEmergencyStop(1, true, 'Operator emergency.',
            '2026-09-08T08:01:00.000Z');
        expect(stopped).toMatchObject({ emergencyStop: true, reason: 'Operator emergency.', revision: 2 });
        expect(store.setAutonomyEmergencyStop(1, true, 'Idempotent replay.')).toEqual(stopped);
        store.close();

        store = new AgentStateStore(path);
        expect(store.getAutonomyControl()).toEqual(stopped);
        const resumed = store.setAutonomyEmergencyStop(stopped.revision, false, 'Reviewed recovery.',
            '2026-09-08T08:02:00.000Z');
        expect(resumed).toMatchObject({ emergencyStop: false, reason: null, activatedAt: null, revision: 3 });
        store.close();
    });

    test('rejects unsafe state combinations and unknown agents', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        expect(() => store.createAutonomyEnrollment('missing', {
            status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0'
        })).toThrow('Unknown agent');
        expect(() => store.createAutonomyEnrollment('ferrye14', {
            status: 'running', policyId: 'private-local-default', policyVersion: '1.0.0'
        })).toThrow('requires a lease');
        expect(() => store.createAutonomyEnrollment('ferrye14', {
            status: 'paused', policyId: 'private-local-default', policyVersion: '1.0.0',
            nextWakeupAt: '2026-09-08T08:05:00.000Z'
        })).toThrow('cannot have a next wakeup');
        expect(() => store.createAutonomyEnrollment('ferrye14', {
            status: 'quarantined', policyId: 'private-local-default', policyVersion: '1.0.0'
        })).toThrow('requires a reason');
        store.close();
    });

    test('links exact parameters to decision, dispatch and an idempotent one-shot goal outcome', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createAutonomyEnrollment('ferrye14', { status: 'desired', policyId: 'local-player',
            policyVersion: '1.2.0' }, '2026-09-08T08:00:00.000Z');
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        store.createGoal('ferrye14', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term', title: 'Mine' });
        store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: 'career', horizon: 'current', title: 'Capital' });
        store.createGoal('ferrye14', { goalId: 'ore', parentGoalId: 'capital', horizon: 'immediate', title: 'Bank ore',
            skill: { id: 'mining.varrock', version: '1.0.0' }, execution: { policy: 'one-shot',
                binding: { sourceKind: 'goal', sourceId: 'ore', parameters: { oreId: 436, trips: 1 } } } },
        '2026-09-08T08:01:00.000Z');
        const profile = store.getControlProfile('ferrye14')!;
        store.recordDecision('ferrye14', profile.revision, { decisionId: 'decision.one', trigger: 'event' },
            '2026-09-08T08:02:00.000Z');
        const execution = store.getGoalExecution('ore')!;
        const runId = '11111111-1111-4111-8111-111111111111';
        const dispatch = store.recordSkillDispatch({ runId, decisionId: 'decision.one', agentId: 'ferrye14',
            goalId: 'ore', skill: { id: 'mining.varrock', version: '1.0.0' }, binding: execution.binding,
            policyId: 'local-player', policyVersion: '1.2.0' }, '2026-09-08T08:03:00.000Z');
        expect(dispatch.binding).toMatchObject({ sourceKind: 'goal', sourceId: 'ore',
            parameters: { oreId: 436, trips: 1 } });
        expect(dispatch.binding.digest).toHaveLength(64);

        const first = store.recordSkillRunOutcome(runId, 'completed', 'completed', 'Ore banked.',
            '2026-09-08T08:04:00.000Z');
        expect(first).toMatchObject({ created: true, goal: { status: 'completed' } });
        expect(store.getGoalExecution('ore')).toMatchObject({ progress: { successfulRuns: 1 }, lastRunId: runId });
        expect(store.recordSkillRunOutcome(runId, 'completed', 'completed', 'Replay.',
            '2026-09-08T08:05:00.000Z')).toMatchObject({ created: false, goal: { status: 'completed' } });
        expect(store.listGoalEvents('ferrye14').filter(event => event.goalId === 'ore'
            && event.kind === 'status-changed')).toHaveLength(1);
        store.close();
    });

    test('keeps recurring work active and enforces its persisted cooldown', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createAutonomyEnrollment('ferrye14', { status: 'desired', policyId: 'local-player',
            policyVersion: '1.0.0' }, '2026-09-08T08:00:00.000Z');
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        store.createGoal('ferrye14', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term', title: 'Mine' });
        store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: 'career', horizon: 'current', title: 'Capital' });
        store.createGoal('ferrye14', { goalId: 'income', parentGoalId: 'capital', horizon: 'immediate', title: 'Earn',
            skill: { id: 'mining.varrock', version: '1.0.0' }, execution: { policy: 'recurring', cooldownMs: 60_000,
                binding: { sourceKind: 'goal', sourceId: 'income', parameters: {} } } });
        const profile = store.getControlProfile('ferrye14')!;
        store.recordDecision('ferrye14', profile.revision, { decisionId: 'decision.loop', trigger: 'event' },
            '2026-09-08T08:01:00.000Z');
        const binding = store.getGoalExecution('income')!.binding;
        const runId = '22222222-2222-4222-8222-222222222222';
        store.recordSkillDispatch({ runId, decisionId: 'decision.loop', agentId: 'ferrye14', goalId: 'income',
            skill: { id: 'mining.varrock', version: '1.0.0' }, binding,
            policyId: 'local-player', policyVersion: '1.0.0' }, '2026-09-08T08:02:00.000Z');
        store.recordSkillRunOutcome(runId, 'completed', 'completed', 'Cycle complete.',
            '2026-09-08T08:03:00.000Z');
        expect(store.getGoal('income')?.status).toBe('active');
        expect(store.getGoalExecution('income')).toMatchObject({ progress: { successfulRuns: 1 },
            nextEligibleAt: '2026-09-08T08:04:00.000Z' });
        store.close();
    });

    test('reserves worst-case dispatch GP atomically against profile and authorization daily limits', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        const profile = store.getControlProfile('ferrye14')!;
        const budgeted = store.setControlProfile('ferrye14', profile.revision, { role: 'player',
            subjectKind: 'player', subjectId: 'ferrye14', avatarPlayerUsername: 'ferrye14',
            decisionIntervalMs: profile.decisionIntervalMs, maxDecisionsPerDay: profile.maxDecisionsPerDay,
            dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 100 });
        store.recordDecision('ferrye14', budgeted.revision, { decisionId: 'buy.one', trigger: 'event' },
            '2026-09-08T08:00:00.000Z');
        expect(store.reserveDecisionOperationalBudget('buy.one', 20, 50)).toMatchObject({
            decisionId: 'buy.one', operationalBudgetGp: 20
        });
        expect(store.reserveDecisionOperationalBudget('buy.one', 20, 50).operationalBudgetGp).toBe(20);
        const latest = store.getControlProfile('ferrye14')!;
        store.recordDecision('ferrye14', latest.revision, { decisionId: 'buy.two', trigger: 'event' },
            '2026-09-08T08:01:00.000Z');
        expect(() => store.reserveDecisionOperationalBudget('buy.two', 40, 50)).toThrow('daily GP limit');
        store.close();
    });

    test('migrates an existing v15 database without enrolling agents implicitly', () => {
        const path = databasePath();
        const legacy = new Database(path, { create: true, strict: true });
        legacy.run(`CREATE TABLE agent_identity (
            agent_id TEXT PRIMARY KEY, player_username TEXT UNIQUE, display_name TEXT NOT NULL,
            background TEXT NOT NULL, personality_traits TEXT NOT NULL, agent_values TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1))`);
        legacy.run(`INSERT INTO agent_identity VALUES
            ('legacy', 'legacy', 'Legacy', 'Existing v15 agent.', '["careful"]', '[]',
            '2026-09-08T08:00:00.000Z', '2026-09-08T08:00:00.000Z', 1)`);
        legacy.run(`CREATE TABLE agent_decision_ledger (
            decision_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
            trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'event', 'admin')),
            llm_cost_micros INTEGER NOT NULL CHECK (llm_cost_micros >= 0),
            operational_budget_gp INTEGER NOT NULL CHECK (operational_budget_gp >= 0),
            occurred_at TEXT NOT NULL, profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1))`);
        legacy.run('PRAGMA user_version = 15');
        legacy.close(true);

        const store = new AgentStateStore(path);
        expect(store.getAutonomyEnrollment('legacy')).toBeNull();
        store.createAutonomyEnrollment('legacy', {
            status: 'paused', policyId: 'private-local-default', policyVersion: '1.0.0'
        }, '2026-09-08T08:01:00.000Z');
        store.close();

        const migrated = new Database(path, { strict: true });
        expect((migrated.query('PRAGMA user_version').get() as { user_version: number }).user_version)
            .toBe(AGENT_STATE_SCHEMA_VERSION);
        const enrollmentCount = migrated.query('SELECT COUNT(*) AS count FROM agent_autonomy_enrollment')
            .get() as { count: number };
        expect(enrollmentCount.count).toBe(1);
        expect((migrated.query(`SELECT emergency_stop, revision FROM agent_autonomy_control
            WHERE control_key = 'global'`).get() as { emergency_stop: number; revision: number }))
            .toEqual({ emergency_stop: 0, revision: 1 });
        const migratedTables = migrated.query(`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('agent_autonomy_enrollment', 'agent_autonomy_control',
                'agent_goal_execution', 'agent_skill_dispatch', 'agent_skill_outcome') ORDER BY name`)
            .all() as Array<{ name: string }>;
        expect(migratedTables.map(row => row.name)).toEqual([
            'agent_autonomy_control', 'agent_autonomy_enrollment', 'agent_goal_execution',
            'agent_skill_dispatch', 'agent_skill_outcome'
        ]);
        expect((migrated.query(`SELECT name FROM pragma_table_info('agent_decision_ledger')
            WHERE name = 'context_digest'`).get() as { name: string })).toEqual({ name: 'context_digest' });
        migrated.close(true);

        const reopened = new AgentStateStore(path);
        expect(reopened.getAutonomyEnrollment('legacy')).toMatchObject({ agentId: 'legacy', status: 'paused',
            policyId: 'private-local-default', policyVersion: '1.0.0', revision: 1 });
        expect(reopened.getAutonomyControl()).toMatchObject({ emergencyStop: false, revision: 1 });
        reopened.close();
    });
});
