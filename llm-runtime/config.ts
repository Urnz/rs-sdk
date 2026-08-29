import { LLM_RUNTIME_SCHEMA_VERSION, type LlmRuntimeConfig } from './types.js';

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
    return value as number;
}

export function validateLlmRuntimeConfig(input: unknown): LlmRuntimeConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('LLM runtime config must be an object');
    const value = input as Record<string, unknown>;
    if (value.schemaVersion !== LLM_RUNTIME_SCHEMA_VERSION) throw new Error(`Unsupported LLM runtime schema version: ${String(value.schemaVersion)}`);
    if (typeof value.enabled !== 'boolean') throw new Error('LLM runtime enabled must be boolean');
    if (typeof value.provider !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.provider)) {
        throw new Error('LLM runtime provider must be a short lowercase identifier');
    }
    if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 120) {
        throw new Error('LLM runtime model must contain 1 to 120 characters');
    }
    if (!value.limits || typeof value.limits !== 'object' || Array.isArray(value.limits)) throw new Error('LLM runtime limits must be an object');
    const limits = value.limits as Record<string, unknown>;
    return {
        schemaVersion: LLM_RUNTIME_SCHEMA_VERSION,
        enabled: value.enabled,
        provider: value.provider,
        model: value.model,
        limits: {
            maxDurationMs: integer(limits.maxDurationMs, 'maxDurationMs', 100, 300_000),
            maxModelRequests: integer(limits.maxModelRequests, 'maxModelRequests', 1, 20),
            maxToolCalls: integer(limits.maxToolCalls, 'maxToolCalls', 0, 20),
            maxCostMicros: integer(limits.maxCostMicros, 'maxCostMicros', 0, 100_000_000)
        }
    };
}
