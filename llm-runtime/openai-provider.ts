import type { LlmProvider, LlmProviderRequest, LlmProviderResponse, LlmRuntimeConfig } from './types.js';

export type OpenAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAIResponsesProviderOptions {
    apiKey: string;
    pricing: NonNullable<LlmRuntimeConfig['pricing']>;
    fetch?: OpenAIFetch;
    endpoint?: string;
}

const PLAN_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        decision: { type: 'string', enum: ['select_skill', 'propose_goal_plan', 'abstain'] },
        goalId: { type: 'string', minLength: 1, maxLength: 200 },
        goals: { type: 'array', maxItems: 3, items: {
            type: 'object', additionalProperties: false,
            properties: {
                goalId: { type: 'string', minLength: 1, maxLength: 64 },
                parentGoalId: { type: 'string', minLength: 1, maxLength: 64 },
                horizon: { type: 'string', enum: ['long-term', 'current', 'immediate'] },
                title: { type: 'string', minLength: 1, maxLength: 200 },
                description: { type: 'string', maxLength: 2000 },
                priority: { type: 'integer', minimum: 0, maximum: 100 }
            },
            required: ['goalId', 'parentGoalId', 'horizon', 'title', 'description', 'priority']
        } },
        tool: { anyOf: [{ type: 'null' }, {
            type: 'object', additionalProperties: false,
            properties: {
                name: { type: 'string', enum: ['execute_skill'] },
                arguments: { type: 'object', additionalProperties: false,
                    properties: { skillId: { type: 'string' }, version: { type: 'string' } },
                    required: ['skillId', 'version'] }
            },
            required: ['name', 'arguments']
        }] },
        reason: { type: 'string', minLength: 1, maxLength: 1000 }
    },
    required: ['decision', 'goalId', 'goals', 'tool', 'reason']
} as const;

function outputText(value: Record<string, unknown>): string {
    if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text;
    if (!Array.isArray(value.output)) throw new Error('OpenAI response has no output');
    for (const item of value.output) {
        if (!item || typeof item !== 'object' || !Array.isArray((item as Record<string, unknown>).content)) continue;
        for (const content of (item as { content: unknown[] }).content) {
            if (content && typeof content === 'object' && (content as Record<string, unknown>).type === 'output_text'
                && typeof (content as Record<string, unknown>).text === 'string') {
                return String((content as Record<string, unknown>).text);
            }
        }
    }
    throw new Error('OpenAI response contains no output text');
}

function integer(value: unknown): number {
    return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0;
}

export class OpenAIResponsesProvider implements LlmProvider {
    readonly id = 'openai';
    readonly requests: LlmProviderRequest[] = [];
    private readonly apiKey: string;
    private readonly pricing: NonNullable<LlmRuntimeConfig['pricing']>;
    private readonly fetch: OpenAIFetch;
    private readonly endpoint: string;

    constructor(options: OpenAIResponsesProviderOptions) {
        this.apiKey = options.apiKey.trim();
        if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured');
        this.pricing = options.pricing;
        this.fetch = options.fetch ?? globalThis.fetch;
        this.endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';
    }

    async complete(request: LlmProviderRequest, signal: AbortSignal): Promise<LlmProviderResponse> {
        this.requests.push(structuredClone(request));
        const response = await this.fetch(this.endpoint, {
            method: 'POST', signal,
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                store: false,
                instructions: request.instruction,
                input: JSON.stringify({ agentId: request.agentId, mode: request.mode, goal: request.goal,
                    goalHierarchy: request.goalHierarchy, trustedContext: request.trustedContext,
                    untrustedText: request.untrustedText, allowedSkills: request.tools[0].allowedSkills }),
                text: { format: { type: 'json_schema', name: 'agent_plan', strict: true, schema: PLAN_SCHEMA } },
                max_output_tokens: 2_000
            })
        });
        const rawText = await response.text();
        let raw: Record<string, unknown>;
        try { raw = JSON.parse(rawText) as Record<string, unknown>; }
        catch { throw new Error(`OpenAI returned invalid JSON (HTTP ${response.status})`); }
        if (!response.ok) {
            const error = raw.error && typeof raw.error === 'object' ? raw.error as Record<string, unknown> : null;
            const code = typeof error?.code === 'string' ? ` ${error.code}` : '';
            throw new Error(`OpenAI request failed (HTTP ${response.status}${code})`);
        }
        if (raw.status !== undefined && raw.status !== 'completed') {
            throw new Error(`OpenAI response did not complete (status ${String(raw.status)})`);
        }
        let output: unknown;
        try { output = JSON.parse(outputText(raw)) as unknown; }
        catch (error) {
            if (error instanceof SyntaxError) throw new Error('OpenAI structured output was not valid JSON');
            throw error;
        }
        const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage as Record<string, unknown> : {};
        const inputTokens = integer(usage.input_tokens);
        const outputTokens = integer(usage.output_tokens);
        const costMicros = Math.ceil((inputTokens * this.pricing.inputMicrosPerMillionTokens
            + outputTokens * this.pricing.outputMicrosPerMillionTokens) / 1_000_000);
        return { output, usage: { inputTokens, outputTokens, costMicros },
            providerRequestId: typeof raw.id === 'string' ? raw.id : undefined };
    }
}

export function createOpenAIProvider(config: LlmRuntimeConfig,
    environment: Record<string, string | undefined> = process.env): OpenAIResponsesProvider {
    if (config.provider !== 'openai' || !config.pricing) throw new Error('OpenAI provider configuration is incomplete');
    return new OpenAIResponsesProvider({ apiKey: environment.OPENAI_API_KEY ?? '', pricing: config.pricing });
}
