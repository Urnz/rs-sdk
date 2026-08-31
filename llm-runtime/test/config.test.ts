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
        expect(config.autonomousExecution).toEqual({ enabled: true,
            allowedSkills: [{ id: 'mining.safe', version: '1.0.0' }],
            maxOperations: 50, maxTimeoutMs: 60_000 });
    });
});
