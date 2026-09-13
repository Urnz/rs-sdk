import { describe, expect, test } from 'bun:test';
import { validateLlmRuntimeConfig } from '../config.js';

describe('LLM runtime config', () => {
    test('rejects unsafe or unbounded values', () => {
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true, provider: 'mock', model: 'test',
            limits: { maxDurationMs: 0, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } }))
            .toThrow('maxDurationMs');
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true, provider: 'Mock Provider', model: 'test',
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } }))
            .toThrow('provider');
    });

    test('requires explicit token pricing for the OpenAI provider', () => {
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true, provider: 'openai', model: 'test',
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 100 } }))
            .toThrow('pricing');
        expect(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true, provider: 'openai', model: 'test',
            pricing: { inputMicrosPerMillionTokens: 2_000_000, outputMicrosPerMillionTokens: 12_000_000 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 100 } }).pricing)
            .toEqual({ inputMicrosPerMillionTokens: 2_000_000, outputMicrosPerMillionTokens: 12_000_000 });
        expect(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false, provider: 'mock', model: 'test',
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } })
            .automaticReplanning).toBeFalse();
        expect(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false, provider: 'mock', model: 'test',
            dailyBudget: { scope: 'fixture-a', maxCostMicros: 20, maxDecisions: 2, estimatedCostMicros: 10 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 10 } }).dailyBudget)
            .toEqual({ scope: 'fixture-a', maxCostMicros: 20, maxDecisions: 2, estimatedCostMicros: 10 });
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false, provider: 'mock', model: 'test',
            dailyBudget: { maxCostMicros: 5, estimatedCostMicros: 10 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 10 } }))
            .toThrow('estimated cost');
    });

    test('keeps autonomous execution separate, exact and fail-closed', () => {
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false,
            automaticReplanning: false, provider: 'mock', model: 'test', autonomousExecution: {
                enabled: true, allowedSkills: [{ id: 'mining.safe', version: '1.0.0' }],
                maxOperations: 50, maxTimeoutMs: 60_000 }, limits: {
                maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } }))
            .toThrow('requires automaticReplanning');
        const config = validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false,
            automaticReplanning: true, provider: 'mock', model: 'test', autonomousExecution: {
                enabled: true, allowedSkills: [{ id: 'mining.safe', version: '1.0.0' }],
                maxOperations: 50, maxTimeoutMs: 60_000 }, limits: {
                maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } });
        expect(config.autonomousExecution).toMatchObject({ enabled: true,
            allowedSkills: [{ id: 'mining.safe', version: '1.0.0', risk: 'routine',
                maxQuantity: 28, maxGpPerRun: 0, maxGpPerDay: 0 }],
            maxOperations: 50, maxTimeoutMs: 60_000 });
        expect(config.autonomousExecution.allowedSkills[0]?.operations).not.toContain('buy-from-shop');
        expect(() => validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false,
            automaticReplanning: true, provider: 'mock', model: 'test', autonomousExecution: {
                enabled: true, allowedSkills: [{ id: 'shopping', version: '1.0.0', risk: 'shop-buy',
                    operations: ['buy-from-shop'], itemNames: ['Hammer'], maxUnitPriceGp: 10,
                    maxGpPerRun: 20, maxGpPerDay: 10 }]
            }, limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } }))
            .toThrow('Shop-buy authorization');
        expect(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: false,
            automaticReplanning: true, provider: 'mock', model: 'test', autonomousExecution: {
                enabled: true, allowedSkills: [{ id: 'trade.receive', version: '1.0.0', risk: 'player-trade',
                    operations: ['trade-receive-item'], itemNames: ['Bronze dagger'], partners: ['Worker1'] }]
            }, limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 }
        }).autonomousExecution.allowedSkills[0]).toMatchObject({ risk: 'player-trade',
            operations: ['trade-receive-item'], itemNames: ['bronze dagger'], partners: ['worker1'] });
    });
});
