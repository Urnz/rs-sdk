import { createHash } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { AgentSkillDispatch } from '../../../agent-state/types.js';
import { readAudit, verifyAuditChain, type AuditChainVerification } from './audit.js';
import { readDefaultAppliedFixture } from './experiment-economy-provenance.js';
import { MultiAgentExperimentStore, type MultiAgentExperimentRun } from './multi-agent-experiments.js';
import { agentStateDbPath, auditLogPath, multiAgentExperimentsDbPath } from './paths.js';
import type { AuditEntry } from './types.js';
import type { ProtoSocietyFixture } from './proto-society-fixture.js';

export interface AcceptanceBundle {
    schemaVersion: 1;
    generatedAt: string;
    manifest: {
        experimentId: string;
        label: string;
        seed: string;
        build: { worldBuild: string; sourceRevision: string | null };
        fixture: { fixtureId: string; fixtureVersion: string; baselineDigest: string } | null;
        definitionDigest: string;
        environmentDigest: string;
        parameterProfile: { id: string; version: string; digest: string } | null;
        mods: Array<{ id: string; version: string; dataSchemaVersion: number; enabled: boolean }>;
        policies: Array<{ agentId: string; policyId: string | null; policyVersion: string | null;
            source: 'skill-dispatch' | 'missing' }>;
    };
    baselineDigests: Array<{ agentId: string; avatarPlayerUsername: string; digest: string }>;
    correlationIds: { eventIds: string[]; runIds: string[]; decisionIds: string[]; goalIds: string[] };
    outcome: Pick<MultiAgentExperimentRun, 'status' | 'startedAt' | 'dispatchedAt' | 'finishedAt' | 'metrics'>;
    audit: { verification: AuditChainVerification; relevantEntries: AuditEntry[] };
    bundleDigest: string;
}

export interface AcceptanceBundleOptions {
    experimentPath?: string;
    agentPath?: string;
    auditPath?: string;
    fixture?: ProtoSocietyFixture | null;
    sourceRevision?: string | null;
    now?: string;
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

function sourceRevision(): string | null {
    try {
        const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' });
        const value = result.success ? result.stdout.toString().trim().toLowerCase() : '';
        return /^[0-9a-f]{40,64}$/.test(value) ? value : null;
    } catch { return null; }
}

function dispatches(run: MultiAgentExperimentRun, agents: AgentStateStore): Map<string, AgentSkillDispatch> {
    return new Map(run.participants.flatMap(participant => {
        const dispatch = participant.runId ? agents.getSkillDispatch(participant.runId) : null;
        return dispatch ? [[participant.agentId, dispatch] as const] : [];
    }));
}

export async function buildAcceptanceBundle(experimentId: string,
    options: AcceptanceBundleOptions = {}): Promise<AcceptanceBundle> {
    const experimentStore = new MultiAgentExperimentStore(options.experimentPath ?? multiAgentExperimentsDbPath);
    const agents = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    try {
        const run = experimentStore.get(experimentId);
        if (!run) throw new Error('Acceptance bundle experiment does not exist');
        if (!['completed', 'completed-with-errors'].includes(run.status) || !run.finishedAt || !run.metrics) {
            throw new Error('Acceptance bundle requires a finalized experiment');
        }
        const auditPath = options.auditPath ?? auditLogPath;
        const verification = await verifyAuditChain(auditPath);
        if (!verification.valid) throw new Error(verification.error ?? 'Acceptance audit chain is invalid');
        const byAgent = dispatches(run, agents);
        const missingPolicyAgents = run.participants.filter(item => !byAgent.has(item.agentId)).map(item => item.agentId);
        if (missingPolicyAgents.length) {
            throw new Error(`Acceptance policy evidence is missing for: ${missingPolicyAgents.join(', ')}`);
        }
        const eventIds = run.participants.map(item => item.eventId).sort();
        const runIds = run.participants.flatMap(item => item.runId ? [item.runId] : []).sort();
        const decisionIds = [...new Set([...byAgent.values()].map(item => item.decisionId))].sort();
        const goalIds = [...new Set([...byAgent.values()].map(item => item.goalId))].sort();
        const needles = [run.experimentId, ...eventIds, ...runIds, ...decisionIds, ...goalIds];
        const relevantEntries = (await readAudit(1_000, auditPath)).filter(entry => {
            const serialized = JSON.stringify(entry);
            return needles.some(id => serialized.includes(id));
        }).reverse();
        if (!relevantEntries.length || relevantEntries.some(entry => !entry.previousHash || !entry.entryHash)) {
            throw new Error('Acceptance bundle requires relevant hash-chained audit entries');
        }
        const fixture = options.fixture === undefined ? readDefaultAppliedFixture() : options.fixture;
        const generatedAt = new Date(options.now ?? new Date().toISOString()).toISOString();
        const manifest = {
            experimentId: run.experimentId, label: run.label, seed: run.seed,
            build: { worldBuild: fixture?.worldBuild ?? 'lostcity-local-private',
                sourceRevision: options.sourceRevision === undefined ? sourceRevision() : options.sourceRevision },
            fixture: fixture ? { fixtureId: fixture.fixtureId, fixtureVersion: fixture.fixtureVersion,
                baselineDigest: fixture.baselineDigest } : null,
            definitionDigest: run.definitionDigest, environmentDigest: run.environmentDigest,
            parameterProfile: run.parameterProfile && run.parameterProfileDigest ? {
                id: run.parameterProfile.profileId, version: run.parameterProfile.version,
                digest: run.parameterProfileDigest } : null,
            mods: run.environment.mods.map(item => ({ id: item.id, version: item.version,
                dataSchemaVersion: item.dataSchemaVersion, enabled: item.enabled })),
            policies: run.participants.map(participant => {
                const dispatch = byAgent.get(participant.agentId);
                return { agentId: participant.agentId, policyId: dispatch?.policyId ?? null,
                    policyVersion: dispatch?.policyVersion ?? null,
                    source: dispatch ? 'skill-dispatch' as const : 'missing' as const };
            })
        };
        const withoutDigest = { schemaVersion: 1 as const, generatedAt, manifest,
            baselineDigests: run.participants.map(item => {
                if (!item.baselineAvatarDigest) throw new Error(`Acceptance baseline digest is missing for ${item.agentId}`);
                return { agentId: item.agentId, avatarPlayerUsername: item.avatarPlayerUsername,
                    digest: item.baselineAvatarDigest };
            }), correlationIds: { eventIds, runIds, decisionIds, goalIds },
            outcome: { status: run.status, startedAt: run.startedAt, dispatchedAt: run.dispatchedAt,
                finishedAt: run.finishedAt, metrics: run.metrics },
            audit: { verification, relevantEntries } };
        const bundle: AcceptanceBundle = { ...withoutDigest, bundleDigest: '' };
        bundle.bundleDigest = acceptanceBundleDigest(bundle);
        return bundle;
    } finally { agents.close(); experimentStore.close(); }
}

export function verifyAcceptanceBundle(bundle: AcceptanceBundle): boolean {
    const { bundleDigest } = bundle;
    return /^[0-9a-f]{64}$/.test(bundleDigest) && acceptanceBundleDigest(bundle) === bundleDigest
        && bundle.audit.verification.valid;
}

export function acceptanceBundleDigest(bundle: AcceptanceBundle): string {
    const { bundleDigest: _bundleDigest, ...payload } = bundle;
    return hash(payload);
}
