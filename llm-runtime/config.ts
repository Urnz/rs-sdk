import { DEFAULT_LLM_PLANNER_PROMPT, LLM_RUNTIME_SCHEMA_VERSION, type LlmReasoningEffort,
    type AutonomousParameterLimit, type AutonomousScalar, type LlmRuntimeConfig } from './types.js';
import type { SkillOperationName } from '../agent-skills/types.js';

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

const ROUTINE_OPERATIONS: SkillOperationName[] = ['walk-to', 'wait-for-area', 'talk-to-npc', 'navigate-dialog',
    'interact-loc', 'interact-npc', 'gather-loc', 'gather-npc', 'smith-at-anvil', 'open-shop', 'sell-to-shop',
    'close-shop', 'open-bank', 'deposit-item', 'withdraw-item', 'close-bank', 'wait-ticks'];
const OPERATIONS = new Set<SkillOperationName>([
    ...ROUTINE_OPERATIONS, 'buy-from-shop', 'trade-give-item', 'trade-receive-item'
]);

function scalar(value: unknown): value is AutonomousScalar {
    return typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value));
}

function shortStringList(value: unknown, field: string, maximum: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string'
        || !item.trim() || item.length > 100)) throw new Error(`${field} must be a bounded string array`);
    return [...new Set(value.map(item => item.trim().toLowerCase()))].sort();
}

function parameterLimits(value: unknown, field: string): Record<string, AutonomousParameterLimit> {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20) {
        throw new Error(`${field} must be a bounded object`);
    }
    const output: Record<string, AutonomousParameterLimit> = {};
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`${field}.${name} is invalid`);
        }
        const limit = raw as Record<string, unknown>;
        if (Object.keys(limit).some(key => !['exact', 'oneOf', 'minimum', 'maximum'].includes(key))) {
            throw new Error(`${field}.${name} has unknown fields`);
        }
        if (limit.exact !== undefined && !scalar(limit.exact)) throw new Error(`${field}.${name}.exact is invalid`);
        if (limit.oneOf !== undefined && (!Array.isArray(limit.oneOf) || limit.oneOf.length < 1
            || limit.oneOf.length > 20 || !limit.oneOf.every(scalar))) throw new Error(`${field}.${name}.oneOf is invalid`);
        if (limit.minimum !== undefined && (typeof limit.minimum !== 'number' || !Number.isFinite(limit.minimum))) {
            throw new Error(`${field}.${name}.minimum is invalid`);
        }
        if (limit.maximum !== undefined && (typeof limit.maximum !== 'number' || !Number.isFinite(limit.maximum))) {
            throw new Error(`${field}.${name}.maximum is invalid`);
        }
        if (limit.minimum !== undefined && limit.maximum !== undefined && limit.minimum > limit.maximum) {
            throw new Error(`${field}.${name} range is inverted`);
        }
        output[name] = { ...(limit.exact !== undefined ? { exact: limit.exact as AutonomousScalar } : {}),
            ...(limit.oneOf !== undefined ? { oneOf: [...limit.oneOf] as AutonomousScalar[] } : {}),
            ...(limit.minimum !== undefined ? { minimum: limit.minimum } : {}),
            ...(limit.maximum !== undefined ? { maximum: limit.maximum } : {}) };
    }
    return output;
}

function autonomousSkills(value: unknown): LlmRuntimeConfig['autonomousExecution']['allowedSkills'] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) throw new Error('autonomousExecution.allowedSkills must be an array of at most 100 skills');
    const seen = new Set<string>();
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid autonomous skill at index ${index}`);
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(item.id)
            || typeof item.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(item.version)) {
            throw new Error(`Invalid autonomous skill at index ${index}`);
        }
        const key = `${item.id}@${item.version}`;
        if (seen.has(key)) throw new Error(`Duplicate autonomous skill: ${key}`);
        seen.add(key);
        const risk = item.risk ?? 'routine';
        if (!['routine', 'shop-buy', 'player-trade'].includes(String(risk))) {
            throw new Error(`Invalid autonomous skill risk at index ${index}`);
        }
        const operations = item.operations === undefined ? [...ROUTINE_OPERATIONS]
            : shortStringList(item.operations, `allowedSkills[${index}].operations`, OPERATIONS.size);
        if (operations.some(operation => !OPERATIONS.has(operation as SkillOperationName))) {
            throw new Error(`Invalid autonomous operation at index ${index}`);
        }
        const maxQuantity = integer(item.maxQuantity ?? 28, `allowedSkills[${index}].maxQuantity`, 1, 10_000);
        const maxUnitPriceGp = integer(item.maxUnitPriceGp ?? 0, `allowedSkills[${index}].maxUnitPriceGp`, 0, 2_147_483_647);
        const maxGpPerRun = integer(item.maxGpPerRun ?? 0, `allowedSkills[${index}].maxGpPerRun`, 0, 2_147_483_647);
        const maxGpPerDay = integer(item.maxGpPerDay ?? 0, `allowedSkills[${index}].maxGpPerDay`, 0, 2_147_483_647);
        const itemNames = shortStringList(item.itemNames, `allowedSkills[${index}].itemNames`, 100);
        const partners = shortStringList(item.partners, `allowedSkills[${index}].partners`, 100);
        if (risk === 'routine' && operations.some(operation => operation === 'buy-from-shop'
            || operation === 'trade-give-item' || operation === 'trade-receive-item')) {
            throw new Error('Routine authorization cannot include buy or player trade');
        }
        if (risk === 'shop-buy' && (!operations.includes('buy-from-shop') || maxUnitPriceGp < 1
            || maxGpPerRun < 1 || maxGpPerDay < maxGpPerRun || itemNames.length < 1)) {
            throw new Error('Shop-buy authorization requires an item plus positive unit, run and daily GP limits');
        }
        if (risk === 'player-trade' && (!operations.some(operation => operation === 'trade-give-item'
            || operation === 'trade-receive-item') || partners.length < 1
            || itemNames.length < 1 || maxGpPerRun !== 0 || maxGpPerDay !== 0)) {
            throw new Error('Player-trade authorization requires exact partners and items without GP authority');
        }
        return { id: item.id, version: item.version, risk: risk as 'routine' | 'shop-buy' | 'player-trade',
            operations: operations as SkillOperationName[], parameters: parameterLimits(item.parameters,
                `allowedSkills[${index}].parameters`), itemNames, partners, maxQuantity,
            maxUnitPriceGp, maxGpPerRun, maxGpPerDay };
    });
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
    const runtimeLimits = {
        maxDurationMs: integer(limits.maxDurationMs, 'maxDurationMs', 100, 300_000),
        maxModelRequests: integer(limits.maxModelRequests, 'maxModelRequests', 1, 20),
        maxToolCalls: integer(limits.maxToolCalls, 'maxToolCalls', 0, 20),
        maxCostMicros: integer(limits.maxCostMicros, 'maxCostMicros', 0, 100_000_000),
        maxOutputTokens: limits.maxOutputTokens === undefined ? 2000
            : integer(limits.maxOutputTokens, 'maxOutputTokens', 100, 100_000)
    };
    if (value.dailyBudget !== undefined && (!value.dailyBudget || typeof value.dailyBudget !== 'object'
        || Array.isArray(value.dailyBudget))) throw new Error('LLM runtime dailyBudget must be an object');
    const rawDailyBudget = (value.dailyBudget ?? {}) as Record<string, unknown>;
    const scope = rawDailyBudget.scope ?? 'lostcity-local';
    if (typeof scope !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,99}$/.test(scope)) {
        throw new Error('dailyBudget.scope must be a short lowercase identifier');
    }
    const dailyBudget = {
        scope,
        maxCostMicros: integer(rawDailyBudget.maxCostMicros
            ?? Math.min(2_000_000_000, runtimeLimits.maxCostMicros * 100),
        'dailyBudget.maxCostMicros', 0, 2_000_000_000),
        maxDecisions: integer(rawDailyBudget.maxDecisions ?? 1000, 'dailyBudget.maxDecisions', 1, 100_000),
        estimatedCostMicros: integer(rawDailyBudget.estimatedCostMicros ?? runtimeLimits.maxCostMicros,
            'dailyBudget.estimatedCostMicros', 0, 100_000_000)
    };
    if (dailyBudget.estimatedCostMicros > dailyBudget.maxCostMicros) {
        throw new Error('dailyBudget estimated cost exceeds the daily cost limit');
    }
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
    if (value.autonomousExecution !== undefined && (!value.autonomousExecution
        || typeof value.autonomousExecution !== 'object' || Array.isArray(value.autonomousExecution))) {
        throw new Error('LLM autonomousExecution must be an object');
    }
    const rawAutonomy = (value.autonomousExecution ?? {}) as Record<string, unknown>;
    const autonomyEnabled = rawAutonomy.enabled ?? false;
    if (typeof autonomyEnabled !== 'boolean') throw new Error('autonomousExecution.enabled must be boolean');
    const autonomy = {
        enabled: autonomyEnabled,
        allowedSkills: autonomousSkills(rawAutonomy.allowedSkills),
        maxOperations: integer(rawAutonomy.maxOperations ?? 100, 'autonomousExecution.maxOperations', 1, 1000),
        maxTimeoutMs: integer(rawAutonomy.maxTimeoutMs ?? 900_000,
            'autonomousExecution.maxTimeoutMs', 1_000, 3_600_000)
    };
    if (autonomy.enabled && !value.automaticReplanning) {
        throw new Error('Autonomous execution requires automaticReplanning');
    }
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
        autonomousExecution: autonomy,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(pricing ? { pricing } : {}),
        skillBuilder: builder,
        dailyBudget,
        limits: runtimeLimits
    };
}
