import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { AGENT_STATE_SCHEMA_VERSION, type AgentGoal, type AgentIdentity, type AgentSnapshot,
    type AgentWorkingMemory, type CreateAgentGoal, type CreateAgentIdentity, type GoalStatus,
    type SetAgentWorkingMemory, type UpdateAgentIdentity } from './types.js';
import { expectedParentHorizon, normalizeAgentId, validateCreateGoal, validateCreateIdentity,
    validateIdentityPatch, validateWorkingMemory } from './validation.js';

interface IdentityRow {
    agent_id: string; player_username: string; display_name: string; background: string;
    personality_traits: string; agent_values: string; created_at: string; updated_at: string; revision: number;
}
interface GoalRow {
    goal_id: string; agent_id: string; parent_goal_id: string | null; horizon: AgentGoal['horizon'];
    title: string; description: string; status: GoalStatus; priority: number; created_at: string;
    updated_at: string; completed_at: string | null; revision: number;
}
interface WorkingMemoryRow {
    agent_id: string; summary: string; current_activity: string | null; location: string | null;
    observations: string; observed_at: string; updated_at: string; revision: number;
}

function identity(row: IdentityRow): AgentIdentity {
    return { schemaVersion: AGENT_STATE_SCHEMA_VERSION, agentId: row.agent_id, playerUsername: row.player_username,
        displayName: row.display_name, background: row.background,
        personalityTraits: JSON.parse(row.personality_traits) as string[], values: JSON.parse(row.agent_values) as string[],
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function goal(row: GoalRow): AgentGoal {
    return { goalId: row.goal_id, agentId: row.agent_id, parentGoalId: row.parent_goal_id, horizon: row.horizon,
        title: row.title, description: row.description, status: row.status, priority: row.priority,
        createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, revision: row.revision };
}
function workingMemory(row: WorkingMemoryRow): AgentWorkingMemory {
    return { agentId: row.agent_id, summary: row.summary, currentActivity: row.current_activity,
        location: row.location ? JSON.parse(row.location) as AgentWorkingMemory['location'] : null,
        observations: JSON.parse(row.observations) as string[], observedAt: row.observed_at,
        updatedAt: row.updated_at, revision: row.revision };
}

export class AgentStateStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try {
            this.database.run('PRAGMA foreign_keys = ON');
            this.database.run('PRAGMA journal_mode = WAL');
            this.migrate();
        } catch (error) {
            this.database.close(true);
            throw error;
        }
    }

    close(): void { this.database.close(true); }

    createIdentity(input: CreateAgentIdentity, now = new Date().toISOString()): AgentIdentity {
        const value = validateCreateIdentity(input);
        this.database.run(`INSERT INTO agent_identity
            (agent_id, player_username, display_name, background, personality_traits, agent_values, created_at, updated_at, revision)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)`,
        [value.agentId, value.playerUsername, value.displayName, value.background, JSON.stringify(value.personalityTraits),
            JSON.stringify(value.values ?? []), now]);
        return this.requireIdentity(value.agentId);
    }

    updateIdentity(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
        now = new Date().toISOString()): AgentIdentity {
        const current = this.requireIdentity(agentId);
        const value = validateIdentityPatch(patch);
        const next = { ...current, ...value };
        const result = this.database.run(`UPDATE agent_identity SET player_username = ?3, display_name = ?4,
            background = ?5, personality_traits = ?6, agent_values = ?7, updated_at = ?8, revision = revision + 1
            WHERE agent_id = ?1 AND revision = ?2`, [current.agentId, expectedRevision, next.playerUsername,
            next.displayName, next.background, JSON.stringify(next.personalityTraits), JSON.stringify(next.values), now]);
        if (result.changes !== 1) throw new Error('Agent identity changed before update; refresh and try again');
        return this.requireIdentity(current.agentId);
    }

    getIdentity(agentId: string): AgentIdentity | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_identity WHERE agent_id = ?1').get(normalized);
        return row ? identity(row as IdentityRow) : null;
    }

    listIdentities(): AgentIdentity[] {
        return (this.database.query('SELECT * FROM agent_identity ORDER BY agent_id').all() as IdentityRow[]).map(identity);
    }

    createGoal(agentId: string, input: CreateAgentGoal, now = new Date().toISOString()): AgentGoal {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateGoal(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (value.parentGoalId) {
                const parent = this.getGoal(value.parentGoalId);
                if (!parent || parent.agentId !== normalizedAgentId) throw new Error('Goal parent must belong to the same agent');
                if (parent.horizon !== expectedParentHorizon(value.horizon)) {
                    throw new Error(`${value.horizon} goal parent must be a ${expectedParentHorizon(value.horizon)} goal`);
                }
                if (parent.status !== 'active') throw new Error('Goal parent must be active');
            }
            this.database.run(`INSERT INTO agent_goal
                (goal_id, agent_id, parent_goal_id, horizon, title, description, status, priority, created_at, updated_at, completed_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?8, NULL, 1)`,
            [value.goalId, normalizedAgentId, value.parentGoalId, value.horizon, value.title, value.description, value.priority, now]);
        });
        transaction.immediate();
        return this.requireGoal(value.goalId);
    }

    setGoalStatus(goalId: string, expectedRevision: number, status: GoalStatus,
        now = new Date().toISOString()): AgentGoal {
        if (!['active', 'completed', 'blocked', 'abandoned'].includes(status)) throw new Error('Invalid goal status');
        let unchanged: AgentGoal | null = null;
        const normalizedGoalId = normalizeAgentId(goalId, 'goalId');
        const transaction = this.database.transaction(() => {
            const current = this.requireGoal(normalizedGoalId);
            if (current.status === status) { unchanged = current; return; }
            if (current.status !== 'active' && status === 'active') throw new Error('Ended goals cannot be reactivated');
            if (status !== 'active') {
                const activeChildren = this.database.query(`SELECT COUNT(*) AS count FROM agent_goal
                    WHERE parent_goal_id = ?1 AND status = 'active'`).get(current.goalId) as { count: number };
                if (activeChildren.count > 0) throw new Error('End active child goals before ending their parent');
            }
            const result = this.database.run(`UPDATE agent_goal SET status = ?3, updated_at = ?4,
                completed_at = CASE WHEN ?3 = 'completed' THEN ?4 ELSE NULL END, revision = revision + 1
                WHERE goal_id = ?1 AND revision = ?2`, [current.goalId, expectedRevision, status, now]);
            if (result.changes !== 1) throw new Error('Goal changed before update; refresh and try again');
        });
        transaction.immediate();
        return unchanged ?? this.requireGoal(normalizedGoalId);
    }

    getGoal(goalId: string): AgentGoal | null {
        const normalized = normalizeAgentId(goalId, 'goalId');
        const row = this.database.query('SELECT * FROM agent_goal WHERE goal_id = ?1').get(normalized);
        return row ? goal(row as GoalRow) : null;
    }

    listGoals(agentId: string, status?: GoalStatus): AgentGoal[] {
        const normalized = normalizeAgentId(agentId);
        const rows = status
            ? this.database.query(`SELECT * FROM agent_goal WHERE agent_id = ?1 AND status = ?2
                ORDER BY CASE horizon WHEN 'life' THEN 0 WHEN 'long-term' THEN 1 WHEN 'current' THEN 2 ELSE 3 END,
                priority DESC, goal_id`).all(normalized, status)
            : this.database.query(`SELECT * FROM agent_goal WHERE agent_id = ?1
                ORDER BY CASE horizon WHEN 'life' THEN 0 WHEN 'long-term' THEN 1 WHEN 'current' THEN 2 ELSE 3 END,
                priority DESC, goal_id`).all(normalized);
        return (rows as GoalRow[]).map(goal);
    }

    setWorkingMemory(agentId: string, expectedRevision: number | null, input: SetAgentWorkingMemory,
        now = new Date().toISOString()): AgentWorkingMemory {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateWorkingMemory(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const existing = this.getWorkingMemory(normalizedAgentId);
            if (!existing) {
                if (expectedRevision !== null) throw new Error('Working memory changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_working_memory
                    (agent_id, summary, current_activity, location, observations, observed_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`, [normalizedAgentId, value.summary,
                    value.currentActivity, value.location ? JSON.stringify(value.location) : null,
                    JSON.stringify(value.observations), value.observedAt, now]);
                return;
            }
            if (expectedRevision === null || existing.revision !== expectedRevision) {
                throw new Error('Working memory changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_working_memory SET summary = ?3, current_activity = ?4,
                location = ?5, observations = ?6, observed_at = ?7, updated_at = ?8, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalizedAgentId, expectedRevision, value.summary,
                value.currentActivity, value.location ? JSON.stringify(value.location) : null,
                JSON.stringify(value.observations), value.observedAt, now]);
            if (result.changes !== 1) throw new Error('Working memory changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getWorkingMemory(normalizedAgentId)!;
    }

    getWorkingMemory(agentId: string): AgentWorkingMemory | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_working_memory WHERE agent_id = ?1').get(normalized);
        return row ? workingMemory(row as WorkingMemoryRow) : null;
    }

    getSnapshot(agentId: string): AgentSnapshot | null {
        const found = this.getIdentity(agentId);
        return found ? { identity: found, goals: this.listGoals(found.agentId),
            workingMemory: this.getWorkingMemory(found.agentId) } : null;
    }

    private requireIdentity(agentId: string): AgentIdentity {
        const found = this.getIdentity(agentId);
        if (!found) throw new Error(`Unknown agent: ${agentId}`);
        return found;
    }
    private requireGoal(goalId: string): AgentGoal {
        const found = this.getGoal(goalId);
        if (!found) throw new Error(`Unknown goal: ${goalId}`);
        return found;
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > AGENT_STATE_SCHEMA_VERSION) throw new Error(`Agent state schema ${version} is newer than supported version ${AGENT_STATE_SCHEMA_VERSION}`);
        if (version < 1) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_identity (
                    agent_id TEXT PRIMARY KEY, player_username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
                    background TEXT NOT NULL, personality_traits TEXT NOT NULL, agent_values TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1))`);
                this.database.run(`CREATE TABLE agent_goal (
                    goal_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    parent_goal_id TEXT REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    horizon TEXT NOT NULL CHECK (horizon IN ('life', 'long-term', 'current', 'immediate')),
                    title TEXT NOT NULL, description TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'blocked', 'abandoned')),
                    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100), created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, completed_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (goal_id != parent_goal_id))`);
                this.database.run(`CREATE UNIQUE INDEX one_active_life_goal_per_agent
                    ON agent_goal(agent_id) WHERE horizon = 'life' AND status = 'active'`);
                this.database.run('CREATE INDEX agent_goal_agent_status ON agent_goal(agent_id, status)');
                this.database.run('PRAGMA user_version = 1');
            });
            transaction.immediate();
        }
        if (version < 2) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_working_memory (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    summary TEXT NOT NULL, current_activity TEXT, location TEXT, observations TEXT NOT NULL,
                    observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1))`);
                this.database.run('PRAGMA user_version = 2');
            });
            transaction.immediate();
        }
    }
}
