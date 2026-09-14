import { LlmReplanEventGate, type LlmReplanEvent } from '../../../llm-runtime/events.js';
import { AgentReplanCoordinator, type AgentReplanCoordinatorDependencies,
    AUTONOMY_LEASE_OWNER_MISMATCH_REASON, type ReplanRecord } from './replan-coordinator.js';
import { ReplanInboxStore, type ReplanInboxRecord, type ReplanInboxSimulationClock } from './replan-inbox.js';

export interface DurableReplanCoordinatorOptions {
    path: string;
    leaseOwner?: string;
    leaseMs?: number;
    retryMs?: number;
    replayLimit?: number;
    simulationClock?: ReplanInboxSimulationClock;
}

function withStore<T>(path: string, callback: (store: ReplanInboxStore) => T,
    simulationClock?: ReplanInboxSimulationClock): T {
    const store = new ReplanInboxStore(path, simulationClock);
    try { return callback(store); }
    finally { store.close(); }
}

function terminalRecord(item: ReplanInboxRecord): ReplanRecord {
    if (!item.terminalOutcome) throw new Error('Terminal replan inbox record has no outcome');
    try {
        const value = JSON.parse(item.terminalOutcome) as ReplanRecord;
        if (!value?.event?.eventId || !value.gate || value.event.eventId !== item.event.eventId) {
            throw new Error('terminal record identity mismatch');
        }
        return value;
    } catch (error) {
        throw new Error(`Replan terminal outcome is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Durable admission layer; all actual planning still flows through the existing coordinator and event gate. */
export class DurableAgentReplanCoordinator extends AgentReplanCoordinator {
    private readonly path: string;
    private readonly leaseOwner: string;
    private readonly leaseMs: number;
    private readonly retryMs: number;
    private readonly replayLimit: number;
    private readonly retryGate: LlmReplanEventGate;
    private readonly simulationClock?: ReplanInboxSimulationClock;
    private replaying = false;

    constructor(dependencies: AgentReplanCoordinatorDependencies, options: DurableReplanCoordinatorOptions,
        gate = new LlmReplanEventGate(), significantCoins = 1_000, significantItems = 100) {
        super(dependencies, gate, significantCoins, significantItems);
        this.path = options.path;
        this.leaseOwner = options.leaseOwner ?? `gateway-replan:${crypto.randomUUID()}`;
        this.leaseMs = options.leaseMs ?? 60_000;
        this.retryMs = options.retryMs ?? 30_000;
        this.replayLimit = options.replayLimit ?? 25;
        this.simulationClock = options.simulationClock;
        this.retryGate = gate;
        if (!Number.isInteger(this.leaseMs) || this.leaseMs < 5_000 || this.leaseMs > 15 * 60_000) {
            throw new Error('Durable replan lease duration is invalid');
        }
        if (!Number.isInteger(this.retryMs) || this.retryMs < 1_000 || this.retryMs > 60 * 60_000) {
            throw new Error('Durable replan retry interval is invalid');
        }
        if (!Number.isInteger(this.replayLimit) || this.replayLimit < 1 || this.replayLimit > 100) {
            throw new Error('Durable replan replay limit is invalid');
        }
        for (const item of withStore(this.path, store => store.listTerminal(), this.simulationClock)) {
            try {
                const persisted = terminalRecord(item);
                if (persisted.gate.accepted) gate.restoreAccepted(persisted.event.agentId, persisted.timestamp);
            } catch {
                // Corrupt terminal data remains fail-closed when directly replayed; it cannot relax cooldown here.
            }
        }
    }

    override async submit(event: LlmReplanEvent, now = new Date().toISOString()): Promise<ReplanRecord> {
        const queued = this.enqueue(event, now);
        if (queued.record.status === 'completed' || queued.record.status === 'discarded') {
            return terminalRecord(queued.record);
        }
        const leaseExpiresAt = new Date(Date.parse(now) + this.leaseMs).toISOString();
        const claimed = withStore(this.path,
            store => store.claim(queued.record.event.eventId, this.leaseOwner, leaseExpiresAt, now), this.simulationClock);
        if (!claimed) return { timestamp: now, event: queued.record.event,
            gate: { accepted: false, reason: queued.record.status === 'pending' ? 'cooldown' : 'duplicate',
                nextAllowedAt: queued.record.nextAttemptAt }, outcome: null, error: null };
        return this.processClaimed(claimed, now);
    }

    enqueue(event: LlmReplanEvent, now = new Date().toISOString()) {
        return withStore(this.path, store => store.enqueue(event, now), this.simulationClock);
    }

    protected override async deliverObserved(event: LlmReplanEvent, now: string): Promise<ReplanRecord> {
        const queued = this.enqueue(event, now);
        return { timestamp: now, event: queued.record.event,
            gate: { accepted: true, reason: 'accepted', nextAllowedAt: now },
            outcome: { runId: queued.record.event.eventId, status: 'queued',
                reason: 'Observed event was durably queued for the autonomy supervisor.' }, error: null };
    }

    async replayDue(now = new Date().toISOString()): Promise<ReplanRecord[]> {
        if (this.replaying) return [];
        this.replaying = true;
        try {
            const leaseExpiresAt = new Date(Date.parse(now) + this.leaseMs).toISOString();
            const claimed = withStore(this.path, store => store.claimDue(this.leaseOwner,
                leaseExpiresAt, this.replayLimit, now), this.simulationClock);
            const results: ReplanRecord[] = [];
            for (const item of claimed) results.push(await this.processClaimed(item, now));
            return results;
        } finally { this.replaying = false; }
    }

    private async processClaimed(item: ReplanInboxRecord, now: string): Promise<ReplanRecord> {
        try {
            const result = await super.submit(item.event, now);
            if (result.outcome?.status === 'skipped'
                && result.outcome.reason === AUTONOMY_LEASE_OWNER_MISMATCH_REASON) {
                if (!this.retryGate.releaseForRetry(item.event, result.timestamp)) {
                    throw new Error('Transient replan admission could not release its exact dedupe key');
                }
                const nextAttemptAt = new Date(Date.parse(now) + this.retryMs).toISOString();
                withStore(this.path, store => store.retry(item.event.eventId, item.revision,
                    this.leaseOwner, result.outcome!.reason, nextAttemptAt, now), this.simulationClock);
                return result;
            }
            withStore(this.path, store => store.resolve(item.event.eventId, item.revision,
                this.leaseOwner, JSON.stringify(result), 'completed', new Date().toISOString()), this.simulationClock);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // The planner may already have crossed an execution boundary. Fail closed instead of replaying blindly.
            const failed: ReplanRecord = { timestamp: now, event: item.event,
                gate: { accepted: false, reason: 'duplicate', nextAllowedAt: now }, outcome: null, error: message };
            withStore(this.path, store => store.resolve(item.event.eventId, item.revision,
                this.leaseOwner, JSON.stringify(failed), 'discarded', new Date().toISOString()), this.simulationClock);
            throw error;
        }
    }
}

export async function replayDurableReplans(coordinator: AgentReplanCoordinator,
    now = new Date().toISOString()): Promise<ReplanRecord[]> {
    return coordinator instanceof DurableAgentReplanCoordinator ? coordinator.replayDue(now) : [];
}

export function enqueueDurableReplan(coordinator: AgentReplanCoordinator, event: LlmReplanEvent,
    now = new Date().toISOString()) {
    if (!(coordinator instanceof DurableAgentReplanCoordinator)) return null;
    return coordinator.enqueue(event, now);
}
