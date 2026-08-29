import { describe, expect, test } from 'bun:test';
import { LlmReplanEventGate, type LlmReplanEvent } from '../events.js';

const event: LlmReplanEvent = { eventId: 'event-1', agentId: 'ferrye14', type: 'skill-finished',
    sourceKey: 'skill-run-1', occurredAt: '2026-08-29T12:00:00.000Z', summary: 'Mining completed.' };

describe('event-driven LLM replan gate', () => {
    test('accepts domain events once and deduplicates their source', () => {
        const gate = new LlmReplanEventGate(5000);
        expect(gate.consider(event, '2026-08-29T12:00:01.000Z').accepted).toBeTrue();
        expect(gate.consider(event, '2026-08-29T12:00:10.000Z').reason).toBe('duplicate');
    });

    test('coalesces bursts but lets explicit admin previews bypass the cooldown', () => {
        const gate = new LlmReplanEventGate(5000);
        gate.consider(event, '2026-08-29T12:00:01.000Z');
        expect(gate.consider({ ...event, eventId: 'event-2', type: 'offer-received', sourceKey: 'offer-1' },
            '2026-08-29T12:00:02.000Z').reason).toBe('cooldown');
        expect(gate.consider({ ...event, eventId: 'event-3', type: 'manual-request', sourceKey: 'admin-1' },
            '2026-08-29T12:00:02.000Z').accepted).toBeTrue();
    });
});
