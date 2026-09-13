export type LlmReplanEventType = 'manual-request' | 'skill-finished' | 'skill-failed' | 'goal-changed'
    | 'unexpected-world-event' | 'offer-received' | 'significant-economic-change' | 'capability-ready'
    | 'economic-contract-changed' | 'player-action-changed' | 'business-work-available'
    | 'property-changed' | 'governance-changed' | 'allowlisted-world-event'
    | 'autonomy-startup' | 'autonomy-reconnect' | 'autonomy-idle';

export interface LlmReplanEvent {
    eventId: string;
    agentId: string;
    type: LlmReplanEventType;
    sourceKey: string;
    occurredAt: string;
    summary: string;
    /** Trusted deterministic selector for equal-priority immediate goals. */
    selectionSeed?: string;
}

export interface LlmReplanGateResult {
    accepted: boolean;
    reason: 'accepted' | 'duplicate' | 'cooldown' | 'invalid-time';
    nextAllowedAt: string;
}

/**
 * Coalesces external events before they reach the inference queue. It is not a
 * timer and deliberately has no tick-facing API: callers submit meaningful
 * domain events only.
 */
export class LlmReplanEventGate {
    private readonly seen = new Map<string, number>();
    private readonly lastAcceptedByAgent = new Map<string, number>();

    constructor(private readonly cooldownMs = 5_000, private readonly retentionMs = 60 * 60_000) {
        if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 60 * 60_000) {
            throw new Error('LLM replan cooldown must be between 0 and 60 minutes');
        }
        if (!Number.isInteger(retentionMs) || retentionMs < cooldownMs || retentionMs > 7 * 24 * 60 * 60_000) {
            throw new Error('LLM replan event retention must cover the cooldown and be at most 7 days');
        }
    }

    /** Rebuilds bounded cooldown state from a trusted durable terminal journal. */
    restoreAccepted(agentId: string, acceptedAt: string): void {
        const timestamp = Date.parse(acceptedAt);
        if (!agentId || Number.isNaN(timestamp)) throw new Error('Restored LLM replan admission is invalid');
        const previous = this.lastAcceptedByAgent.get(agentId) ?? Number.NEGATIVE_INFINITY;
        if (timestamp > previous) this.lastAcceptedByAgent.set(agentId, timestamp);
    }

    /** Releases only the exact process-local dedupe key after a proven transient admission failure. */
    releaseForRetry(event: LlmReplanEvent, acceptedAt: string): boolean {
        const timestamp = Date.parse(acceptedAt);
        if (Number.isNaN(timestamp)) throw new Error('Released LLM replan admission is invalid');
        const key = `${event.agentId}|${event.type}|${event.sourceKey}`;
        if (this.seen.get(key) !== timestamp) return false;
        return this.seen.delete(key);
    }

    consider(event: LlmReplanEvent, now = new Date().toISOString()): LlmReplanGateResult {
        const current = Date.parse(now);
        const occurred = Date.parse(event.occurredAt);
        if (Number.isNaN(current) || Number.isNaN(occurred) || occurred > current + 60_000) {
            return { accepted: false, reason: 'invalid-time', nextAllowedAt: now };
        }
        for (const [key, seenAt] of this.seen) if (current - seenAt > this.retentionMs) this.seen.delete(key);
        const key = `${event.agentId}|${event.type}|${event.sourceKey}`;
        const previous = this.lastAcceptedByAgent.get(event.agentId) ?? Number.NEGATIVE_INFINITY;
        const nextAllowed = previous + this.cooldownMs;
        if (this.seen.has(key)) {
            return { accepted: false, reason: 'duplicate', nextAllowedAt: new Date(Math.max(current, nextAllowed)).toISOString() };
        }
        const urgent = event.type === 'manual-request' || event.type === 'unexpected-world-event'
            || event.type === 'skill-finished' || event.type === 'skill-failed' || event.type === 'goal-changed'
            || event.type === 'capability-ready' || event.type === 'autonomy-startup'
            || event.type === 'autonomy-reconnect' || event.type === 'economic-contract-changed'
            || event.type === 'player-action-changed' || event.type === 'business-work-available'
            || event.type === 'property-changed' || event.type === 'governance-changed'
            || event.type === 'allowlisted-world-event';
        if (!urgent && current < nextAllowed) {
            return { accepted: false, reason: 'cooldown', nextAllowedAt: new Date(nextAllowed).toISOString() };
        }
        this.seen.set(key, current);
        this.lastAcceptedByAgent.set(event.agentId, current);
        return { accepted: true, reason: 'accepted', nextAllowedAt: new Date(current + this.cooldownMs).toISOString() };
    }
}
