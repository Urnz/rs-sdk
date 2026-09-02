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

export interface MultiAgentExperimentWorldMod {
    id: string;
    version: string;
    dataSchemaVersion: number;
    enabled: boolean;
    config: Record<string, boolean | number | string>;
}

export interface MultiAgentExperimentEnvironment {
    schemaVersion: 1;
    activeRevision: number;
    capturedAt: string;
    mods: MultiAgentExperimentWorldMod[];
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
    uniqueTargets: number;
    uniqueRegions: number;
    goalLinkedRuns: number;
    successfulGoalRuns: number;
    participantResults: MultiAgentExperimentParticipantResult[];
}

export interface MultiAgentExperimentParticipantResult {
    agentId: string;
    avatarPlayerUsername: string;
    goalId: string | null;
    skillId: string | null;
    status: string;
    netCoins: number;
    producedItems: number;
    consumedItems: number;
    shopTransactions: number;
    playerTrades: number;
    targets: string[];
    regions: string[];
}

export interface MultiAgentExperimentRun {
    experimentId: string;
    definitionDigest: string;
    environmentDigest: string;
    environment: MultiAgentExperimentEnvironment;
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
    environment_digest: string; environment_json: string;
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

function canonicalConfig(config: Record<string, boolean | number | string>): Record<string, boolean | number | string> {
    return Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)));
}

export function validateMultiAgentExperimentEnvironment(
    input: MultiAgentExperimentEnvironment
): { environment: MultiAgentExperimentEnvironment; digest: string } {
    if (!input || typeof input !== 'object' || input.schemaVersion !== 1
        || !Number.isSafeInteger(input.activeRevision) || input.activeRevision < 0
        || Number.isNaN(Date.parse(input.capturedAt)) || !Array.isArray(input.mods) || input.mods.length === 0) {
        throw new Error('Experiment world-mod environment is invalid');
    }
    const ids = new Set<string>();
    const mods = input.mods.map(mod => {
        if (!mod || typeof mod !== 'object' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(mod.id)
            || ids.has(mod.id) || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(mod.version)
            || !Number.isSafeInteger(mod.dataSchemaVersion) || mod.dataSchemaVersion < 1
            || typeof mod.enabled !== 'boolean' || !mod.config || typeof mod.config !== 'object'
            || Array.isArray(mod.config) || Object.values(mod.config).some(value =>
                !['boolean', 'number', 'string'].includes(typeof value)
                || (typeof value === 'number' && !Number.isFinite(value)))) {
            throw new Error('Experiment world-mod entry is invalid');
        }
        ids.add(mod.id);
        return { id: mod.id, version: mod.version, dataSchemaVersion: mod.dataSchemaVersion,
            enabled: mod.enabled, config: canonicalConfig(mod.config) };
    }).sort((left, right) => left.id.localeCompare(right.id));
    const environment = { schemaVersion: 1 as const, activeRevision: input.activeRevision,
        capturedAt: timestamp(input.capturedAt), mods };
    return { environment, digest: hash(JSON.stringify({ schemaVersion: 1, mods })) };
}

export interface MultiAgentExperimentComparison {
    controlExperimentId: string;
    treatmentExperimentId: string;
    seed: string;
    agentIds: string[];
    environmentDifference: { modId: 'economy.diminishing-xp'; controlEnabled: false; treatmentEnabled: true };
    treatmentMinusControl: Pick<MultiAgentExperimentMetrics, 'totalCoinsDelta' | 'totalXpDelta'
        | 'sessionXpDelta' | 'economicEvents' | 'uniqueSkills' | 'skillConcentration'
        | 'uniqueTargets' | 'uniqueRegions' | 'successfulGoalRuns'>;
}

export function compareMultiAgentExperiments(control: MultiAgentExperimentRun,
    treatment: MultiAgentExperimentRun): MultiAgentExperimentComparison {
    if (control.status !== 'completed' || treatment.status !== 'completed' || !control.metrics || !treatment.metrics) {
        throw new Error('A controlled comparison requires two successfully completed experiments');
    }
    const controlAgents = control.participants.map(item => item.agentId).sort();
    const treatmentAgents = treatment.participants.map(item => item.agentId).sort();
    if (control.seed !== treatment.seed || JSON.stringify(controlAgents) !== JSON.stringify(treatmentAgents)) {
        throw new Error('Controlled experiments must use the same seed and exact agent cohort');
    }
    const controlEnvironment = validateMultiAgentExperimentEnvironment(control.environment).environment;
    const treatmentEnvironment = validateMultiAgentExperimentEnvironment(treatment.environment).environment;
    const normalize = (environment: MultiAgentExperimentEnvironment, expectedEnabled: boolean) => environment.mods.map(mod =>
        mod.id === 'economy.diminishing-xp' ? { ...mod, enabled: expectedEnabled } : mod);
    const controlDiminishing = controlEnvironment.mods.find(mod => mod.id === 'economy.diminishing-xp');
    const treatmentDiminishing = treatmentEnvironment.mods.find(mod => mod.id === 'economy.diminishing-xp');
    if (!controlDiminishing || !treatmentDiminishing || controlDiminishing.enabled
        || !treatmentDiminishing.enabled || JSON.stringify(normalize(controlEnvironment, false))
            !== JSON.stringify(normalize(treatmentEnvironment, false))) {
        throw new Error('Controlled pair must differ only by the active diminishing XP switch');
    }
    const difference = <K extends keyof MultiAgentExperimentMetrics>(key: K): number =>
        Number(treatment.metrics![key]) - Number(control.metrics![key]);
    return { controlExperimentId: control.experimentId, treatmentExperimentId: treatment.experimentId,
        seed: control.seed, agentIds: controlAgents,
        environmentDifference: { modId: 'economy.diminishing-xp', controlEnabled: false, treatmentEnabled: true },
        treatmentMinusControl: { totalCoinsDelta: difference('totalCoinsDelta'),
            totalXpDelta: difference('totalXpDelta'), sessionXpDelta: difference('sessionXpDelta'),
            economicEvents: difference('economicEvents'), uniqueSkills: difference('uniqueSkills'),
            skillConcentration: difference('skillConcentration'), uniqueTargets: difference('uniqueTargets'),
            uniqueRegions: difference('uniqueRegions'), successfulGoalRuns: difference('successfulGoalRuns') } };
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

function recordGoalId(record: ReplanRecord | null): string | null {
    const decision = record?.outcome?.decision;
    if (!decision || typeof decision !== 'object') return null;
    const goalId = (decision as Record<string, unknown>).goalId;
    return typeof goalId === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(goalId) ? goalId : null;
}

function runTargets(run: AdminSkillRun | null): string[] {
    if (!run) return [];
    const targets = new Set<string>();
    for (const event of run.events) {
        if (event.type !== 'step.succeeded' || !event.data || typeof event.data !== 'object') continue;
        const target = event.data.target;
        if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
        const { kind, name } = target as Record<string, unknown>;
        if ((kind === 'loc' || kind === 'npc') && typeof name === 'string' && name.trim()) {
            targets.add(`${kind}:${name.trim().toLocaleLowerCase('en-US')}`);
        }
    }
    return [...targets].sort();
}

function runRegions(run: AdminSkillRun | null): string[] {
    if (!run) return [];
    const regions = new Set<string>();
    for (const event of run.events) {
        if (event.type !== 'step.succeeded' || !event.data || typeof event.data !== 'object') continue;
        const destination = event.data.destination;
        if (!destination || typeof destination !== 'object' || Array.isArray(destination)) continue;
        const { x, z } = destination as Record<string, unknown>;
        if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= 16_383
            && typeof z === 'number' && Number.isSafeInteger(z) && z >= 0 && z <= 16_383) {
            regions.add(`${Math.floor(x / 64)},${Math.floor(z / 64)}`);
        }
    }
    return [...regions].sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true }));
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
    const participantResults = run.participants.map(item => {
        const skillRun = item.skillRun;
        if (skillRun) skillCounts.set(skillRun.skill.id, (skillCounts.get(skillRun.skill.id) ?? 0) + 1);
        const events = skillRun ? extractEconomyEvents({ runId: skillRun.runId, username: skillRun.username,
            skillId: skillRun.skill.id, events: skillRun.events }) : [];
        const summary = summarizeEconomyEvents(events);
        return { result: { agentId: item.agentId, avatarPlayerUsername: item.avatarPlayerUsername,
            goalId: recordGoalId(item.record), skillId: skillRun?.skill.id ?? null, status: item.status,
            netCoins: summary.netCoins, producedItems: summary.producedItems,
            consumedItems: summary.consumedItems, shopTransactions: summary.shopTransactions,
            playerTrades: summary.playerTrades, targets: runTargets(skillRun), regions: runRegions(skillRun) }, events };
    });
    const economicEvents = participantResults.flatMap(item => item.events);
    const results = participantResults.map(item => item.result);
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
        uniqueSkills: skillRuns.length, skillConcentration, skillRuns,
        uniqueTargets: new Set(results.flatMap(item => item.targets)).size,
        uniqueRegions: new Set(results.flatMap(item => item.regions)).size,
        goalLinkedRuns: results.filter(item => item.goalId !== null).length,
        successfulGoalRuns: results.filter(item => item.goalId !== null && item.status === 'completed').length,
        participantResults: results };
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
        this.addColumn('multi_agent_experiment', 'environment_digest', "TEXT NOT NULL DEFAULT 'legacy'");
        this.addColumn('multi_agent_experiment', 'environment_json',
            "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1,\"activeRevision\":0,\"capturedAt\":\"1970-01-01T00:00:00.000Z\",\"mods\":[]}'");
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
            environmentDigest: row.environment_digest,
            environment: JSON.parse(row.environment_json) as MultiAgentExperimentEnvironment,
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
        environmentInput: MultiAgentExperimentEnvironment,
        now = new Date().toISOString(), experimentId = randomUUID()): MultiAgentExperimentRun {
        const startedAt = timestamp(now);
        const { environment, digest: environmentDigest } = validateMultiAgentExperimentEnvironment(environmentInput);
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO multi_agent_experiment
                (experiment_id, definition_digest, environment_digest, environment_json, label, seed, summary,
                    status, baseline_economy_json, dispatch_economy_json, started_at, finished_at, error, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, NULL, ?9, NULL, NULL, 1)`,
            [experimentId, definition.digest, environmentDigest, JSON.stringify(environment),
                definition.input.label, definition.input.seed, definition.input.summary,
                JSON.stringify(baseline), startedAt]);
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
    worldModEnvironment(): Promise<MultiAgentExperimentEnvironment>;
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
    const [baseline, environment] = await Promise.all([
        dependencies.economySnapshot(), dependencies.worldModEnvironment()
    ]);
    const run = dependencies.store.create(definition, candidates, baseline, environment, now);
    const completion = (async () => {
        try {
            await Promise.all(run.participants.map(async entry => {
                try {
                    const record = await dependencies.coordinator.submit({ eventId: entry.eventId,
                        agentId: entry.agentId, type: 'manual-request',
                        sourceKey: `experiment:${run.experimentId}:${definition.digest}:${entry.agentId}`,
                        occurredAt: now,
                        selectionSeed: definition.input.seed,
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
