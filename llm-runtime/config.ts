import { DEFAULT_LLM_PLANNER_PROMPT, LLM_RUNTIME_SCHEMA_VERSION, type LlmReasoningEffort,
    type LlmRuntimeConfig } from './types.js';

const REASONING_EFFORTS: readonly LlmReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_SKILL_BUILDER_PROMPT = `Design one small, reusable RuneScape agent skill for the supplied capability gap.
Use only the supplied declarative operations. Prefer parameters over hard-coded variants and keep every loop and retry bounded.
Do not emit JavaScript, shell commands, file paths, network calls, tools, provenance, status or access-control fields.`;

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
    if (value.automaticReplanning !== undefined && typeof value.automaticReplanning !== 'boolean') {
        throw new Error('LLM runtime automaticReplanning must be boolean');
    }
    if (typeof value.provider !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.provider)) {
        throw new Error('LLM runtime provider must be a short lowercase identifier');
    }
    if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 120) {
        throw new Error('LLM runtime model must contain 1 to 120 characters');
    }
    const plannerPrompt = value.plannerPrompt === undefined ? DEFAULT_LLM_PLANNER_PROMPT : value.plannerPrompt;
    if (typeof plannerPrompt !== 'string' || !plannerPrompt.trim() || plannerPrompt.length > 8000) {
        throw new Error('LLM runtime plannerPrompt must contain 1 to 8000 characters');
    }
    let reasoningEffort: LlmReasoningEffort | undefined;
    if (value.reasoningEffort !== undefined) {
        if (typeof value.reasoningEffort !== 'string' || !REASONING_EFFORTS.includes(value.reasoningEffort as LlmReasoningEffort)) {
            throw new Error('LLM runtime reasoningEffort is not supported');
        }
        reasoningEffort = value.reasoningEffort as LlmReasoningEffort;
    }
    if (!value.limits || typeof value.limits !== 'object' || Array.isArray(value.limits)) throw new Error('LLM runtime limits must be an object');
    const limits = value.limits as Record<string, unknown>;
    let pricing: LlmRuntimeConfig['pricing'];
    if (value.pricing !== undefined) {
        if (!value.pricing || typeof value.pricing !== 'object' || Array.isArray(value.pricing)) {
            throw new Error('LLM runtime pricing must be an object');
        }
        const rawPricing = value.pricing as Record<string, unknown>;
        pricing = {
            inputMicrosPerMillionTokens: integer(rawPricing.inputMicrosPerMillionTokens,
                'inputMicrosPerMillionTokens', 0, 1_000_000_000),
            outputMicrosPerMillionTokens: integer(rawPricing.outputMicrosPerMillionTokens,
                'outputMicrosPerMillionTokens', 0, 1_000_000_000)
        };
    }
    if (value.provider === 'openai' && !pricing) throw new Error('OpenAI provider requires explicit pricing limits');
    if (value.skillBuilder !== undefined && (!value.skillBuilder || typeof value.skillBuilder !== 'object'
        || Array.isArray(value.skillBuilder))) throw new Error('LLM skillBuilder must be an object');
    const rawBuilder = (value.skillBuilder ?? {}) as Record<string, unknown>;
    const builderEnabled = rawBuilder.enabled === undefined ? false : rawBuilder.enabled;
    if (typeof builderEnabled !== 'boolean') throw new Error('LLM skillBuilder.enabled must be boolean');
    const builderPrompt = rawBuilder.prompt === undefined ? DEFAULT_SKILL_BUILDER_PROMPT : rawBuilder.prompt;
    if (typeof builderPrompt !== 'string' || !builderPrompt.trim() || builderPrompt.length > 8000) {
        throw new Error('LLM skillBuilder.prompt must contain 1 to 8000 characters');
    }
    const builder = {
        enabled: builderEnabled,
        prompt: builderPrompt.trim(),
        intervalMs: integer(rawBuilder.intervalMs ?? 60_000, 'skillBuilder.intervalMs', 10_000, 24 * 60 * 60_000),
        cooldownMs: integer(rawBuilder.cooldownMs ?? 60 * 60_000, 'skillBuilder.cooldownMs', 0, 7 * 24 * 60 * 60_000),
        maxAttemptsPerGap: integer(rawBuilder.maxAttemptsPerGap ?? 3, 'skillBuilder.maxAttemptsPerGap', 1, 100),
        maxCostMicrosPerGap: integer(rawBuilder.maxCostMicrosPerGap ?? 50_000,
            'skillBuilder.maxCostMicrosPerGap', 0, 100_000_000),
        maxDailyCostMicros: integer(rawBuilder.maxDailyCostMicros ?? 100_000,
            'skillBuilder.maxDailyCostMicros', 0, 100_000_000),
        maxDurationMs: integer(rawBuilder.maxDurationMs ?? 60_000, 'skillBuilder.maxDurationMs', 100, 300_000),
        maxOutputTokens: integer(rawBuilder.maxOutputTokens ?? 6000, 'skillBuilder.maxOutputTokens', 100, 100_000)
    };
    if (builder.enabled && (value.provider !== 'openai' || !value.enabled || builder.maxCostMicrosPerGap === 0
        || builder.maxDailyCostMicros === 0)) {
        throw new Error('Enabled Skill Builder requires an enabled OpenAI provider and positive cost budgets');
    }
    return {
        schemaVersion: LLM_RUNTIME_SCHEMA_VERSION,
        enabled: value.enabled,
        automaticReplanning: value.automaticReplanning ?? false,
        provider: value.provider,
        model: value.model.trim(),
        plannerPrompt: plannerPrompt.trim(),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(pricing ? { pricing } : {}),
        skillBuilder: builder,
        limits: {
            maxDurationMs: integer(limits.maxDurationMs, 'maxDurationMs', 100, 300_000),
            maxModelRequests: integer(limits.maxModelRequests, 'maxModelRequests', 1, 20),
            maxToolCalls: integer(limits.maxToolCalls, 'maxToolCalls', 0, 20),
            maxCostMicros: integer(limits.maxCostMicros, 'maxCostMicros', 0, 100_000_000),
            maxOutputTokens: limits.maxOutputTokens === undefined ? 2000
                : integer(limits.maxOutputTokens, 'maxOutputTokens', 100, 100_000)
        }
    };
}
