import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { EconomySnapshot } from './types.js';
import type { AgentReplanCoordinator, ReplanRecord } from './replan-coordinator.js';
import { multiAgentExperimentsDbPath } from './paths.js';
import type { AdminSkillRun } from './skill-history.js';
import { extractEconomyEvents, summarizeEconomyEvents,
    type EconomyEventSummary } from './transaction-telemetry.js';

export type MultiAgentExperimentStatus = 'running' | 'completed' | 'completed-with-errors' | 'failed';

export interface MultiAgentExperimentInput {
    label: string;
    seed: string;
    summary: string;
    agentIds: readonly string[];
}

export interface MultiAgentExperimentCandidate {
    agentId: string;
    role: string;
    subjectKind: string;
    identityPlayerUsername: string | null;
    avatarPlayerUsername: string | null;
    onlineFresh: boolean;
}

export interface MultiAgentExperimentParticipant {
    agentId: string;
    avatarPlayerUsername: string;
    ordinal: number;
    eventId: string;
    status: string;
    runId: string | null;
    reason: string | null;
    record: ReplanRecord | null;
    skillRun: AdminSkillRun | null;
    updatedAt: string;
}

export interface MultiAgentExperimentMetrics {
    durationMs: number;
    totalCoinsDelta: number;
    totalXpDelta: number;
    sessionXpDelta: number;
    onlineDelta: number;
    completedParticipants: number;
    unsuccessfulParticipants: number;
    itemStockDelta: Array<{ id: number; name: string; count: number }>;
    economicEvents: number;
    economicEventSummary: EconomyEventSummary;
    uniqueSkills: number;
    skillConcentration: number;
    skillRuns: Array<{ skillId: string; runs: number }>;
}

export interface MultiAgentExperimentRun {
    experimentId: string;
    definitionDigest: string;
    label: string;
    seed: string;
    summary: string;
    status: MultiAgentExperimentStatus;
    baselineEconomy: EconomySnapshot;
    dispatchEconomy: EconomySnapshot | null;
    finalEconomy: EconomySnapshot | null;
    metrics: MultiAgentExperimentMetrics | null;
    participants: MultiAgentExperimentParticipant[];
    startedAt: string;
    dispatchedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    revision: number;
}

interface ExperimentRow {
    experiment_id: string; definition_digest: string; label: string; seed: string; summary: string;
    status: MultiAgentExperimentStatus; baseline_economy_json: string; dispatch_economy_json: string | null;
    final_economy_json: string | null; metrics_json: string | null;
    started_at: string; dispatched_at: string | null; finished_at: string | null; error: string | null; revision: number;
}

interface ParticipantRow {
    experiment_id: string; agent_id: string; avatar_player_username: string; ordinal: number;
    event_id: string; status: string; run_id: string | null; reason: string | null;
    record_json: string | null; skill_run_json: string | null; updated_at: string;
}

function boundedText(value: string, field: string, maximum: number): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain 1-${maximum} characters`);
    return normalized;
}

function agentId(value: string): string {
    const normalized = value.trim().toLocaleLowerCase('en-US');
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalized) || normalized.length > 64) {
        throw new Error(`Invalid experiment agent id: ${value}`);
    }
    return normalized;
}

function timestamp(value: string): string {
    if (Number.isNaN(Date.parse(value))) throw new Error('Experiment timestamp must be an ISO timestamp');
    return new Date(value).toISOString();
}

export function validateMultiAgentExperimentInput(input: MultiAgentExperimentInput): MultiAgentExperimentInput {
    if (!input || typeof input !== 'object') throw new Error('Experiment input must be an object');
    const unique = [...new Set((input.agentIds ?? []).map(agentId))];
    if (unique.length < 2 || unique.length > 50 || unique.length !== input.agentIds.length) {
        throw new Error('An experiment requires 2-50 unique agent ids');
    }
    return { label: boundedText(input.label, 'Experiment label', 120),
        seed: boundedText(input.seed, 'Experiment seed', 128),
        summary: boundedText(input.summary, 'Experiment summary', 320), agentIds: unique };
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function multiAgentExperimentDefinition(input: MultiAgentExperimentInput): {
    input: MultiAgentExperimentInput; orderedAgentIds: string[]; digest: string;
} {
    const validated = validateMultiAgentExperimentInput(input);
    const canonicalAgentIds = [...validated.agentIds].sort();
    const digest = hash(JSON.stringify({ schemaVersion: 1, label: validated.label, seed: validated.seed,
        summary: validated.summary, agentIds: canonicalAgentIds }));
    const orderedAgentIds = [...canonicalAgentIds].sort((left, right) =>
        hash(`${validated.seed}\0${left}`).localeCompare(hash(`${validated.seed}\0${right}`)) || left.localeCompare(right));
    return { input: validated, orderedAgentIds, digest };
}

function participant(row: ParticipantRow): MultiAgentExperimentParticipant {
    return { agentId: row.agent_id, avatarPlayerUsername: row.avatar_player_username,
        ordinal: row.ordinal, eventId: row.event_id, status: row.status, runId: row.run_id,
        reason: row.reason, record: row.record_json ? JSON.parse(row.record_json) as ReplanRecord : null,
        skillRun: row.skill_run_json ? JSON.parse(row.skill_run_json) as AdminSkillRun : null,
        updatedAt: row.updated_at };
}

function economyMetrics(run: MultiAgentExperimentRun, finalEconomy: EconomySnapshot,
    finishedAt: string): MultiAgentExperimentMetrics {
    const baselineItems = new Map(run.baselineEconomy.itemStock.map(item => [item.id, item]));
    const finalItems = new Map(finalEconomy.itemStock.map(item => [item.id, item]));
    const ids = new Set([...baselineItems.keys(), ...finalItems.keys()]);
    const itemStockDelta = [...ids].map(id => ({ id,
        name: finalItems.get(id)?.name ?? baselineItems.get(id)?.name ?? `Item ${id}`,
        count: (finalItems.get(id)?.count ?? 0) - (baselineItems.get(id)?.count ?? 0) }))
        .filter(item => item.count !== 0)
        .sort((left, right) => Math.abs(right.count) - Math.abs(left.count) || left.id - right.id)
        .slice(0, 100);
    const completedParticipants = run.participants.filter(item => item.status === 'completed').length;
    const skillCounts = new Map<string, number>();
    const economicEvents = run.participants.flatMap(item => {
        const skillRun = item.skillRun;
        if (!skillRun) return [];
        skillCounts.set(skillRun.skill.id, (skillCounts.get(skillRun.skill.id) ?? 0) + 1);
        return extractEconomyEvents({ runId: skillRun.runId, username: skillRun.username,
            skillId: skillRun.skill.id, events: skillRun.events });
    });
    const skillRuns = [...skillCounts].map(([skillId, runs]) => ({ skillId, runs }))
        .sort((left, right) => right.runs - left.runs || left.skillId.localeCompare(right.skillId));
    const totalSkillRuns = skillRuns.reduce((total, item) => total + item.runs, 0);
    const skillConcentration = totalSkillRuns === 0 ? 0 : Number(skillRuns.reduce((total, item) =>
        total + (item.runs / totalSkillRuns) ** 2, 0).toFixed(6));
    return { durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
        totalCoinsDelta: finalEconomy.totalCoins - run.baselineEconomy.totalCoins,
        totalXpDelta: finalEconomy.totalXp - run.baselineEconomy.totalXp,
        sessionXpDelta: finalEconomy.sessionXpGained - run.baselineEconomy.sessionXpGained,
        onlineDelta: finalEconomy.online - run.baselineEconomy.online,
        completedParticipants,
        unsuccessfulParticipants: run.participants.length - completedParticipants,
        itemStockDelta, economicEvents: economicEvents.length,
        economicEventSummary: summarizeEconomyEvents(economicEvents),
        uniqueSkills: skillRuns.length, skillConcentration, skillRuns };
}

export class MultiAgentExperimentStore {
    private readonly database: Database;

    constructor(path = multiAgentExperimentsDbPath) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS multi_agent_experiment (
            experiment_id TEXT PRIMARY KEY, definition_digest TEXT NOT NULL, label TEXT NOT NULL,
            seed TEXT NOT NULL, summary TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed-with-errors', 'failed')),
            baseline_economy_json TEXT NOT NULL, dispatch_economy_json TEXT,
            started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
            revision INTEGER NOT NULL CHECK (revision >= 1))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS multi_agent_experiment_participant (
            experiment_id TEXT NOT NULL REFERENCES multi_agent_experiment(experiment_id) ON DELETE RESTRICT,
            agent_id TEXT NOT NULL, avatar_player_username TEXT NOT NULL, ordinal INTEGER NOT NULL,
            event_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, run_id TEXT, reason TEXT,
            record_json TEXT, updated_at TEXT NOT NULL,
            PRIMARY KEY (experiment_id, agent_id), UNIQUE (experiment_id, ordinal))`);
        this.addColumn('multi_agent_experiment', 'final_economy_json', 'TEXT');
        this.addColumn('multi_agent_experiment', 'metrics_json', 'TEXT');
        this.addColumn('multi_agent_experiment', 'dispatched_at', 'TEXT');
        this.addColumn('multi_agent_experiment_participant', 'skill_run_json', 'TEXT');
    }

    private addColumn(table: string, column: string, declaration: string): void {
        const columns = this.database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some(entry => entry.name === column)) this.database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }

    close(): void { this.database.close(true); }

    get(experimentId: string): MultiAgentExperimentRun | null {
        const row = this.database.query('SELECT * FROM multi_agent_experiment WHERE experiment_id = ?1')
            .get(experimentId) as ExperimentRow | null;
        if (!row) return null;
        const participants = (this.database.query(`SELECT * FROM multi_agent_experiment_participant
            WHERE experiment_id = ?1 ORDER BY ordinal`).all(experimentId) as ParticipantRow[]).map(participant);
        return { experimentId: row.experiment_id, definitionDigest: row.definition_digest,
            label: row.label, seed: row.seed, summary: row.summary, status: row.status,
            baselineEconomy: JSON.parse(row.baseline_economy_json) as EconomySnapshot,
            dispatchEconomy: row.dispatch_economy_json ? JSON.parse(row.dispatch_economy_json) as EconomySnapshot : null,
            finalEconomy: row.final_economy_json ? JSON.parse(row.final_economy_json) as EconomySnapshot : null,
            metrics: row.metrics_json ? JSON.parse(row.metrics_json) as MultiAgentExperimentMetrics : null,
            participants, startedAt: row.started_at, dispatchedAt: row.dispatched_at, finishedAt: row.finished_at,
            error: row.error, revision: row.revision };
    }

    list(limit = 50): MultiAgentExperimentRun[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Experiment list limit is invalid');
        const ids = (this.database.query(`SELECT experiment_id FROM multi_agent_experiment
            ORDER BY started_at DESC, experiment_id DESC LIMIT ?1`).all(limit) as Array<{ experiment_id: string }>);
        return ids.map(row => this.get(row.experiment_id)!);
    }

    create(definition: ReturnType<typeof multiAgentExperimentDefinition>,
        candidates: ReadonlyMap<string, MultiAgentExperimentCandidate>, baseline: EconomySnapshot,
        now = new Date().toISOString(), experimentId = randomUUID()): MultiAgentExperimentRun {
        const startedAt = timestamp(now);
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO multi_agent_experiment
                (experiment_id, definition_digest, label, seed, summary, status, baseline_economy_json,
                    dispatch_economy_json, started_at, finished_at, error, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, NULL, ?7, NULL, NULL, 1)`,
            [experimentId, definition.digest, definition.input.label, definition.input.seed,
                definition.input.summary, JSON.stringify(baseline), startedAt]);
            definition.orderedAgentIds.forEach((id, ordinal) => {
                const candidate = candidates.get(id)!;
                this.database.run(`INSERT INTO multi_agent_experiment_participant
                    (experiment_id, agent_id, avatar_player_username, ordinal, event_id, status,
                        run_id, reason, record_json, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, NULL, NULL, ?6)`,
                [experimentId, id, candidate.avatarPlayerUsername!, ordinal,
                    `${experimentId}.${id}`, startedAt]);
            });
        });
        transaction.immediate();
        return this.get(experimentId)!;
    }

    recordParticipant(experimentId: string, agent: string, record: ReplanRecord,
        now = new Date().toISOString()): MultiAgentExperimentParticipant {
        const updatedAt = timestamp(now);
        const runId = record.outcome?.runId ?? null;
        if (runId && this.database.query(`SELECT 1 FROM multi_agent_experiment_participant
            WHERE run_id = ?1 LIMIT 1`).get(runId)) throw new Error('Skill run is already assigned to an experiment participant');
        const invalidExecution = record.outcome?.status === 'executing' && !runId;
        const status = record.error || invalidExecution
            ? 'failed' : record.outcome?.status ?? `gate:${record.gate.reason}`;
        const reason = invalidExecution ? 'Executing outcome has no skill run id.'
            : record.error ?? record.outcome?.reason ?? record.gate.reason;
        const result = this.database.run(`UPDATE multi_agent_experiment_participant
            SET status = ?3, run_id = ?4, reason = ?5, record_json = ?6, updated_at = ?7
            WHERE experiment_id = ?1 AND agent_id = ?2 AND status = 'pending'`,
        [experimentId, agentId(agent), status, runId,
            reason, JSON.stringify(record), updatedAt]);
        if (result.changes !== 1) throw new Error('Experiment participant is missing or already resolved');
        return participant(this.database.query(`SELECT * FROM multi_agent_experiment_participant
            WHERE experiment_id = ?1 AND agent_id = ?2`).get(experimentId, agentId(agent)) as ParticipantRow);
    }

    failParticipant(experimentId: string, agent: string, error: string,
        now = new Date().toISOString()): MultiAgentExperimentParticipant {
        const updatedAt = timestamp(now);
        const message = boundedText(error, 'Participant error', 1000);
        const result = this.database.run(`UPDATE multi_agent_experiment_participant
            SET status = 'failed', reason = ?3, updated_at = ?4
            WHERE experiment_id = ?1 AND agent_id = ?2 AND status = 'pending'`,
        [experimentId, agentId(agent), message, updatedAt]);
        if (result.changes !== 1) throw new Error('Experiment participant is missing or already resolved');
        return participant(this.database.query(`SELECT * FROM multi_agent_experiment_participant
            WHERE experiment_id = ?1 AND agent_id = ?2`).get(experimentId, agentId(agent)) as ParticipantRow);
    }

    markDispatched(experimentId: string, dispatch: EconomySnapshot,
        now = new Date().toISOString()): MultiAgentExperimentRun {
        const dispatchedAt = timestamp(now);
        const current = this.get(experimentId);
        if (!current || current.status !== 'running') throw new Error('Experiment is missing or no longer running');
        if (current.participants.some(item => item.status === 'pending')) {
            throw new Error('Experiment dispatch cannot finish with pending participants');
        }
        this.database.run(`UPDATE multi_agent_experiment SET dispatch_economy_json = ?2,
            dispatched_at = ?3, revision = revision + 1 WHERE experiment_id = ?1 AND status = 'running'`,
        [experimentId, JSON.stringify(dispatch), dispatchedAt]);
        return this.get(experimentId)!;
    }

    recordSkillRun(runId: string, skillRun: AdminSkillRun | null, processSucceeded: boolean,
        fallbackReason: string, now = new Date().toISOString()): MultiAgentExperimentRun | null {
        const currentRows = this.database.query(`SELECT experiment_id FROM multi_agent_experiment_participant
            WHERE run_id = ?1 AND status = 'executing'`).all(runId) as Array<{ experiment_id: string }>;
        if (currentRows.length > 1) throw new Error('Skill run is ambiguously assigned to experiment participants');
        const currentRow = currentRows[0] ?? null;
        if (!currentRow) {
            const existing = this.database.query(`SELECT experiment_id FROM multi_agent_experiment_participant
                WHERE run_id = ?1`).get(runId) as { experiment_id: string } | null;
            return existing ? this.get(existing.experiment_id) : null;
        }
        const updatedAt = timestamp(now);
        const status = processSucceeded && skillRun ? skillRun.status : 'failed';
        const reason = processSucceeded && skillRun
            ? skillRun.reason || skillRun.message || fallbackReason
            : fallbackReason;
        this.database.run(`UPDATE multi_agent_experiment_participant SET status = ?2, reason = ?3,
            skill_run_json = ?4, updated_at = ?5 WHERE run_id = ?1 AND status = 'executing'
                AND experiment_id = ?6`,
        [runId, status, boundedText(reason || 'Skill process exited without a valid journal.', 'Skill result reason', 1000),
            skillRun ? JSON.stringify(skillRun) : null, updatedAt, currentRow.experiment_id]);
        return this.get(currentRow.experiment_id);
    }

    isReadyToFinalize(experimentId: string): boolean {
        const run = this.get(experimentId);
        return Boolean(run && run.status === 'running' && run.dispatchEconomy
            && run.participants.every(item => item.status !== 'pending' && item.status !== 'executing'));
    }

    finish(experimentId: string, finalEconomy: EconomySnapshot, now = new Date().toISOString()): MultiAgentExperimentRun {
        const finishedAt = timestamp(now);
        const current = this.get(experimentId);
        if (!current) throw new Error('Experiment is missing');
        if (current.status !== 'running') return current;
        if (!current.dispatchEconomy || current.participants.some(item => item.status === 'pending' || item.status === 'executing')) {
            throw new Error('Experiment cannot finish before every dispatched skill run resolves');
        }
        const metrics = economyMetrics(current, finalEconomy, finishedAt);
        const status: MultiAgentExperimentStatus = metrics.unsuccessfulParticipants
            ? 'completed-with-errors' : 'completed';
        this.database.run(`UPDATE multi_agent_experiment SET status = ?2, final_economy_json = ?3,
            metrics_json = ?4, finished_at = ?5, revision = revision + 1
            WHERE experiment_id = ?1 AND status = 'running'`,
        [experimentId, status, JSON.stringify(finalEconomy), JSON.stringify(metrics), finishedAt]);
        return this.get(experimentId)!;
    }

    fail(experimentId: string, error: string, now = new Date().toISOString()): MultiAgentExperimentRun {
        const finishedAt = timestamp(now);
        const message = boundedText(error, 'Experiment error', 1000);
        const result = this.database.run(`UPDATE multi_agent_experiment SET status = 'failed', error = ?2,
            finished_at = ?3, revision = revision + 1 WHERE experiment_id = ?1 AND status = 'running'`,
        [experimentId, message, finishedAt]);
        if (result.changes !== 1) throw new Error('Experiment is missing or no longer running');
        return this.get(experimentId)!;
    }
}

export interface MultiAgentExperimentDependencies {
    listCandidates(): Promise<readonly MultiAgentExperimentCandidate[]>;
    economySnapshot(): Promise<EconomySnapshot>;
    coordinator: AgentReplanCoordinator;
    store: MultiAgentExperimentStore;
}

function preflight(definition: ReturnType<typeof multiAgentExperimentDefinition>,
    all: readonly MultiAgentExperimentCandidate[]): Map<string, MultiAgentExperimentCandidate> {
    const byId = new Map(all.map(candidate => [candidate.agentId, candidate]));
    const selected = new Map<string, MultiAgentExperimentCandidate>();
    const avatars = new Set<string>();
    for (const id of definition.orderedAgentIds) {
        const candidate = byId.get(id);
        if (!candidate) throw new Error(`Experiment agent does not exist: ${id}`);
        const avatar = candidate.avatarPlayerUsername;
        if (candidate.role !== 'player' || candidate.subjectKind !== 'player' || !avatar
            || candidate.identityPlayerUsername !== avatar) {
            throw new Error(`Experiment agent ${id} has no exact player-avatar binding`);
        }
        if (!candidate.onlineFresh) throw new Error(`Experiment agent ${id} has no fresh online world state`);
        if (avatars.has(avatar)) throw new Error(`Experiment agents cannot share avatar ${avatar}`);
        avatars.add(avatar); selected.set(id, candidate);
    }
    return selected;
}

export async function startMultiAgentExperiment(input: MultiAgentExperimentInput,
    dependencies: MultiAgentExperimentDependencies, now = new Date().toISOString()): Promise<{
        run: MultiAgentExperimentRun; completion: Promise<MultiAgentExperimentRun>;
    }> {
    const definition = multiAgentExperimentDefinition(input);
    const candidates = preflight(definition, await dependencies.listCandidates());
    const baseline = await dependencies.economySnapshot();
    const run = dependencies.store.create(definition, candidates, baseline, now);
    const completion = (async () => {
        try {
            await Promise.all(run.participants.map(async entry => {
                try {
                    const record = await dependencies.coordinator.submit({ eventId: entry.eventId,
                        agentId: entry.agentId, type: 'manual-request',
                        sourceKey: `experiment:${run.experimentId}:${definition.digest}:${entry.agentId}`,
                        occurredAt: now,
                        summary: `Trusted multi-agent experiment ${run.label}: ${run.summary}` }, now);
                    dependencies.store.recordParticipant(run.experimentId, entry.agentId, record);
                } catch (error) {
                    dependencies.store.failParticipant(run.experimentId, entry.agentId,
                        error instanceof Error ? error.message : String(error));
                }
            }));
            const dispatched = dependencies.store.markDispatched(run.experimentId, await dependencies.economySnapshot());
            return dependencies.store.isReadyToFinalize(run.experimentId)
                ? dependencies.store.finish(run.experimentId, await dependencies.economySnapshot())
                : dispatched;
        } catch (error) {
            return dependencies.store.fail(run.experimentId, error instanceof Error ? error.message : String(error));
        }
    })();
    return { run, completion };
}

export async function reconcileMultiAgentExperimentSkillRun(runId: string, skillRun: AdminSkillRun | null,
    processSucceeded: boolean, fallbackReason: string,
    dependencies: Pick<MultiAgentExperimentDependencies, 'store' | 'economySnapshot'>,
    now = new Date().toISOString()): Promise<MultiAgentExperimentRun | null> {
    const run = dependencies.store.recordSkillRun(runId, skillRun, processSucceeded, fallbackReason, now);
    if (!run || !dependencies.store.isReadyToFinalize(run.experimentId)) return run;
    return dependencies.store.finish(run.experimentId, await dependencies.economySnapshot(), now);
}
