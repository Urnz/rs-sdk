import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { AGENT_STATE_SCHEMA_VERSION, type AgentGoal, type AgentIdentity, type AgentSnapshot,
    type AgentControlProfile, type AgentDecisionRecord, type AgentDecisionTrigger,
    type AgentCommitment, type AgentCommitmentStatus, type AgentEpisode, type AgentEpisodeListOptions,
    type AgentEpisodeProtectionReason, type AgentEpisodePruneResult, type AgentEpisodeRetentionPreview,
    type AgentConsolidationEvidence, type AgentEconomicActorLink, type AgentKnowledge,
    type AgentKnowledgeListOptions, type AgentRelationship,
    type AgentSkillKnowledge, type AgentSkillKnowledgeStatus,
    type AgentSkillReference, type AgentWorkingMemory, type CreateAgentCommitment,
    type CreateAgentConsolidationEvidence, type CreateAgentEpisode,
    type CreateAgentGoal, type CreateAgentIdentity, type CreateAgentKnowledge, type GoalStatus,
    type RecordAgentDecision, type SetAgentControlProfile,
    type SetAgentEconomicActorLink, type SetAgentRelationship, type SetAgentWorkingMemory,
    type UpdateAgentIdentity } from './types.js';
import { expectedParentHorizon, normalizeAgentId, validateCreateGoal, validateCreateIdentity,
    normalizeActorKey, normalizeEconomicActorId, normalizeSkillReference, validateCreateCommitment, validateCreateEpisode,
    validateCreateKnowledge, validateIdentityPatch, validateRelationship, validateSkillKnowledgeStatus,
    validateControlProfile, validateEconomicActorLink, validateWorkingMemory } from './validation.js';

interface IdentityRow {
    agent_id: string; player_username: string; display_name: string; background: string;
    personality_traits: string; agent_values: string; created_at: string; updated_at: string; revision: number;
}
interface GoalRow {
    goal_id: string; agent_id: string; parent_goal_id: string | null; horizon: AgentGoal['horizon'];
    title: string; description: string; status: GoalStatus; priority: number; created_at: string;
    skill_id: string | null; skill_version: string | null; updated_at: string; completed_at: string | null; revision: number;
}
interface WorkingMemoryRow {
    agent_id: string; summary: string; current_activity: string | null; location: string | null;
    observations: string; observed_at: string; updated_at: string; revision: number;
}
interface SkillKnowledgeRow {
    agent_id: string; skill_id: string; skill_version: string; status: AgentSkillKnowledgeStatus;
    learned_at: string; updated_at: string; revision: number;
}
interface EpisodeRow {
    episode_id: string; agent_id: string; kind: AgentEpisode['kind']; summary: string; details: string;
    importance: number; goal_ids: string; actors: string; tags: string; source: AgentEpisode['source'];
    trust: AgentEpisode['trust']; external_key: string | null; occurred_at: string; expires_at: string | null;
    created_at: string;
}
interface KnowledgeRow {
    knowledge_id: string; agent_id: string; kind: AgentKnowledge['kind']; subject: string; predicate: string;
    object: string; summary: string; confidence: number; goal_ids: string; tags: string;
    evidence_episode_ids: string; source: AgentKnowledge['source']; status: AgentKnowledge['status'];
    supersedes_id: string | null; external_key: string | null; valid_from: string; valid_until: string | null;
    created_at: string; updated_at: string; revision: number;
}
interface RelationshipRow {
    agent_id: string; actor_key: string; display_name: string; trust: number; affinity: number; familiarity: number;
    agent_owes_gp: number; actor_owes_gp: number; notes: string; tags: string; evidence_episode_ids: string;
    last_interaction_at: string | null; created_at: string; updated_at: string; revision: number;
}
interface CommitmentRow {
    commitment_id: string; agent_id: string; actor_key: string; direction: AgentCommitment['direction'];
    description: string; status: AgentCommitmentStatus; value_gp: number | null; due_at: string | null;
    evidence_episode_ids: string; created_at: string; updated_at: string; resolved_at: string | null; revision: number;
}
interface EconomicActorLinkRow {
    agent_id: string; actor_kind: AgentEconomicActorLink['actorKind']; actor_id: string;
    role: AgentEconomicActorLink['role']; source: AgentEconomicActorLink['source'];
    created_at: string; updated_at: string; revision: number;
}
interface ControlProfileRow {
    agent_id: string; role: AgentControlProfile['role']; subject_kind: AgentControlProfile['subjectKind'];
    subject_id: string; avatar_player_username: string | null; decision_interval_ms: number;
    max_decisions_per_day: number; daily_llm_budget_micros: number; daily_operational_budget_gp: number;
    last_decision_at: string | null; next_decision_at: string | null; created_at: string; updated_at: string;
    revision: number;
}
interface DecisionRecordRow {
    decision_id: string; agent_id: string; trigger: AgentDecisionTrigger; llm_cost_micros: number;
    operational_budget_gp: number; occurred_at: string; profile_revision: number;
}
interface ConsolidationEvidenceRow {
    agent_id: string; rule_key: string; evidence_key: string; episode_id: string;
    occurred_at: string; created_at: string;
}
interface EpisodeRetentionRow extends EpisodeRow {
    semantic_ref: number; relationship_ref: number; commitment_ref: number; consolidation_ref: number;
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
        skill: row.skill_id && row.skill_version ? { id: row.skill_id, version: row.skill_version } : null,
        createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, revision: row.revision };
}
function skillKnowledge(row: SkillKnowledgeRow): AgentSkillKnowledge {
    return { agentId: row.agent_id, skill: { id: row.skill_id, version: row.skill_version }, status: row.status,
        learnedAt: row.learned_at, updatedAt: row.updated_at, revision: row.revision };
}
function workingMemory(row: WorkingMemoryRow): AgentWorkingMemory {
    return { agentId: row.agent_id, summary: row.summary, currentActivity: row.current_activity,
        location: row.location ? JSON.parse(row.location) as AgentWorkingMemory['location'] : null,
        observations: JSON.parse(row.observations) as string[], observedAt: row.observed_at,
        updatedAt: row.updated_at, revision: row.revision };
}
function episode(row: EpisodeRow): AgentEpisode {
    return { episodeId: row.episode_id, agentId: row.agent_id, kind: row.kind, summary: row.summary,
        details: row.details, importance: row.importance, goalIds: JSON.parse(row.goal_ids) as string[],
        actors: JSON.parse(row.actors) as string[], tags: JSON.parse(row.tags) as string[], source: row.source,
        trust: row.trust, externalKey: row.external_key, occurredAt: row.occurred_at,
        expiresAt: row.expires_at, createdAt: row.created_at };
}
function knowledge(row: KnowledgeRow): AgentKnowledge {
    return { knowledgeId: row.knowledge_id, agentId: row.agent_id, kind: row.kind, subject: row.subject,
        predicate: row.predicate, object: row.object, summary: row.summary, confidence: row.confidence,
        goalIds: JSON.parse(row.goal_ids) as string[], tags: JSON.parse(row.tags) as string[],
        evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[], source: row.source, status: row.status,
        supersedesId: row.supersedes_id, externalKey: row.external_key, validFrom: row.valid_from,
        validUntil: row.valid_until, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function relationship(row: RelationshipRow): AgentRelationship {
    return { agentId: row.agent_id, actorKey: row.actor_key, displayName: row.display_name, trust: row.trust,
        affinity: row.affinity, familiarity: row.familiarity, agentOwesGp: row.agent_owes_gp,
        actorOwesGp: row.actor_owes_gp, notes: row.notes, tags: JSON.parse(row.tags) as string[],
        evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[],
        lastInteractionAt: row.last_interaction_at, createdAt: row.created_at, updatedAt: row.updated_at,
        revision: row.revision };
}
function commitment(row: CommitmentRow): AgentCommitment {
    return { commitmentId: row.commitment_id, agentId: row.agent_id, actorKey: row.actor_key,
        direction: row.direction, description: row.description, status: row.status, valueGp: row.value_gp,
        dueAt: row.due_at, evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[],
        createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at, revision: row.revision };
}
function economicActorLink(row: EconomicActorLinkRow): AgentEconomicActorLink {
    return { agentId: row.agent_id, actorKind: row.actor_kind, actorId: row.actor_id, role: row.role,
        source: row.source, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function controlProfile(row: ControlProfileRow): AgentControlProfile {
    return { agentId: row.agent_id, role: row.role, subjectKind: row.subject_kind, subjectId: row.subject_id,
        avatarPlayerUsername: row.avatar_player_username, decisionIntervalMs: row.decision_interval_ms,
        maxDecisionsPerDay: row.max_decisions_per_day, dailyLlmBudgetMicros: row.daily_llm_budget_micros,
        dailyOperationalBudgetGp: row.daily_operational_budget_gp, lastDecisionAt: row.last_decision_at,
        nextDecisionAt: row.next_decision_at, createdAt: row.created_at, updatedAt: row.updated_at,
        revision: row.revision };
}
function decisionRecord(row: DecisionRecordRow): AgentDecisionRecord {
    return { decisionId: row.decision_id, agentId: row.agent_id, trigger: row.trigger,
        llmCostMicros: row.llm_cost_micros, operationalBudgetGp: row.operational_budget_gp,
        occurredAt: row.occurred_at, profileRevision: row.profile_revision };
}
function consolidationEvidence(row: ConsolidationEvidenceRow): AgentConsolidationEvidence {
    return { agentId: row.agent_id, ruleKey: row.rule_key, evidenceKey: row.evidence_key,
        episodeId: row.episode_id, occurredAt: row.occurred_at, createdAt: row.created_at };
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
        const playerActorId = normalizeEconomicActorId(value.playerUsername, 'playerUsername');
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO agent_identity
                (agent_id, player_username, display_name, background, personality_traits, agent_values, created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)`,
            [value.agentId, value.playerUsername, value.displayName, value.background, JSON.stringify(value.personalityTraits),
                JSON.stringify(value.values ?? []), now]);
            this.database.run(`INSERT INTO agent_economic_actor_link
                (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                VALUES (?1, 'player', ?2, 'self', 'identity', ?3, ?3, 1)`, [value.agentId, playerActorId, now]);
            this.database.run(`INSERT INTO agent_control_profile
                (agent_id, role, subject_kind, subject_id, avatar_player_username, decision_interval_ms,
                max_decisions_per_day, daily_llm_budget_micros, daily_operational_budget_gp,
                last_decision_at, next_decision_at, created_at, updated_at, revision)
                VALUES (?1, 'player', 'player', ?2, ?3, 300000, 96, 0, 0, NULL, NULL, ?4, ?4, 1)`,
            [value.agentId, playerActorId, value.playerUsername, now]);
        });
        transaction.immediate();
        return this.requireIdentity(value.agentId);
    }

    updateIdentity(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
        now = new Date().toISOString()): AgentIdentity {
        const current = this.requireIdentity(agentId);
        const value = validateIdentityPatch(patch);
        const next = { ...current, ...value };
        const transaction = this.database.transaction(() => {
            const result = this.database.run(`UPDATE agent_identity SET player_username = ?3, display_name = ?4,
                background = ?5, personality_traits = ?6, agent_values = ?7, updated_at = ?8, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [current.agentId, expectedRevision, next.playerUsername,
                next.displayName, next.background, JSON.stringify(next.personalityTraits), JSON.stringify(next.values), now]);
            if (result.changes !== 1) throw new Error('Agent identity changed before update; refresh and try again');
            if (next.playerUsername !== current.playerUsername) {
                this.database.run(`UPDATE agent_economic_actor_link SET actor_id = ?2, updated_at = ?3,
                    revision = revision + 1 WHERE agent_id = ?1 AND source = 'identity' AND actor_kind = 'player'`,
                [current.agentId, normalizeEconomicActorId(next.playerUsername, 'playerUsername'), now]);
                this.database.run(`UPDATE agent_control_profile SET subject_id = ?2, avatar_player_username = ?3,
                    updated_at = ?4, revision = revision + 1
                    WHERE agent_id = ?1 AND role = 'player' AND subject_kind = 'player'`,
                [current.agentId, normalizeEconomicActorId(next.playerUsername, 'playerUsername'),
                    next.playerUsername, now]);
            }
        });
        transaction.immediate();
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

    getControlProfile(agentId: string): AgentControlProfile | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_control_profile WHERE agent_id = ?1').get(normalized);
        return row ? controlProfile(row as ControlProfileRow) : null;
    }

    setControlProfile(agentId: string, expectedRevision: number, input: SetAgentControlProfile,
        now = new Date().toISOString()): AgentControlProfile {
        const normalized = normalizeAgentId(agentId);
        const value = validateControlProfile(input);
        if (Number.isNaN(Date.parse(now))) throw new Error('Control profile time must be an ISO timestamp');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalized);
            const current = this.getControlProfile(normalized);
            if (!current || current.revision !== expectedRevision) {
                throw new Error('Agent control profile changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_control_profile SET role = ?3, subject_kind = ?4,
                subject_id = ?5, avatar_player_username = ?6, decision_interval_ms = ?7,
                max_decisions_per_day = ?8, daily_llm_budget_micros = ?9,
                daily_operational_budget_gp = ?10, updated_at = ?11, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalized, expectedRevision, value.role,
                value.subjectKind, value.subjectId, value.avatarPlayerUsername ?? null, value.decisionIntervalMs,
                value.maxDecisionsPerDay, value.dailyLlmBudgetMicros, value.dailyOperationalBudgetGp, now]);
            if (result.changes !== 1) throw new Error('Agent control profile changed before update; refresh and try again');
            this.database.run(`DELETE FROM agent_economic_actor_link WHERE agent_id = ?1 AND source = 'identity'`,
                [normalized]);
            if (value.subjectKind === 'player' || value.subjectKind === 'business' || value.subjectKind === 'faction') {
                this.database.run(`INSERT INTO agent_economic_actor_link
                    (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, 'self', 'identity', ?4, ?4, 1)
                    ON CONFLICT(agent_id, actor_kind, actor_id) DO UPDATE SET
                        role = 'self', source = 'identity', updated_at = excluded.updated_at,
                        revision = agent_economic_actor_link.revision + 1`,
                [normalized, value.subjectKind, value.subjectId, now]);
            }
        });
        transaction.immediate();
        return this.getControlProfile(normalized)!;
    }

    recordDecision(agentId: string, expectedProfileRevision: number, input: RecordAgentDecision,
        now = new Date().toISOString()): { profile: AgentControlProfile; decision: AgentDecisionRecord } {
        const normalized = normalizeAgentId(agentId);
        const decisionId = normalizeAgentId(input.decisionId, 'decisionId');
        if (!['scheduled', 'event', 'admin'].includes(input.trigger)) throw new Error('Decision trigger is invalid');
        const llmCost = input.llmCostMicros ?? 0;
        const operationalBudget = input.operationalBudgetGp ?? 0;
        if (!Number.isSafeInteger(llmCost) || llmCost < 0) throw new Error('Decision LLM cost is invalid');
        if (!Number.isSafeInteger(operationalBudget) || operationalBudget < 0) {
            throw new Error('Decision operational budget is invalid');
        }
        const currentTime = Date.parse(now);
        if (Number.isNaN(currentTime)) throw new Error('Decision time must be an ISO timestamp');
        const day = now.slice(0, 10);
        let record: AgentDecisionRecord | null = null;
        const transaction = this.database.transaction(() => {
            const profile = this.getControlProfile(normalized);
            if (!profile || profile.revision !== expectedProfileRevision) {
                throw new Error('Agent control profile changed before decision admission; refresh and try again');
            }
            if (input.trigger === 'scheduled' && profile.nextDecisionAt
                && currentTime < Date.parse(profile.nextDecisionAt)) throw new Error('Scheduled decision is not due yet');
            const totals = this.database.query(`SELECT COUNT(*) AS count,
                COALESCE(SUM(llm_cost_micros), 0) AS llm_cost,
                COALESCE(SUM(operational_budget_gp), 0) AS operational_budget
                FROM agent_decision_ledger WHERE agent_id = ?1 AND substr(occurred_at, 1, 10) = ?2`)
                .get(normalized, day) as { count: number; llm_cost: number; operational_budget: number };
            if (totals.count >= profile.maxDecisionsPerDay) throw new Error('Agent daily decision limit reached');
            if (totals.llm_cost + llmCost > profile.dailyLlmBudgetMicros) {
                throw new Error('Agent daily LLM budget exceeded');
            }
            if (totals.operational_budget + operationalBudget > profile.dailyOperationalBudgetGp) {
                throw new Error('Agent daily operational budget exceeded');
            }
            this.database.run(`INSERT INTO agent_decision_ledger
                (decision_id, agent_id, trigger, llm_cost_micros, operational_budget_gp, occurred_at, profile_revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            [decisionId, normalized, input.trigger, llmCost, operationalBudget, now, profile.revision]);
            const next = new Date(currentTime + profile.decisionIntervalMs).toISOString();
            const updated = this.database.run(`UPDATE agent_control_profile SET last_decision_at = ?3,
                next_decision_at = ?4, updated_at = ?3, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalized, profile.revision, now, next]);
            if (updated.changes !== 1) throw new Error('Agent control profile changed during decision admission');
            record = { decisionId, agentId: normalized, trigger: input.trigger, llmCostMicros: llmCost,
                operationalBudgetGp: operationalBudget, occurredAt: now, profileRevision: profile.revision };
        });
        transaction.immediate();
        return { profile: this.getControlProfile(normalized)!, decision: record! };
    }

    listDecisions(agentId: string, day?: string): AgentDecisionRecord[] {
        const normalized = normalizeAgentId(agentId);
        if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Decision day is invalid');
        const rows = day
            ? this.database.query(`SELECT * FROM agent_decision_ledger WHERE agent_id = ?1
                AND substr(occurred_at, 1, 10) = ?2 ORDER BY occurred_at, decision_id`).all(normalized, day)
            : this.database.query(`SELECT * FROM agent_decision_ledger WHERE agent_id = ?1
                ORDER BY occurred_at DESC, decision_id`).all(normalized);
        return (rows as DecisionRecordRow[]).map(decisionRecord);
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
                (goal_id, agent_id, parent_goal_id, horizon, title, description, status, priority, skill_id, skill_version,
                created_at, updated_at, completed_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?10, NULL, 1)`,
            [value.goalId, normalizedAgentId, value.parentGoalId, value.horizon, value.title, value.description,
                value.priority, value.skill?.id ?? null, value.skill?.version ?? null, now]);
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

    setGoalSkill(agentId: string, goalId: string, expectedRevision: number,
        skill: AgentSkillReference, now = new Date().toISOString()): AgentGoal {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedGoalId = normalizeAgentId(goalId, 'goalId');
        const normalizedSkill = normalizeSkillReference(skill);
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Goal revision is invalid');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const current = this.getGoal(normalizedGoalId);
            if (!current || current.agentId !== normalizedAgentId) throw new Error('Goal must belong to the same agent');
            if (current.horizon !== 'immediate' || current.status !== 'active') {
                throw new Error('Only an active immediate goal may receive an executable skill');
            }
            const result = this.database.run(`UPDATE agent_goal SET skill_id = ?4, skill_version = ?5,
                updated_at = ?6, revision = revision + 1 WHERE goal_id = ?1 AND agent_id = ?2 AND revision = ?3`,
            [normalizedGoalId, normalizedAgentId, expectedRevision, normalizedSkill.id, normalizedSkill.version, now]);
            if (result.changes !== 1) throw new Error('Agent goal changed before skill assignment; refresh and try again');
        });
        transaction.immediate();
        return this.getGoal(normalizedGoalId)!;
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

    setSkillKnowledge(agentId: string, skill: AgentSkillReference, status: AgentSkillKnowledgeStatus,
        expectedRevision: number | null, now = new Date().toISOString()): AgentSkillKnowledge {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedSkill = normalizeSkillReference(skill);
        const normalizedStatus = validateSkillKnowledgeStatus(status);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const existing = this.getSkillKnowledge(normalizedAgentId, normalizedSkill);
            if (!existing) {
                if (expectedRevision !== null) throw new Error('Agent skill knowledge changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_skill_knowledge
                    (agent_id, skill_id, skill_version, status, learned_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)`,
                [normalizedAgentId, normalizedSkill.id, normalizedSkill.version, normalizedStatus, now]);
                return;
            }
            if (expectedRevision === null || existing.revision !== expectedRevision) {
                throw new Error('Agent skill knowledge changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_skill_knowledge SET status = ?5, updated_at = ?6,
                revision = revision + 1 WHERE agent_id = ?1 AND skill_id = ?2 AND skill_version = ?3 AND revision = ?4`,
            [normalizedAgentId, normalizedSkill.id, normalizedSkill.version, expectedRevision, normalizedStatus, now]);
            if (result.changes !== 1) throw new Error('Agent skill knowledge changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getSkillKnowledge(normalizedAgentId, normalizedSkill)!;
    }

    getSkillKnowledge(agentId: string, skill: AgentSkillReference): AgentSkillKnowledge | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedSkill = normalizeSkillReference(skill);
        const row = this.database.query(`SELECT * FROM agent_skill_knowledge
            WHERE agent_id = ?1 AND skill_id = ?2 AND skill_version = ?3`)
            .get(normalizedAgentId, normalizedSkill.id, normalizedSkill.version);
        return row ? skillKnowledge(row as SkillKnowledgeRow) : null;
    }

    listSkillKnowledge(agentId: string): AgentSkillKnowledge[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_skill_knowledge WHERE agent_id = ?1
            ORDER BY skill_id, skill_version`).all(normalized) as SkillKnowledgeRow[]).map(skillKnowledge);
    }

    createEpisode(agentId: string, input: CreateAgentEpisode,
        createdAt = new Date().toISOString()): AgentEpisode {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateEpisode(input);
        let existing: AgentEpisode | null = null;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            for (const goalId of value.goalIds) {
                const goal = this.getGoal(goalId);
                if (!goal || goal.agentId !== normalizedAgentId) {
                    throw new Error(`Episode goal must belong to the same agent: ${goalId}`);
                }
            }
            if (value.externalKey) {
                const row = this.database.query(`SELECT * FROM agent_episode
                    WHERE agent_id = ?1 AND external_key = ?2`).get(normalizedAgentId, value.externalKey) as EpisodeRow | null;
                if (row) {
                    existing = episode(row);
                    if (existing.kind !== value.kind || existing.summary !== value.summary
                        || existing.details !== value.details || existing.importance !== value.importance
                        || JSON.stringify(existing.goalIds) !== JSON.stringify(value.goalIds)
                        || JSON.stringify(existing.actors) !== JSON.stringify(value.actors)
                        || JSON.stringify(existing.tags) !== JSON.stringify(value.tags)
                        || existing.source !== value.source || existing.trust !== value.trust
                        || existing.occurredAt !== value.occurredAt || existing.expiresAt !== value.expiresAt) {
                        throw new Error(`Episode external key collision: ${value.externalKey}`);
                    }
                    return;
                }
            }
            this.database.run(`INSERT INTO agent_episode
                (episode_id, agent_id, kind, summary, details, importance, goal_ids, actors, tags, source, trust,
                external_key, occurred_at, expires_at, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
            [value.episodeId, normalizedAgentId, value.kind, value.summary, value.details, value.importance,
                JSON.stringify(value.goalIds), JSON.stringify(value.actors), JSON.stringify(value.tags), value.source,
                value.trust, value.externalKey, value.occurredAt, value.expiresAt, createdAt]);
        });
        transaction.immediate();
        return existing ?? this.requireEpisode(value.episodeId);
    }

    getEpisode(episodeId: string): AgentEpisode | null {
        const normalized = normalizeAgentId(episodeId, 'episodeId');
        const row = this.database.query('SELECT * FROM agent_episode WHERE episode_id = ?1').get(normalized);
        return row ? episode(row as EpisodeRow) : null;
    }

    getEpisodeByExternalKey(agentId: string, externalKey: string): AgentEpisode | null {
        const normalized = normalizeAgentId(agentId);
        if (!externalKey || externalKey.length > 160) throw new Error('Episode external key must contain at most 160 characters');
        const row = this.database.query(`SELECT * FROM agent_episode
            WHERE agent_id = ?1 AND external_key = ?2`).get(normalized, externalKey);
        return row ? episode(row as EpisodeRow) : null;
    }

    listEpisodes(agentId: string, options: AgentEpisodeListOptions = {}): AgentEpisode[] {
        const normalized = normalizeAgentId(agentId);
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Episode limit must be from 1 to 500');
        if (!Number.isInteger(offset) || offset < 0) throw new Error('Episode offset must be a non-negative integer');
        const rows = options.kind
            ? this.database.query(`SELECT * FROM agent_episode WHERE agent_id = ?1 AND kind = ?2
                ORDER BY occurred_at DESC, episode_id LIMIT ?3 OFFSET ?4`).all(normalized, options.kind, limit, offset)
            : this.database.query(`SELECT * FROM agent_episode WHERE agent_id = ?1
                ORDER BY occurred_at DESC, episode_id LIMIT ?2 OFFSET ?3`).all(normalized, limit, offset);
        return (rows as EpisodeRow[]).map(episode);
    }

    countEpisodes(agentId: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query('SELECT COUNT(*) AS count FROM agent_episode WHERE agent_id = ?1')
            .get(normalized) as { count: number }).count;
    }

    previewEpisodeRetention(agentId: string, asOf = new Date().toISOString(), limit = 500): AgentEpisodeRetentionPreview {
        const normalized = normalizeAgentId(agentId);
        if (Number.isNaN(Date.parse(asOf))) throw new Error('Retention cutoff must be an ISO timestamp');
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Retention preview limit must be from 1 to 500');
        this.requireIdentity(normalized);
        const expiredCount = (this.database.query(`SELECT COUNT(*) AS count FROM agent_episode
            WHERE agent_id = ?1 AND expires_at IS NOT NULL AND expires_at <= ?2`)
            .get(normalized, asOf) as { count: number }).count;
        const rows = this.database.query(`SELECT e.*,
            EXISTS (SELECT 1 FROM agent_semantic_memory k, json_each(k.evidence_episode_ids) j
                WHERE k.agent_id = e.agent_id AND j.value = e.episode_id) AS semantic_ref,
            EXISTS (SELECT 1 FROM agent_relationship r, json_each(r.evidence_episode_ids) j
                WHERE r.agent_id = e.agent_id AND j.value = e.episode_id) AS relationship_ref,
            EXISTS (SELECT 1 FROM agent_commitment c, json_each(c.evidence_episode_ids) j
                WHERE c.agent_id = e.agent_id AND j.value = e.episode_id) AS commitment_ref,
            EXISTS (SELECT 1 FROM agent_consolidation_evidence ce
                WHERE ce.agent_id = e.agent_id AND ce.episode_id = e.episode_id) AS consolidation_ref
            FROM agent_episode e WHERE e.agent_id = ?1 AND e.expires_at IS NOT NULL AND e.expires_at <= ?2
            ORDER BY e.expires_at, e.episode_id LIMIT ?3`)
            .all(normalized, asOf, limit) as EpisodeRetentionRow[];
        const candidates = rows.map(row => {
            const reasons: AgentEpisodeProtectionReason[] = [];
            if (row.semantic_ref) reasons.push('semantic-evidence');
            if (row.relationship_ref) reasons.push('relationship-evidence');
            if (row.commitment_ref) reasons.push('commitment-evidence');
            if (row.consolidation_ref) reasons.push('consolidation-evidence');
            if (row.external_key) reasons.push('external-source');
            return { episodeId: row.episode_id, occurredAt: row.occurred_at, expiresAt: row.expires_at!,
                protectionReasons: reasons, eligible: reasons.length === 0 };
        });
        const eligibleCount = candidates.filter(candidate => candidate.eligible).length;
        return { agentId: normalized, asOf, expiredCount, eligibleCount,
            protectedCount: candidates.length - eligibleCount, truncated: expiredCount > candidates.length, candidates };
    }

    pruneExpiredEpisodes(agentId: string, asOf = new Date().toISOString(), limit = 500): AgentEpisodePruneResult {
        let preview!: AgentEpisodeRetentionPreview;
        const deletedEpisodeIds: string[] = [];
        const transaction = this.database.transaction(() => {
            preview = this.previewEpisodeRetention(agentId, asOf, limit);
            for (const candidate of preview.candidates) {
                if (!candidate.eligible) continue;
                const result = this.database.run(`DELETE FROM agent_episode
                    WHERE agent_id = ?1 AND episode_id = ?2 AND expires_at IS NOT NULL AND expires_at <= ?3`,
                [preview.agentId, candidate.episodeId, asOf]);
                if (result.changes === 1) deletedEpisodeIds.push(candidate.episodeId);
            }
        });
        transaction.immediate();
        return { ...preview, deletedEpisodeIds };
    }

    recordConsolidationEvidence(agentId: string, input: CreateAgentConsolidationEvidence,
        createdAt = new Date().toISOString()): { evidence: AgentConsolidationEvidence; created: boolean } {
        const normalizedAgentId = normalizeAgentId(agentId);
        if (!input.ruleKey || input.ruleKey.length > 100 || !/^[a-z0-9.-]+$/.test(input.ruleKey)) {
            throw new Error('Consolidation rule key must be a stable identifier of at most 100 characters');
        }
        if (!input.evidenceKey || input.evidenceKey.length > 160) {
            throw new Error('Consolidation evidence key must contain at most 160 characters');
        }
        if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('Consolidation evidence time must be an ISO timestamp');
        let created = false;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const source = this.getEpisode(input.episodeId);
            if (!source || source.agentId !== normalizedAgentId) {
                throw new Error('Consolidation evidence episode must belong to the same agent');
            }
            const row = this.database.query(`SELECT * FROM agent_consolidation_evidence
                WHERE agent_id = ?1 AND rule_key = ?2 AND evidence_key = ?3`)
                .get(normalizedAgentId, input.ruleKey, input.evidenceKey) as ConsolidationEvidenceRow | null;
            if (row) {
                if (row.episode_id !== input.episodeId || row.occurred_at !== input.occurredAt) {
                    throw new Error(`Consolidation evidence key collision: ${input.evidenceKey}`);
                }
                return;
            }
            this.database.run(`INSERT INTO agent_consolidation_evidence
                (agent_id, rule_key, evidence_key, episode_id, occurred_at, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
            [normalizedAgentId, input.ruleKey, input.evidenceKey, input.episodeId, input.occurredAt, createdAt]);
            created = true;
        });
        transaction.immediate();
        const evidence = this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 AND evidence_key = ?3`)
            .get(normalizedAgentId, input.ruleKey, input.evidenceKey) as ConsolidationEvidenceRow;
        return { evidence: consolidationEvidence(evidence), created };
    }

    listConsolidationEvidence(agentId: string, ruleKey: string, limit = 20): AgentConsolidationEvidence[] {
        const normalized = normalizeAgentId(agentId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Consolidation evidence limit must be from 1 to 20');
        return (this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 ORDER BY occurred_at, evidence_key LIMIT ?3`)
            .all(normalized, ruleKey, limit) as ConsolidationEvidenceRow[]).map(consolidationEvidence);
    }

    listRecentConsolidationEvidence(agentId: string, ruleKey: string, limit = 20): AgentConsolidationEvidence[] {
        const normalized = normalizeAgentId(agentId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Consolidation evidence limit must be from 1 to 20');
        return (this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 ORDER BY occurred_at DESC, evidence_key DESC LIMIT ?3`)
            .all(normalized, ruleKey, limit) as ConsolidationEvidenceRow[]).map(consolidationEvidence).reverse();
    }

    countConsolidationEvidence(agentId: string, ruleKey: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT COUNT(*) AS count FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2`).get(normalized, ruleKey) as { count: number }).count;
    }

    hasConsolidationEvidence(agentId: string, ruleKey: string, episodeId: string): boolean {
        const normalized = normalizeAgentId(agentId);
        return !!this.database.query(`SELECT 1 FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 AND episode_id = ?3 LIMIT 1`).get(normalized, ruleKey, episodeId);
    }

    createKnowledge(agentId: string, input: CreateAgentKnowledge,
        now = new Date().toISOString()): AgentKnowledge {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateKnowledge(input);
        let existing: AgentKnowledge | null = null;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (value.externalKey) {
                const row = this.database.query(`SELECT * FROM agent_semantic_memory
                    WHERE agent_id = ?1 AND external_key = ?2`).get(normalizedAgentId, value.externalKey) as KnowledgeRow | null;
                if (row) {
                    existing = knowledge(row);
                    if (existing.kind !== value.kind || existing.subject !== value.subject
                        || existing.predicate !== value.predicate || existing.object !== value.object
                        || existing.summary !== value.summary || existing.confidence !== value.confidence
                        || JSON.stringify(existing.goalIds) !== JSON.stringify(value.goalIds)
                        || JSON.stringify(existing.tags) !== JSON.stringify(value.tags)
                        || JSON.stringify(existing.evidenceEpisodeIds) !== JSON.stringify(value.evidenceEpisodeIds)
                        || existing.source !== value.source || existing.supersedesId !== value.supersedesId
                        || existing.validFrom !== value.validFrom || existing.validUntil !== value.validUntil) {
                        throw new Error(`Knowledge external key collision: ${value.externalKey}`);
                    }
                    return;
                }
            }
            for (const goalId of value.goalIds) {
                const goal = this.getGoal(goalId);
                if (!goal || goal.agentId !== normalizedAgentId) {
                    throw new Error(`Knowledge goal must belong to the same agent: ${goalId}`);
                }
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Knowledge evidence must belong to the same agent: ${episodeId}`);
                }
            }
            if (value.supersedesId) {
                const previous = this.getKnowledge(value.supersedesId);
                if (!previous || previous.agentId !== normalizedAgentId) {
                    throw new Error('Superseded knowledge must belong to the same agent');
                }
                if (previous.status !== 'active') throw new Error('Only active knowledge can be superseded');
                if (previous.subject.toLocaleLowerCase('en-US') !== value.subject.toLocaleLowerCase('en-US')
                    || previous.predicate.toLocaleLowerCase('en-US') !== value.predicate.toLocaleLowerCase('en-US')) {
                    throw new Error('Superseding knowledge must keep the same subject and predicate');
                }
                const updated = this.database.run(`UPDATE agent_semantic_memory SET status = 'superseded',
                    updated_at = ?2, revision = revision + 1 WHERE knowledge_id = ?1 AND status = 'active'`,
                [previous.knowledgeId, now]);
                if (updated.changes !== 1) throw new Error('Knowledge changed before supersession; refresh and try again');
            }
            this.database.run(`INSERT INTO agent_semantic_memory
                (knowledge_id, agent_id, kind, subject, predicate, object, summary, confidence, goal_ids, tags,
                evidence_episode_ids, source, status, supersedes_id, external_key, valid_from, valid_until,
                created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?15, ?16, ?17, ?17, 1)`,
            [value.knowledgeId, normalizedAgentId, value.kind, value.subject, value.predicate, value.object,
                value.summary, value.confidence, JSON.stringify(value.goalIds), JSON.stringify(value.tags),
                JSON.stringify(value.evidenceEpisodeIds), value.source, value.supersedesId, value.externalKey,
                value.validFrom, value.validUntil, now]);
        });
        transaction.immediate();
        return existing ?? this.requireKnowledge(value.knowledgeId);
    }

    getKnowledge(knowledgeId: string): AgentKnowledge | null {
        const normalized = normalizeAgentId(knowledgeId, 'knowledgeId');
        const row = this.database.query('SELECT * FROM agent_semantic_memory WHERE knowledge_id = ?1').get(normalized);
        return row ? knowledge(row as KnowledgeRow) : null;
    }

    listKnowledge(agentId: string, options: AgentKnowledgeListOptions = {}): AgentKnowledge[] {
        const normalized = normalizeAgentId(agentId);
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Knowledge limit must be from 1 to 500');
        if (!Number.isInteger(offset) || offset < 0) throw new Error('Knowledge offset must be a non-negative integer');
        let rows: unknown[];
        if (options.status && options.kind) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND status = ?2 AND kind = ?3
            ORDER BY updated_at DESC, knowledge_id LIMIT ?4 OFFSET ?5`)
            .all(normalized, options.status, options.kind, limit, offset);
        else if (options.status) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND status = ?2 ORDER BY updated_at DESC, knowledge_id LIMIT ?3 OFFSET ?4`)
            .all(normalized, options.status, limit, offset);
        else if (options.kind) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND kind = ?2 ORDER BY updated_at DESC, knowledge_id LIMIT ?3 OFFSET ?4`)
            .all(normalized, options.kind, limit, offset);
        else rows = this.database.query(`SELECT * FROM agent_semantic_memory WHERE agent_id = ?1
            ORDER BY updated_at DESC, knowledge_id LIMIT ?2 OFFSET ?3`).all(normalized, limit, offset);
        return (rows as KnowledgeRow[]).map(knowledge);
    }

    countKnowledge(agentId: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query('SELECT COUNT(*) AS count FROM agent_semantic_memory WHERE agent_id = ?1')
            .get(normalized) as { count: number }).count;
    }

    setRelationship(agentId: string, expectedRevision: number | null, input: SetAgentRelationship,
        now = new Date().toISOString()): AgentRelationship {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateRelationship(input);
        const transaction = this.database.transaction(() => {
            const identity = this.requireIdentity(normalizedAgentId);
            if (value.actorKey === identity.agentId || value.actorKey === identity.playerUsername) {
                throw new Error('An agent cannot have a social relationship with itself');
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Relationship evidence must belong to the same agent: ${episodeId}`);
                }
            }
            const current = this.getRelationship(normalizedAgentId, value.actorKey);
            if (!current) {
                if (expectedRevision !== null) throw new Error('Relationship changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_relationship
                    (agent_id, actor_key, display_name, trust, affinity, familiarity, agent_owes_gp, actor_owes_gp,
                    notes, tags, evidence_episode_ids, last_interaction_at, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, 1)`,
                [normalizedAgentId, value.actorKey, value.displayName, value.trust, value.affinity, value.familiarity,
                    value.agentOwesGp, value.actorOwesGp, value.notes, JSON.stringify(value.tags),
                    JSON.stringify(value.evidenceEpisodeIds), value.lastInteractionAt, now]);
                return;
            }
            if (expectedRevision === null || current.revision !== expectedRevision) {
                throw new Error('Relationship changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_relationship SET display_name = ?4, trust = ?5,
                affinity = ?6, familiarity = ?7, agent_owes_gp = ?8, actor_owes_gp = ?9, notes = ?10,
                tags = ?11, evidence_episode_ids = ?12, last_interaction_at = ?13, updated_at = ?14,
                revision = revision + 1 WHERE agent_id = ?1 AND actor_key = ?2 AND revision = ?3`,
            [normalizedAgentId, value.actorKey, expectedRevision, value.displayName, value.trust, value.affinity,
                value.familiarity, value.agentOwesGp, value.actorOwesGp, value.notes, JSON.stringify(value.tags),
                JSON.stringify(value.evidenceEpisodeIds), value.lastInteractionAt, now]);
            if (result.changes !== 1) throw new Error('Relationship changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getRelationship(normalizedAgentId, value.actorKey)!;
    }

    getRelationship(agentId: string, actorKey: string): AgentRelationship | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedActor = normalizeActorKey(actorKey);
        const row = this.database.query(`SELECT * FROM agent_relationship
            WHERE agent_id = ?1 AND actor_key = ?2`).get(normalizedAgentId, normalizedActor);
        return row ? relationship(row as RelationshipRow) : null;
    }

    listRelationships(agentId: string): AgentRelationship[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_relationship WHERE agent_id = ?1
            ORDER BY familiarity DESC, updated_at DESC, actor_key`).all(normalized) as RelationshipRow[]).map(relationship);
    }

    createCommitment(agentId: string, input: CreateAgentCommitment,
        now = new Date().toISOString()): AgentCommitment {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateCommitment(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (!this.getRelationship(normalizedAgentId, value.actorKey)) {
                throw new Error('Commitment requires an existing relationship');
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Commitment evidence must belong to the same agent: ${episodeId}`);
                }
            }
            this.database.run(`INSERT INTO agent_commitment
                (commitment_id, agent_id, actor_key, direction, description, status, value_gp, due_at,
                evidence_episode_ids, created_at, updated_at, resolved_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, ?9, ?9, NULL, 1)`,
            [value.commitmentId, normalizedAgentId, value.actorKey, value.direction, value.description,
                value.valueGp, value.dueAt, JSON.stringify(value.evidenceEpisodeIds), now]);
        });
        transaction.immediate();
        return this.requireCommitment(value.commitmentId);
    }

    setCommitmentStatus(commitmentId: string, expectedRevision: number, status: AgentCommitmentStatus,
        now = new Date().toISOString()): AgentCommitment {
        if (!['open', 'fulfilled', 'broken', 'cancelled'].includes(status)) throw new Error('Invalid commitment status');
        const current = this.requireCommitment(commitmentId);
        if (current.status === status) return current;
        if (current.status !== 'open') throw new Error('Resolved commitments cannot change status');
        const result = this.database.run(`UPDATE agent_commitment SET status = ?3, updated_at = ?4,
            resolved_at = CASE WHEN ?3 = 'open' THEN NULL ELSE ?4 END, revision = revision + 1
            WHERE commitment_id = ?1 AND revision = ?2`, [current.commitmentId, expectedRevision, status, now]);
        if (result.changes !== 1) throw new Error('Commitment changed before update; refresh and try again');
        return this.requireCommitment(current.commitmentId);
    }

    getCommitment(commitmentId: string): AgentCommitment | null {
        const normalized = normalizeAgentId(commitmentId, 'commitmentId');
        const row = this.database.query('SELECT * FROM agent_commitment WHERE commitment_id = ?1').get(normalized);
        return row ? commitment(row as CommitmentRow) : null;
    }

    listCommitments(agentId: string, actorKey?: string, status?: AgentCommitmentStatus): AgentCommitment[] {
        const normalized = normalizeAgentId(agentId);
        let rows: unknown[];
        if (actorKey && status) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND actor_key = ?2 AND status = ?3 ORDER BY created_at DESC, commitment_id`)
            .all(normalized, normalizeActorKey(actorKey), status);
        else if (actorKey) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND actor_key = ?2 ORDER BY created_at DESC, commitment_id`)
            .all(normalized, normalizeActorKey(actorKey));
        else if (status) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND status = ?2 ORDER BY created_at DESC, commitment_id`).all(normalized, status);
        else rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 ORDER BY created_at DESC, commitment_id`).all(normalized);
        return (rows as CommitmentRow[]).map(commitment);
    }

    setEconomicActorLink(agentId: string, expectedRevision: number | null, input: SetAgentEconomicActorLink,
        now = new Date().toISOString()): AgentEconomicActorLink {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateEconomicActorLink(input.actorKind, input.actorId, input.role);
        if (value.role === 'self') throw new Error('Only the identity may own the self economic actor link');
        const source = input.source ?? 'admin';
        if (source !== 'admin' && source !== 'system') throw new Error('Economic actor link source must be admin or system');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const current = this.getEconomicActorLink(normalizedAgentId, value.actorKind, value.actorId);
            if (!current) {
                if (expectedRevision !== null) throw new Error('Economic actor link changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_economic_actor_link
                    (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1)`,
                [normalizedAgentId, value.actorKind, value.actorId, value.role, source, now]);
                return;
            }
            if (current.source === 'identity') throw new Error('The identity economic actor link cannot be edited directly');
            if (expectedRevision === null || current.revision !== expectedRevision) {
                throw new Error('Economic actor link changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_economic_actor_link SET role = ?5, source = ?6,
                updated_at = ?7, revision = revision + 1
                WHERE agent_id = ?1 AND actor_kind = ?2 AND actor_id = ?3 AND revision = ?4`,
            [normalizedAgentId, value.actorKind, value.actorId, expectedRevision, value.role, source, now]);
            if (result.changes !== 1) throw new Error('Economic actor link changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getEconomicActorLink(normalizedAgentId, value.actorKind, value.actorId)!;
    }

    getEconomicActorLink(agentId: string, actorKind: AgentEconomicActorLink['actorKind'], actorId: string): AgentEconomicActorLink | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateEconomicActorLink(actorKind, actorId, 'member');
        const row = this.database.query(`SELECT * FROM agent_economic_actor_link
            WHERE agent_id = ?1 AND actor_kind = ?2 AND actor_id = ?3`)
            .get(normalizedAgentId, value.actorKind, value.actorId);
        return row ? economicActorLink(row as EconomicActorLinkRow) : null;
    }

    listEconomicActorLinks(agentId: string): AgentEconomicActorLink[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_economic_actor_link WHERE agent_id = ?1
            ORDER BY CASE role WHEN 'self' THEN 0 WHEN 'owner' THEN 1 WHEN 'manager' THEN 2
                WHEN 'member' THEN 3 ELSE 4 END, actor_kind, actor_id`).all(normalized) as EconomicActorLinkRow[])
            .map(economicActorLink);
    }

    getSnapshot(agentId: string): AgentSnapshot | null {
        const found = this.getIdentity(agentId);
        return found ? { identity: found, goals: this.listGoals(found.agentId),
            workingMemory: this.getWorkingMemory(found.agentId), knownSkills: this.listSkillKnowledge(found.agentId) } : null;
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
    private requireEpisode(episodeId: string): AgentEpisode {
        const found = this.getEpisode(episodeId);
        if (!found) throw new Error(`Unknown episode: ${episodeId}`);
        return found;
    }
    private requireKnowledge(knowledgeId: string): AgentKnowledge {
        const found = this.getKnowledge(knowledgeId);
        if (!found) throw new Error(`Unknown knowledge: ${knowledgeId}`);
        return found;
    }
    private requireCommitment(commitmentId: string): AgentCommitment {
        const found = this.getCommitment(commitmentId);
        if (!found) throw new Error(`Unknown commitment: ${commitmentId}`);
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
        if (version < 3) {
            const transaction = this.database.transaction(() => {
                this.database.run('ALTER TABLE agent_goal ADD COLUMN skill_id TEXT');
                this.database.run('ALTER TABLE agent_goal ADD COLUMN skill_version TEXT');
                this.database.run(`CREATE TABLE agent_skill_knowledge (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('known', 'preferred', 'blocked')),
                    learned_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    PRIMARY KEY (agent_id, skill_id, skill_version))`);
                this.database.run('PRAGMA user_version = 3');
            });
            transaction.immediate();
        }
        if (version < 4) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_episode (
                    episode_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK (kind IN ('observation', 'action', 'outcome', 'interaction', 'discovery', 'economic')),
                    summary TEXT NOT NULL, details TEXT NOT NULL,
                    importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
                    goal_ids TEXT NOT NULL, actors TEXT NOT NULL, tags TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('manual', 'system', 'skill', 'planner')),
                    trust TEXT NOT NULL CHECK (trust IN ('trusted', 'untrusted')),
                    external_key TEXT, occurred_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL)`);
                this.database.run(`CREATE UNIQUE INDEX agent_episode_external_key
                    ON agent_episode(agent_id, external_key) WHERE external_key IS NOT NULL`);
                this.database.run(`CREATE INDEX agent_episode_agent_time
                    ON agent_episode(agent_id, occurred_at DESC)`);
                this.database.run(`CREATE INDEX agent_episode_agent_importance
                    ON agent_episode(agent_id, importance DESC)`);
                this.database.run('PRAGMA user_version = 4');
            });
            transaction.immediate();
        }
        if (version < 5) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_semantic_memory (
                    knowledge_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK (kind IN ('world', 'economic', 'route', 'procedure')),
                    subject TEXT NOT NULL COLLATE NOCASE, predicate TEXT NOT NULL COLLATE NOCASE,
                    object TEXT NOT NULL, summary TEXT NOT NULL,
                    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
                    goal_ids TEXT NOT NULL, tags TEXT NOT NULL, evidence_episode_ids TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('manual', 'system', 'consolidation')),
                    status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed')),
                    supersedes_id TEXT REFERENCES agent_semantic_memory(knowledge_id) ON DELETE RESTRICT,
                    external_key TEXT, valid_from TEXT NOT NULL, valid_until TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (knowledge_id != supersedes_id))`);
                this.database.run(`CREATE UNIQUE INDEX agent_semantic_external_key
                    ON agent_semantic_memory(agent_id, external_key) WHERE external_key IS NOT NULL`);
                this.database.run(`CREATE UNIQUE INDEX one_active_semantic_fact
                    ON agent_semantic_memory(agent_id, subject, predicate) WHERE status = 'active'`);
                this.database.run(`CREATE INDEX agent_semantic_agent_status
                    ON agent_semantic_memory(agent_id, status, updated_at DESC)`);
                this.database.run('PRAGMA user_version = 5');
            });
            transaction.immediate();
        }
        if (version < 6) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_relationship (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    actor_key TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL,
                    trust INTEGER NOT NULL CHECK (trust BETWEEN -100 AND 100),
                    affinity INTEGER NOT NULL CHECK (affinity BETWEEN -100 AND 100),
                    familiarity INTEGER NOT NULL CHECK (familiarity BETWEEN 0 AND 100),
                    agent_owes_gp INTEGER NOT NULL CHECK (agent_owes_gp >= 0),
                    actor_owes_gp INTEGER NOT NULL CHECK (actor_owes_gp >= 0),
                    notes TEXT NOT NULL, tags TEXT NOT NULL, evidence_episode_ids TEXT NOT NULL,
                    last_interaction_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1), PRIMARY KEY (agent_id, actor_key))`);
                this.database.run(`CREATE TABLE agent_commitment (
                    commitment_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL, actor_key TEXT NOT NULL COLLATE NOCASE,
                    direction TEXT NOT NULL CHECK (direction IN ('owed-by-agent', 'owed-to-agent')),
                    description TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('open', 'fulfilled', 'broken', 'cancelled')),
                    value_gp INTEGER CHECK (value_gp IS NULL OR value_gp >= 0), due_at TEXT,
                    evidence_episode_ids TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    resolved_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1),
                    FOREIGN KEY (agent_id, actor_key) REFERENCES agent_relationship(agent_id, actor_key) ON DELETE RESTRICT)`);
                this.database.run(`CREATE INDEX agent_commitment_agent_status
                    ON agent_commitment(agent_id, status, due_at)`);
                this.database.run('PRAGMA user_version = 6');
            });
            transaction.immediate();
        }
        if (version < 7) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_economic_actor_link (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('player', 'business', 'faction')),
                    actor_id TEXT NOT NULL, role TEXT NOT NULL
                        CHECK (role IN ('self', 'owner', 'manager', 'member', 'beneficiary')),
                    source TEXT NOT NULL CHECK (source IN ('identity', 'admin', 'system')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    PRIMARY KEY (agent_id, actor_kind, actor_id))`);
                this.database.run(`CREATE UNIQUE INDEX one_identity_actor_link_per_agent
                    ON agent_economic_actor_link(agent_id) WHERE source = 'identity'`);
                const rows = this.database.query(`SELECT agent_id, player_username, created_at, updated_at
                    FROM agent_identity`).all() as Array<{ agent_id: string; player_username: string;
                        created_at: string; updated_at: string }>;
                for (const row of rows) {
                    this.database.run(`INSERT INTO agent_economic_actor_link
                        (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                        VALUES (?1, 'player', ?2, 'self', 'identity', ?3, ?4, 1)`,
                    [row.agent_id, normalizeEconomicActorId(row.player_username, 'playerUsername'),
                        row.created_at, row.updated_at]);
                }
                this.database.run('PRAGMA user_version = 7');
            });
            transaction.immediate();
        }
        if (version < 8) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_consolidation_evidence (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    rule_key TEXT NOT NULL, evidence_key TEXT NOT NULL,
                    episode_id TEXT NOT NULL REFERENCES agent_episode(episode_id) ON DELETE RESTRICT,
                    occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY (agent_id, rule_key, evidence_key))`);
                this.database.run(`CREATE INDEX agent_consolidation_evidence_rule
                    ON agent_consolidation_evidence(agent_id, rule_key, occurred_at)`);
                this.database.run('PRAGMA user_version = 8');
            });
                transaction.immediate();
        }
        if (version < 9) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_control_profile (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('player', 'institution', 'service', 'world-director')),
                    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('player', 'business', 'faction', 'service', 'world')),
                    subject_id TEXT NOT NULL, avatar_player_username TEXT,
                    decision_interval_ms INTEGER NOT NULL CHECK (decision_interval_ms BETWEEN 1000 AND 86400000),
                    max_decisions_per_day INTEGER NOT NULL CHECK (max_decisions_per_day BETWEEN 1 AND 1000),
                    daily_llm_budget_micros INTEGER NOT NULL CHECK (daily_llm_budget_micros >= 0),
                    daily_operational_budget_gp INTEGER NOT NULL CHECK (daily_operational_budget_gp >= 0),
                    last_decision_at TEXT, next_decision_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK ((role = 'player' AND subject_kind = 'player' AND avatar_player_username IS NOT NULL)
                        OR (role = 'institution' AND subject_kind IN ('business', 'faction') AND avatar_player_username IS NULL)
                        OR (role = 'service' AND subject_kind = 'service' AND avatar_player_username IS NULL)
                        OR (role = 'world-director' AND subject_kind = 'world' AND avatar_player_username IS NULL)))`);
                this.database.run(`CREATE TABLE agent_decision_ledger (
                    decision_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'event', 'admin')),
                    llm_cost_micros INTEGER NOT NULL CHECK (llm_cost_micros >= 0),
                    operational_budget_gp INTEGER NOT NULL CHECK (operational_budget_gp >= 0),
                    occurred_at TEXT NOT NULL, profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1))`);
                this.database.run(`CREATE INDEX agent_decision_agent_day
                    ON agent_decision_ledger(agent_id, occurred_at)`);
                const rows = this.database.query(`SELECT agent_id, player_username, created_at, updated_at
                    FROM agent_identity`).all() as Array<{ agent_id: string; player_username: string;
                        created_at: string; updated_at: string }>;
                for (const row of rows) {
                    this.database.run(`INSERT INTO agent_control_profile
                        (agent_id, role, subject_kind, subject_id, avatar_player_username, decision_interval_ms,
                        max_decisions_per_day, daily_llm_budget_micros, daily_operational_budget_gp,
                        last_decision_at, next_decision_at, created_at, updated_at, revision)
                        VALUES (?1, 'player', 'player', ?2, ?3, 300000, 96, 0, 0, NULL, NULL, ?4, ?5, 1)`,
                    [row.agent_id, normalizeEconomicActorId(row.player_username, 'playerUsername'),
                        row.player_username, row.created_at, row.updated_at]);
                }
                this.database.run('PRAGMA user_version = 9');
            });
            transaction.immediate();
        }
    }
}
