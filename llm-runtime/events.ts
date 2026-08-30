export type LlmReplanEventType = 'manual-request' | 'skill-finished' | 'skill-failed' | 'goal-changed'
    | 'unexpected-world-event' | 'offer-received' | 'significant-economic-change' | 'capability-ready';

export interface LlmReplanEvent {
    eventId: string;
    agentId: string;
    type: LlmReplanEventType;
    sourceKey: string;
    occurredAt: string;
    summary: string;
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
            || event.type === 'capability-ready';
        if (!urgent && current < nextAllowed) {
            return { accepted: false, reason: 'cooldown', nextAllowedAt: new Date(nextAllowed).toISOString() };
        }
        this.seen.set(key, current);
        this.lastAcceptedByAgent.set(event.agentId, current);
        return { accepted: true, reason: 'accepted', nextAllowedAt: new Date(current + this.cooldownMs).toISOString() };
    }
}
