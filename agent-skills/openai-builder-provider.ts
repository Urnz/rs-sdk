import type { LlmReasoningEffort, LlmRuntimeConfig } from '../llm-runtime/types.js';
import type { OpenAIFetch } from '../llm-runtime/openai-provider.js';
import { SKILL_BUILDER_OPERATIONS, type SkillBuilderProvider, type SkillBuilderProviderResponse,
    type SkillBuilderRequest } from './builder.js';

const BUILDER_SAFETY_INSTRUCTION = `You are a bounded Skill Builder service, not a player and not a general coding agent.
Return exactly one declarative skill proposal matching the response schema. You have no tools.
Use only allowedOperations from the input. Every retry and repeat must be bounded.
The parametersJson, preconditionsJson and stepsJson fields must each contain valid JSON for the agent-skill schema.
Never include executable code, scripts, shell commands, file operations, network operations, credentials, provenance, status, sharing or arbitrary tools.`;

const PROPOSAL_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        id: { type: 'string', pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$', maxLength: 64 },
        version: { type: 'string', pattern: '^0\\.[0-9]+\\.[0-9]+$' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string', minLength: 1, maxLength: 1000 },
        tags: { type: 'array', maxItems: 20, items: {
            type: 'string', pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$'
        } },
        parametersJson: { type: 'string', minLength: 2, maxLength: 20_000 },
        limits: { type: 'object', additionalProperties: false,
            properties: {
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 900_000 },
                maxOperations: { type: 'integer', minimum: 1, maximum: 1000 }
            }, required: ['timeoutMs', 'maxOperations'] },
        preconditionsJson: { type: 'string', minLength: 2, maxLength: 20_000 },
        stepsJson: { type: 'string', minLength: 2, maxLength: 60_000 }
    },
    required: ['id', 'version', 'name', 'description', 'tags', 'parametersJson', 'limits',
        'preconditionsJson', 'stepsJson']
} as const;

export interface OpenAISkillBuilderProviderOptions {
    apiKey: string;
    model: string;
    prompt: string;
    pricing: NonNullable<LlmRuntimeConfig['pricing']>;
    maxOutputTokens: number;
    reasoningEffort?: LlmReasoningEffort;
    fetch?: OpenAIFetch;
    endpoint?: string;
}

function outputText(value: Record<string, unknown>): string {
    if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text;
    if (!Array.isArray(value.output)) throw new Error('OpenAI Skill Builder response has no output');
    for (const item of value.output) {
        if (!item || typeof item !== 'object' || !Array.isArray((item as Record<string, unknown>).content)) continue;
        for (const content of (item as { content: unknown[] }).content) {
            if (content && typeof content === 'object' && (content as Record<string, unknown>).type === 'output_text'
                && typeof (content as Record<string, unknown>).text === 'string') {
                return String((content as Record<string, unknown>).text);
            }
        }
    }
    throw new Error('OpenAI Skill Builder response contains no output text');
}

function integer(value: unknown): number {
    return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function parseJson(value: unknown, name: string): unknown {
    if (typeof value !== 'string') throw new Error(`OpenAI Skill Builder ${name} is not a JSON string`);
    try { return JSON.parse(value) as unknown; }
    catch { throw new Error(`OpenAI Skill Builder ${name} is invalid JSON`); }
}

export class OpenAISkillBuilderProvider implements SkillBuilderProvider {
    readonly id = 'openai';
    readonly requests: SkillBuilderRequest[] = [];
    readonly bodies: Record<string, unknown>[] = [];
    private readonly apiKey: string;
    private readonly fetch: OpenAIFetch;
    private readonly endpoint: string;

    constructor(private readonly options: OpenAISkillBuilderProviderOptions) {
        this.apiKey = options.apiKey.trim();
        if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured');
        if (!options.model.trim()) throw new Error('OpenAI Skill Builder model is not configured');
        this.fetch = options.fetch ?? globalThis.fetch;
        this.endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';
    }

    async build(request: SkillBuilderRequest, signal: AbortSignal): Promise<SkillBuilderProviderResponse> {
        this.requests.push(structuredClone(request));
        const body = {
            model: this.options.model,
            store: false,
            instructions: `${BUILDER_SAFETY_INSTRUCTION}\n\nSimulation-specific design guidance:\n${this.options.prompt}`,
            input: JSON.stringify({ ...request, allowedOperations: request.allowedOperations.filter(operation =>
                SKILL_BUILDER_OPERATIONS.includes(operation)) }),
            text: { format: { type: 'json_schema', name: 'agent_skill_draft', strict: true,
                schema: PROPOSAL_SCHEMA } },
            max_output_tokens: this.options.maxOutputTokens,
            ...(this.options.reasoningEffort ? { reasoning: { effort: this.options.reasoningEffort } } : {})
        };
        this.bodies.push(structuredClone(body));
        const response = await this.fetch(this.endpoint, { method: 'POST', signal,
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body) });
        const rawText = await response.text();
        let raw: Record<string, unknown>;
        try { raw = JSON.parse(rawText) as Record<string, unknown>; }
        catch { throw new Error(`OpenAI Skill Builder returned invalid JSON (HTTP ${response.status})`); }
        if (!response.ok) {
            const error = raw.error && typeof raw.error === 'object' ? raw.error as Record<string, unknown> : null;
            const code = typeof error?.code === 'string' ? ` ${error.code}` : '';
            throw new Error(`OpenAI Skill Builder request failed (HTTP ${response.status}${code})`);
        }
        if (raw.status !== undefined && raw.status !== 'completed') {
            throw new Error(`OpenAI Skill Builder response did not complete (status ${String(raw.status)})`);
        }
        let output: Record<string, unknown>;
        try { output = JSON.parse(outputText(raw)) as Record<string, unknown>; }
        catch (error) {
            if (error instanceof SyntaxError) throw new Error('OpenAI Skill Builder structured output was not valid JSON');
            throw error;
        }
        const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage as Record<string, unknown> : {};
        const inputTokens = integer(usage.input_tokens);
        const outputTokens = integer(usage.output_tokens);
        const costMicros = Math.ceil((inputTokens * this.options.pricing.inputMicrosPerMillionTokens
            + outputTokens * this.options.pricing.outputMicrosPerMillionTokens) / 1_000_000);
        return { proposal: { id: output.id, version: output.version, name: output.name,
            description: output.description, tags: output.tags,
            parameters: parseJson(output.parametersJson, 'parametersJson'), limits: output.limits,
            preconditions: parseJson(output.preconditionsJson, 'preconditionsJson'),
            steps: parseJson(output.stepsJson, 'stepsJson') }, usage: { costMicros },
        providerRequestId: typeof raw.id === 'string' ? raw.id : undefined };
    }
}
