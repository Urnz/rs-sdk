import { existsSync } from 'node:fs';
import { AgentStateStore } from '../../../agent-state/store.js';
import { SqliteInferenceQueueClaimStore } from '../../../llm-runtime/inference-queue-store.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { agentStateDbPath, inferenceQueueDbPath, replanInboxDbPath } from './paths.js';

export type AutonomyRuntimeStatus = 'enrolled' | 'idle' | 'planning' | 'executing' | 'backoff'
    | 'quarantined' | 'offline' | 'recovering' | 'paused';
export type AutonomyWaitingFor = 'admin-approval' | 'fresh-state' | 'capability'
    | 'fail-closed-reconciliation' | null;

export interface AutonomyObservabilityEntry {
    agentId: string; status: AutonomyRuntimeStatus; waitingFor: AutonomyWaitingFor;
    replanQueue: { pending: number; claimed: number; failed: number };
    inferenceQueue: { pending: number; claimed: number; failed: number };
    lease: { owner: string | null; expiresAt: string | null };
    costToday: { llmMicros: number; operationalGp: number; decisions: number };
    lastVerifiedProgressAt: string | null; nextWakeupAt: string | null;
}

export interface AgentView {
    identity: { agentId: string };
    controlProfile: { avatarPlayerUsername: string | null };
    autonomyEnrollment: { status: 'desired' | 'running' | 'paused' | 'quarantined'; nextWakeupAt: string | null;
        leaseOwner: string | null; leaseExpiresAt: string | null; failureCount: number; quarantineReason: string | null } | null;
    decisionContextBlockers: string[];
    goalProposals: Array<{ status: string }>;
    planner: { kind: string };
    recentEpisodes: Array<{ trust: string; occurredAt: string; source: string }>;
    workingMemory: { observedAt: string } | null;
}

export function readAutonomyObservability(agents: readonly AgentView[], options: {
    agentPath?: string; inboxPath?: string; inferencePath?: string; now?: string;
} = {}): { agents: AutonomyObservabilityEntry[]; generatedAt: string } {
    const now = options.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) throw new Error('Autonomy observability time is invalid');
    const agentStore = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    const inbox = existsSync(options.inboxPath ?? replanInboxDbPath)
        ? new ReplanInboxStore(options.inboxPath ?? replanInboxDbPath) : null;
    const inference = existsSync(options.inferencePath ?? inferenceQueueDbPath)
        ? new SqliteInferenceQueueClaimStore(options.inferencePath ?? inferenceQueueDbPath) : null;
    try {
        return { generatedAt: now, agents: agents.map(agent => {
            const enrollment = agent.autonomyEnrollment;
            const replans = inbox?.listForAgent(agent.identity.agentId, 1_000) ?? [];
            const claims = inference?.listForAgent(agent.identity.agentId, 1_000) ?? [];
            const activeDispatch = replans.some(item => {
                if (item.status !== 'completed' || !item.terminalOutcome) return false;
                try {
                    const record = JSON.parse(item.terminalOutcome) as { outcome?: { status?: string; runId?: string } };
                    return record.outcome?.status === 'executing' && !!record.outcome.runId
                        && !agentStore.getSkillRunOutcome(record.outcome.runId);
                } catch { return false; }
            });
            const freshStateBlocked = agent.decisionContextBlockers.some(item => /fresh|online|state/i.test(item));
            const waitingFor: AutonomyWaitingFor = enrollment?.status === 'quarantined'
                ? 'fail-closed-reconciliation'
                : agent.goalProposals.some(item => item.status === 'pending') ? 'admin-approval'
                    : freshStateBlocked ? 'fresh-state'
                        : agent.planner.kind === 'missing-skill' ? 'capability' : null;
            const status: AutonomyRuntimeStatus = !enrollment ? 'offline'
                : enrollment.status === 'paused' ? 'paused'
                    : enrollment.status === 'quarantined' ? 'quarantined'
                        : activeDispatch ? 'executing'
                            : replans.some(item => item.status === 'claimed') || claims.some(item => item.status === 'claimed')
                                ? 'planning'
                                : enrollment.nextWakeupAt && Date.parse(enrollment.nextWakeupAt) > nowMs ? 'backoff'
                                    : freshStateBlocked && agent.controlProfile.avatarPlayerUsername ? 'recovering'
                                        : enrollment.status === 'running' ? 'planning'
                                            : replans.length === 0 ? 'enrolled' : 'idle';
            const decisions = agentStore.listDecisions(agent.identity.agentId, now.slice(0, 10));
            const progress = agent.recentEpisodes.find(item => item.trust === 'trusted' && item.source === 'skill')
                ?.occurredAt ?? agent.workingMemory?.observedAt ?? null;
            return { agentId: agent.identity.agentId, status, waitingFor,
                replanQueue: { pending: replans.filter(item => item.status === 'pending').length,
                    claimed: replans.filter(item => item.status === 'claimed').length,
                    failed: replans.filter(item => item.lastError).length },
                inferenceQueue: { pending: claims.filter(item => item.status === 'pending').length,
                    claimed: claims.filter(item => item.status === 'claimed').length,
                    failed: claims.filter(item => item.status === 'failed').length },
                lease: { owner: enrollment?.leaseOwner ?? null, expiresAt: enrollment?.leaseExpiresAt ?? null },
                costToday: { llmMicros: decisions.reduce((sum, item) => sum + item.llmCostMicros, 0),
                    operationalGp: decisions.reduce((sum, item) => sum + item.operationalBudgetGp, 0),
                    decisions: decisions.length }, lastVerifiedProgressAt: progress,
                nextWakeupAt: enrollment?.nextWakeupAt ?? null };
        }) };
    } finally { inference?.close(); inbox?.close(); agentStore.close(); }
}
