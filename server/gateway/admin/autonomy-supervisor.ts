import { createHash } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { AgentAutonomyEnrollment } from '../../../agent-state/types.js';
import type { AgentReplanCoordinator, ReplanRecord } from './replan-coordinator.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { agentStateDbPath } from './paths.js';

export interface GatewayAgentAutonomySupervisorOptions {
    agentPath?: string;
    leaseOwner?: string;
    leaseMs?: number;
    retryMs?: number;
    maxRetryMs?: number;
    maxIdenticalFailures?: number;
    policy?: { id: string; version: string };
    activeSkill?: (username: string) => unknown;
    ensureAvatar?: (username: string) => Promise<{ ready: boolean; reason: string;
        status?: 'adopted' | 'starting' | 'spawned' | 'controller-conflict' | 'failed' }>;
    nextEvent?: (agentId: string, now: string) => LlmReplanEvent | null;
}

export interface AutonomySupervisorResult {
    agentId: string;
    status: 'executing' | 'released' | 'skipped' | 'failed';
    reason: string;
    record?: ReplanRecord;
}

function useStore<T>(path: string, callback: (store: AgentStateStore) => T): T {
    const store = new AgentStateStore(path);
    try { return callback(store); }
    finally { store.close(); }
}

function later(left: string, right: string): string {
    return Date.parse(left) >= Date.parse(right) ? left : right;
}

const RETRY_FAILURE_STATUSES = new Set(['failed', 'rejected', 'limit-reached', 'input-required', 'skipped',
    'bounded-wait', 'alternative-selected', 'operator-warning']);

function normalizedFailureText(value: string): string {
    return value.trim().toLowerCase()
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
        .replace(/\d{4}-\d{2}-\d{2}t\S+/gi, '<time>')
        .replace(/\b\d+\b/g, '<n>').slice(0, 1_000);
}

/** Stable across run ids/timestamps, but distinct for a different plan, skill, status, or error class. */
export function autonomyFailureFingerprint(record: ReplanRecord): string | null {
    const status = record.error ? 'coordinator-error' : record.outcome?.status;
    if (!record.error && (!status || !RETRY_FAILURE_STATUSES.has(status))) return null;
    const decision = record.outcome?.decision as { kind?: unknown; skill?: { id?: unknown; version?: unknown } } | undefined;
    const payload = {
        eventType: record.event.type,
        status,
        decisionKind: typeof decision?.kind === 'string' ? decision.kind : null,
        skill: typeof decision?.skill?.id === 'string' && typeof decision.skill.version === 'string'
            ? `${decision.skill.id}@${decision.skill.version}` : null,
        detail: normalizedFailureText(record.error ?? record.outcome?.reason ?? 'unknown failure')
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Claims durable due work and feeds it into the existing replan coordinator.
 * It owns no planner or executor of its own.
 */
export class GatewayAgentAutonomySupervisor {
    private readonly agentPath: string;
    private readonly leaseOwner: string;
    private readonly leaseMs: number;
    private readonly retryMs: number;
    private readonly maxRetryMs: number;
    private readonly maxIdenticalFailures: number;
    private readonly policy: { id: string; version: string };
    private readonly activeSkill: (username: string) => unknown;
    private readonly ensureAvatar: ((username: string) => Promise<{ ready: boolean; reason: string;
        status?: 'adopted' | 'starting' | 'spawned' | 'controller-conflict' | 'failed' }>) | null;
    private readonly nextEvent: ((agentId: string, now: string) => LlmReplanEvent | null) | null;
    private ticking = false;

    constructor(private readonly coordinator: AgentReplanCoordinator,
        options: GatewayAgentAutonomySupervisorOptions = {}) {
        this.agentPath = options.agentPath ?? agentStateDbPath;
        this.leaseOwner = options.leaseOwner ?? `gateway:${crypto.randomUUID()}`;
        this.leaseMs = options.leaseMs ?? 15 * 60_000;
        this.retryMs = options.retryMs ?? 30_000;
        this.maxRetryMs = options.maxRetryMs ?? 15 * 60_000;
        this.maxIdenticalFailures = options.maxIdenticalFailures ?? 3;
        this.policy = options.policy ?? { id: 'private-local-default', version: '1.0.0' };
        this.activeSkill = options.activeSkill ?? (() => null);
        this.ensureAvatar = options.ensureAvatar ?? null;
        this.nextEvent = options.nextEvent ?? null;
        if (!Number.isInteger(this.leaseMs) || this.leaseMs < 5_000 || this.leaseMs > 60 * 60_000) {
            throw new Error('Autonomy lease duration must be between 5 seconds and 60 minutes');
        }
        if (!Number.isInteger(this.retryMs) || this.retryMs < 1_000 || this.retryMs > 60 * 60_000) {
            throw new Error('Autonomy retry interval must be between 1 second and 60 minutes');
        }
        if (!Number.isInteger(this.maxRetryMs) || this.maxRetryMs < this.retryMs
            || this.maxRetryMs > 24 * 60 * 60_000) throw new Error('Autonomy maximum retry interval is invalid');
        if (!Number.isInteger(this.maxIdenticalFailures) || this.maxIdenticalFailures < 2
            || this.maxIdenticalFailures > 20) throw new Error('Autonomy identical failure bound is invalid');
    }

    async tick(now = new Date().toISOString(), startup = false): Promise<AutonomySupervisorResult[]> {
        if (this.ticking) return [];
        this.ticking = true;
        try {
            const stopped = useStore(this.agentPath, store => store.getAutonomyControl().emergencyStop);
            if (stopped) return [];
            useStore(this.agentPath, store => store.recoverExpiredAutonomyLeases(now));
            const preferred = new Map<string, LlmReplanEvent>();
            const due = useStore(this.agentPath, store => store.listAutonomyEnrollments('desired'))
                .filter(item => {
                    const event = this.nextEvent?.(item.agentId, now);
                    if (event) preferred.set(item.agentId, event);
                    return !!event || !item.nextWakeupAt || Date.parse(item.nextWakeupAt) <= Date.parse(now);
                });
            const results: AutonomySupervisorResult[] = [];
            for (const enrollment of due) {
                results.push(await this.runDue(enrollment, now, startup, preferred.get(enrollment.agentId)));
            }
            return results;
        } finally { this.ticking = false; }
    }

    async settle(record: ReplanRecord, now = new Date().toISOString()): Promise<AutonomySupervisorResult> {
        const enrollment = useStore(this.agentPath, store => store.getAutonomyEnrollment(record.event.agentId));
        if (!enrollment || enrollment.status !== 'running' || enrollment.leaseOwner !== this.leaseOwner) {
            return { agentId: record.event.agentId, status: 'skipped',
                reason: 'The autonomy lease is no longer owned by this gateway.', record };
        }
        if (record.outcome?.status === 'executing' && !record.error) {
            return { agentId: enrollment.agentId, status: 'executing', reason: record.outcome.reason, record };
        }
        const fingerprint = autonomyFailureFingerprint(record);
        const repeatedFailures = fingerprint
            ? (enrollment.lastFailureFingerprint === fingerprint ? enrollment.failureCount + 1 : 1) : 0;
        if (fingerprint && repeatedFailures >= this.maxIdenticalFailures) {
            const reason = `Autonomy circuit opened after ${repeatedFailures} identical failures (${fingerprint.slice(0, 12)}).`;
            useStore(this.agentPath, store => store.setAutonomyEnrollment(enrollment.agentId, enrollment.revision, {
                ...enrollment, status: 'quarantined', nextWakeupAt: null, leaseOwner: null, leaseExpiresAt: null,
                failureCount: repeatedFailures, lastFailureFingerprint: fingerprint, quarantineReason: reason
            }, now));
            return { agentId: enrollment.agentId, status: 'failed', reason, record };
        }
        const retryDelay = fingerprint
            ? Math.min(this.maxRetryMs, this.retryMs * (2 ** Math.max(0, repeatedFailures - 1)))
            : this.retryMs;
        const retryAt = new Date(Date.parse(now) + retryDelay).toISOString();
        const profileWakeup = useStore(this.agentPath,
            store => store.getControlProfile(enrollment.agentId)?.nextDecisionAt ?? retryAt);
        const nextWakeupAt = later(retryAt, later(profileWakeup, record.gate.nextAllowedAt));
        useStore(this.agentPath, store => store.setAutonomyEnrollment(enrollment.agentId, enrollment.revision, {
            ...enrollment, status: 'desired', nextWakeupAt, leaseOwner: null, leaseExpiresAt: null,
            failureCount: repeatedFailures, lastFailureFingerprint: fingerprint, quarantineReason: null
        }, now));
        return { agentId: enrollment.agentId, status: 'released',
            reason: record.error ?? record.outcome?.reason ?? `Retry scheduled for ${nextWakeupAt}.`, record };
    }

    private async runDue(enrollment: AgentAutonomyEnrollment, now: string,
        startup: boolean, preferredEvent?: LlmReplanEvent): Promise<AutonomySupervisorResult> {
        if (enrollment.policyId !== this.policy.id || enrollment.policyVersion !== this.policy.version) {
            return { agentId: enrollment.agentId, status: 'skipped',
                reason: `Unsupported autonomy policy ${enrollment.policyId}@${enrollment.policyVersion}.` };
        }
        const avatar = useStore(this.agentPath,
            store => store.getControlProfile(enrollment.agentId)?.avatarPlayerUsername ?? null);
        let claimable = enrollment;
        if (avatar && this.activeSkill(avatar)) {
            return { agentId: enrollment.agentId, status: 'skipped',
                reason: `Existing skill execution for ${avatar} must finish before a new claim.` };
        }
        if (avatar && this.ensureAvatar) {
            const avatarState = await this.ensureAvatar(avatar);
            if (!avatarState.ready) {
                const recoveryAttempt = avatarState.status === 'spawned' || avatarState.status === 'failed';
                const fingerprint = createHash('sha256').update(`avatar-recovery:${enrollment.agentId}`).digest('hex');
                const failures = recoveryAttempt
                    ? (enrollment.lastFailureFingerprint === fingerprint ? enrollment.failureCount + 1 : 1)
                    : enrollment.failureCount;
                if (recoveryAttempt && failures >= this.maxIdenticalFailures) {
                    const reason = `Avatar recovery circuit opened after ${failures} bounded attempts: ${avatarState.reason}`;
                    useStore(this.agentPath, store => store.setAutonomyEnrollment(enrollment.agentId,
                        enrollment.revision, { ...enrollment, status: 'quarantined', nextWakeupAt: null,
                            leaseOwner: null, leaseExpiresAt: null, failureCount: failures,
                            lastFailureFingerprint: fingerprint, quarantineReason: reason }, now));
                    return { agentId: enrollment.agentId, status: 'failed', reason };
                }
                const delay = recoveryAttempt
                    ? Math.min(this.maxRetryMs, this.retryMs * (2 ** Math.max(0, failures - 1))) : this.retryMs;
                const nextWakeupAt = new Date(Date.parse(now) + delay).toISOString();
                useStore(this.agentPath, store => store.setAutonomyEnrollment(enrollment.agentId,
                    enrollment.revision, { ...enrollment, nextWakeupAt,
                        ...(recoveryAttempt ? { failureCount: failures,
                            lastFailureFingerprint: fingerprint } : {}) }, now));
                return { agentId: enrollment.agentId, status: 'skipped', reason: avatarState.reason };
            }
            const avatarFingerprint = createHash('sha256').update(`avatar-recovery:${enrollment.agentId}`).digest('hex');
            if (enrollment.lastFailureFingerprint === avatarFingerprint) {
                claimable = useStore(this.agentPath, store => store.setAutonomyEnrollment(enrollment.agentId,
                    enrollment.revision, { ...enrollment, failureCount: 0, lastFailureFingerprint: null }, now));
            }
        }
        try {
            if (preferredEvent && claimable.nextWakeupAt
                && Date.parse(claimable.nextWakeupAt) > Date.parse(now)) {
                claimable = useStore(this.agentPath, store => store.setAutonomyEnrollment(claimable.agentId,
                    claimable.revision, { ...claimable, nextWakeupAt: now }, now));
            }
            const leaseExpiresAt = new Date(Date.parse(now) + this.leaseMs).toISOString();
            const claimed = useStore(this.agentPath, store => store.claimAutonomyEnrollment(claimable.agentId,
                claimable.revision, this.leaseOwner, leaseExpiresAt, now));
            const event = preferredEvent ?? {
                eventId: crypto.randomUUID(), agentId: claimed.agentId,
                type: startup ? 'autonomy-startup' as const : 'autonomy-idle' as const,
                sourceKey: `autonomy:${claimed.agentId}:revision:${claimed.revision}`,
                occurredAt: now, summary: startup
                    ? 'The durable autonomy supervisor reconciled this agent at gateway startup.'
                    : 'The durable autonomy supervisor woke this agent after its decision interval.',
                selectionSeed: `autonomy:${claimed.agentId}:${claimed.revision}`
            };
            const record = await this.coordinator.submit(event, now);
            return this.settle(record, now);
        } catch (error) {
            return { agentId: enrollment.agentId, status: 'failed',
                reason: error instanceof Error ? error.message : String(error) };
        }
    }
}
