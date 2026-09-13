import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AgentStateStore } from '../../../agent-state/store.js';
import { readAudit, verifyAuditChain, type AuditChainVerification } from './audit.js';
import { readAgentTimeline, type AgentTimelineEntry } from './agent-timeline.js';
import { agentStateDbPath, auditLogPath } from './paths.js';
import type { AuditEntry } from './types.js';

interface SoakIntervention {
    kind: string; plannedElapsedMinutes: number; status: string; startedAt: string | null;
    finishedAt: string | null; beforeRunId: string | null; afterRunId: string | null; error: string | null;
}

export interface LiveSoakSession {
    schemaVersion: 1; sessionId: string; fixtureId: string; fixtureVersion: string; fixturePath: string;
    agentIds: string[]; botNames: string[]; durationMinutes: number; snapshotIntervalSeconds: number;
    startedAt: string; plannedFinishedAt: string; status: 'running' | 'completed' | 'failed'; processId: number;
    initialRunId: string | null; finalRunId: string | null; finishedAt: string | null;
    plannedOperatorInterventions: SoakIntervention[];
    unplannedOperatorInterventions: Array<Record<string, unknown>>; error: string | null;
}

interface SoakSnapshot {
    sessionId: string; kind: string; capturedAt: string; elapsedSeconds: number; runId: string | null;
    health: { healthy: boolean };
    autonomy: Array<{ agentId: string; status: string; waitingFor?: string | null;
        replanQueue?: { pending: number; claimed: number; failed: number } }> | null;
    captureError: string | null;
}

export interface LiveSoakTerminalRun {
    runId: string; decisionId: string | null; goalId: string | null; skillId: string;
    skillVersion: string; status: string; classification: string | null; occurredAt: string;
}

export interface LiveSoakAgentEvidence {
    agentId: string;
    terminalRuns: LiveSoakTerminalRun[];
    backoffEvidence: Array<{ id: string; timestamp: string; status: string; summary: string }>;
    eventIds: string[];
    decisionIds: string[];
    goalIds: string[];
    limits: {
        maxDecisionsPerDay: number;
        dailyLlmBudgetMicros: number;
        dailyOperationalBudgetGp: number;
        decisionsDuringSoak: number;
        llmMicrosDuringSoak: number;
        operationalGpDuringSoak: number;
    };
}

export interface LiveSoakAcceptanceBundle {
    schemaVersion: 1;
    generatedAt: string;
    manifest: {
        sessionId: string; fixtureId: string; fixtureVersion: string; sourceRevision: string | null;
        startedAt: string; finishedAt: string | null; elapsedSeconds: number;
        initialRunId: string | null; finalRunId: string | null;
    };
    restartContinuity: {
        interventions: SoakIntervention[];
        preRestartSnapshot: SoakSnapshot | null;
        postRestartSnapshot: SoakSnapshot | null;
    };
    agents: LiveSoakAgentEvidence[];
    cohort: {
        productionRunIds: string[];
        shopRunIds: string[];
        bankRunIds: string[];
        socialEvents: Array<{ sourceId: string; kind: string; status: string; settlementIds: string[];
            agentIds: string[] }>;
    };
    correlationIds: { eventIds: string[]; runIds: string[]; decisionIds: string[]; goalIds: string[];
        settlementIds: string[] };
    operatorInterventions: { planned: SoakIntervention[]; unplanned: Array<Record<string, unknown>> };
    integrity: {
        audit: AuditChainVerification;
        relevantAuditEntries: AuditEntry[];
        snapshotCount: number;
        unhealthySnapshotTimestamps: string[];
        duplicateRunIds: string[];
        duplicateEventIds: string[];
        duplicateSettlementIds: string[];
    };
    criteria: {
        completedSixtyMinutes: boolean;
        sixPersistentAgents: boolean;
        plannedRestartContinuous: boolean;
        noUnplannedIntervention: boolean;
        everyAgentHasThreeTerminalsOrBackoff: boolean;
        productionShopAndBankObserved: boolean;
        twoSocialEventsObserved: boolean;
        auditAndCorrelationIntegrity: boolean;
        accepted: boolean;
    };
    bundleDigest: string;
}

export interface BuildLiveSoakAcceptanceOptions {
    agentPath?: string; auditPath?: string; snapshotsPath?: string; sourceRevision?: string | null;
    now?: string; timelines?: Map<string, AgentTimelineEntry[]>;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]));
}

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function gitRevision(): string | null {
    try {
        const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' });
        const value = result.success ? result.stdout.toString().trim().toLowerCase() : '';
        return /^[0-9a-f]{40,64}$/.test(value) ? value : null;
    } catch { return null; }
}

function validDate(value: string | null, field: string): number {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(parsed)) throw new Error(`Live soak ${field} is invalid`);
    return parsed;
}

function unique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

function duplicates(groups: string[][]): string[] {
    const owners = new Map<string, number>();
    for (const group of groups) for (const id of new Set(group)) owners.set(id, (owners.get(id) ?? 0) + 1);
    return [...owners].filter(([, count]) => count > 1).map(([id]) => id).sort();
}

function detailsString(entry: AgentTimelineEntry, key: string): string | null {
    const value = entry.details[key];
    return typeof value === 'string' && value ? value : null;
}

function detailsStrings(entry: AgentTimelineEntry, key: string): string[] {
    const value = entry.details[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

async function readJsonLines<T>(path: string): Promise<T[]> {
    const source = await readFile(path, 'utf8');
    return source.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as T);
}

function skillFrom(entry: AgentTimelineEntry): { id: string; version: string } | null {
    const value = entry.details.skill;
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.version === 'string'
        ? { id: record.id, version: record.version } : null;
}

function socialEvidence(entries: Array<{ agentId: string; entry: AgentTimelineEntry }>) {
    const bySource = new Map<string, { sourceId: string; kind: string; status: string; settlementIds: string[];
        agentIds: string[] }>();
    for (const { agentId, entry } of entries) {
        if (entry.kind !== 'domain-action' || !entry.correlation.sourceId) continue;
        const requester = detailsString(entry, 'requesterAgentId');
        const assignee = detailsString(entry, 'assigneeAgentId');
        const contractKind = detailsString(entry, 'kind');
        if ((!requester || !assignee) && !contractKind) continue;
        const sourceId = entry.correlation.sourceId;
        const current = bySource.get(sourceId) ?? { sourceId, kind: requester && assignee ? 'player-action' :
            `contract:${contractKind}`, status: entry.status, settlementIds: [], agentIds: [] };
        current.agentIds = unique([...current.agentIds, agentId, ...(requester ? [requester] : []),
            ...(assignee ? [assignee] : [])]);
        current.settlementIds = unique([...current.settlementIds, ...detailsStrings(entry, 'settlementIds'),
            ...(detailsString(entry, 'settlementId') ? [detailsString(entry, 'settlementId')!] : [])]);
        bySource.set(sourceId, current);
    }
    return [...bySource.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export async function buildLiveSoakAcceptanceBundle(sessionPath: string,
    options: BuildLiveSoakAcceptanceOptions = {}): Promise<LiveSoakAcceptanceBundle> {
    const session = JSON.parse(await readFile(sessionPath, 'utf8')) as LiveSoakSession;
    if (session.schemaVersion !== 1 || !session.sessionId || !Array.isArray(session.agentIds)) {
        throw new Error('Live soak session schema is invalid');
    }
    const startMs = validDate(session.startedAt, 'start time');
    const generatedAt = new Date(options.now ?? new Date().toISOString()).toISOString();
    const endIso = session.finishedAt ?? generatedAt;
    const endMs = validDate(endIso, 'end time');
    if (endMs < startMs) throw new Error('Live soak end precedes its start');
    const snapshotsPath = options.snapshotsPath ?? sessionPath.replace(/session\.json$/, 'snapshots.jsonl');
    const snapshots = (await readJsonLines<SoakSnapshot>(snapshotsPath))
        .filter(item => item.sessionId === session.sessionId);
    const agentStore = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    const allEntries: Array<{ agentId: string; entry: AgentTimelineEntry }> = [];
    const agents: LiveSoakAgentEvidence[] = [];
    try {
        for (const agentId of session.agentIds) {
            const entries = (options.timelines?.get(agentId) ?? readAgentTimeline(agentId, {
                agentPath: options.agentPath, limit: 1_000 }).entries)
                .filter(item => Date.parse(item.timestamp) >= startMs && Date.parse(item.timestamp) <= endMs);
            allEntries.push(...entries.map(entry => ({ agentId, entry })));
            const terminalRuns = entries.filter(item => item.kind === 'evidence' && item.correlation.runId)
                .flatMap(item => {
                    const skill = skillFrom(item);
                    return skill ? [{ runId: item.correlation.runId!, decisionId: item.correlation.decisionId ?? null,
                        goalId: item.correlation.goalId ?? null, skillId: skill.id, skillVersion: skill.version,
                        status: item.status, classification: detailsString(item, 'classification'),
                        occurredAt: item.timestamp }] : [];
                });
            const backoffEvidence = entries.filter(item => item.kind === 'policy-result' &&
                /backoff|capability|precondition|retry|input/i.test(`${item.status} ${item.summary}`))
                .map(item => ({ id: item.id, timestamp: item.timestamp, status: item.status, summary: item.summary }));
            const profile = agentStore.getControlProfile(agentId);
            if (!profile) throw new Error(`Live soak agent has no control profile: ${agentId}`);
            const decisions = agentStore.listDecisions(agentId).filter(item =>
                Date.parse(item.occurredAt) >= startMs && Date.parse(item.occurredAt) <= endMs);
            agents.push({ agentId, terminalRuns, backoffEvidence,
                eventIds: unique(entries.flatMap(item => item.correlation.eventId ? [item.correlation.eventId] : [])),
                decisionIds: unique(entries.flatMap(item => item.correlation.decisionId ? [item.correlation.decisionId] : [])),
                goalIds: unique(entries.flatMap(item => item.correlation.goalId ? [item.correlation.goalId] : [])),
                limits: { maxDecisionsPerDay: profile.maxDecisionsPerDay,
                    dailyLlmBudgetMicros: profile.dailyLlmBudgetMicros,
                    dailyOperationalBudgetGp: profile.dailyOperationalBudgetGp,
                    decisionsDuringSoak: decisions.length,
                    llmMicrosDuringSoak: decisions.reduce((sum, item) => sum + item.llmCostMicros, 0),
                    operationalGpDuringSoak: decisions.reduce((sum, item) => sum + item.operationalBudgetGp, 0) } });
        }
    } finally { agentStore.close(); }

    const socialEvents = socialEvidence(allEntries);
    const allRuns = agents.map(agent => agent.terminalRuns.map(run => run.runId));
    const allEvents = agents.map(agent => agent.eventIds);
    const settlementGroups = socialEvents.map(item => item.settlementIds);
    const correlationIds = {
        eventIds: unique(allEvents.flat()), runIds: unique(allRuns.flat()),
        decisionIds: unique(agents.flatMap(item => item.decisionIds)),
        goalIds: unique(agents.flatMap(item => item.goalIds)), settlementIds: unique(settlementGroups.flat())
    };
    const skills = agents.flatMap(agent => agent.terminalRuns).filter(item => item.status === 'completed');
    const productionRunIds = unique(skills.filter(item => item.skillId.startsWith('production.')).map(item => item.runId));
    const shopRunIds = unique(skills.filter(item => item.skillId.startsWith('shopping.')
        || item.skillId.includes('general-store')).map(item => item.runId));
    const bankRunIds = unique(skills.filter(item => item.skillId.includes('bank')).map(item => item.runId));
    const duplicateRunIds = duplicates(allRuns);
    const duplicateEventIds = duplicates(allEvents);
    const duplicateSettlementIds = duplicates(settlementGroups);
    const auditPath = options.auditPath ?? auditLogPath;
    const audit = await verifyAuditChain(auditPath);
    const relevantAuditEntries = (await readAudit(1_000, auditPath)).filter(entry =>
        Date.parse(entry.timestamp) >= startMs && Date.parse(entry.timestamp) <= endMs).reverse();
    const preRestartSnapshot = snapshots.find(item => item.kind === 'pre-restart') ?? null;
    const postRestartSnapshot = snapshots.find(item => item.kind === 'post-restart') ?? null;
    const restart = session.plannedOperatorInterventions.find(item =>
        item.kind === 'gateway-engine-stack-restart');
    const elapsedSeconds = Math.max(0, (endMs - startMs) / 1_000);
    const criteria = {
        completedSixtyMinutes: session.status === 'completed' && elapsedSeconds >= 3_600,
        sixPersistentAgents: session.agentIds.length >= 6 && snapshots.length > 0 && snapshots.every(item =>
            !item.captureError && item.autonomy?.length === session.agentIds.length),
        plannedRestartContinuous: !!restart && restart.status === 'completed' && !!restart.beforeRunId
            && !!restart.afterRunId && restart.beforeRunId !== restart.afterRunId
            && !!preRestartSnapshot?.health.healthy && !!postRestartSnapshot?.health.healthy,
        noUnplannedIntervention: session.unplannedOperatorInterventions.length === 0,
        everyAgentHasThreeTerminalsOrBackoff: agents.every(item =>
            item.terminalRuns.length >= 3 || item.backoffEvidence.length > 0),
        productionShopAndBankObserved: productionRunIds.length > 0 && shopRunIds.length > 0 && bankRunIds.length > 0,
        twoSocialEventsObserved: socialEvents.filter(item =>
            (item.status === 'completed' || item.status === 'fulfilled') && item.settlementIds.length > 0).length >= 2,
        auditAndCorrelationIntegrity: audit.valid && duplicateRunIds.length === 0
            && duplicateEventIds.length === 0 && duplicateSettlementIds.length === 0
    };
    const withoutDigest = { schemaVersion: 1 as const, generatedAt,
        manifest: { sessionId: session.sessionId, fixtureId: session.fixtureId,
            fixtureVersion: session.fixtureVersion,
            sourceRevision: options.sourceRevision === undefined ? gitRevision() : options.sourceRevision,
            startedAt: session.startedAt, finishedAt: session.finishedAt, elapsedSeconds,
            initialRunId: session.initialRunId, finalRunId: session.finalRunId },
        restartContinuity: { interventions: session.plannedOperatorInterventions,
            preRestartSnapshot, postRestartSnapshot }, agents,
        cohort: { productionRunIds, shopRunIds, bankRunIds, socialEvents }, correlationIds,
        operatorInterventions: { planned: session.plannedOperatorInterventions,
            unplanned: session.unplannedOperatorInterventions },
        integrity: { audit, relevantAuditEntries, snapshotCount: snapshots.length,
            unhealthySnapshotTimestamps: snapshots.filter(item => !item.health.healthy).map(item => item.capturedAt),
            duplicateRunIds, duplicateEventIds, duplicateSettlementIds }, criteria: { ...criteria,
            accepted: Object.values(criteria).every(Boolean) } };
    const bundle: LiveSoakAcceptanceBundle = { ...withoutDigest, bundleDigest: '' };
    bundle.bundleDigest = liveSoakAcceptanceDigest(bundle);
    return bundle;
}

export function liveSoakAcceptanceDigest(bundle: LiveSoakAcceptanceBundle): string {
    const { bundleDigest: _bundleDigest, ...payload } = bundle;
    return hash(payload);
}

export function verifyLiveSoakAcceptanceBundle(bundle: LiveSoakAcceptanceBundle): boolean {
    return /^[0-9a-f]{64}$/.test(bundle.bundleDigest)
        && liveSoakAcceptanceDigest(bundle) === bundle.bundleDigest
        && bundle.criteria.accepted;
}
