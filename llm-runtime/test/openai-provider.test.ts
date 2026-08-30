import { describe, expect, test } from 'bun:test';
import { OpenAIResponsesProvider, createOpenAIProvider, type OpenAIFetch } from '../openai-provider.js';
import type { LlmProviderRequest } from '../types.js';

const request: LlmProviderRequest = {
    runId: '11111111-1111-4111-8111-111111111111', agentId: 'ferrye14', model: 'gpt-5.6-terra',
    mode: 'derive-immediate-goal', goal: { goalId: 'wealth', title: 'Become wealthy', description: '' },
    goalHierarchy: [{ goalId: 'wealth', parentGoalId: null, horizon: 'life', title: 'Become wealthy',
        description: '', priority: 90 }], trustedContext: 'Trusted state', untrustedText: ['Player chat'],
    tools: [{ name: 'execute_skill', description: 'Execute one reviewed skill.', allowedSkills: [
        { id: 'mining', version: '1.0.0', name: 'Mining', description: 'Mine ore.' }
    ] }], instruction: 'Return a bounded plan.', maxOutputTokens: 1500, reasoningEffort: 'medium'
};

function provider(fetch: OpenAIFetch) {
    return new OpenAIResponsesProvider({ apiKey: 'test-secret',
        pricing: { inputMicrosPerMillionTokens: 2_000_000, outputMicrosPerMillionTokens: 12_000_000 }, fetch });
}

describe('OpenAI Responses provider', () => {
    test('sends a non-stored structured request and converts usage into the configured cost', async () => {
        let sent: RequestInit | undefined;
        const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
            sent = init;
            return new Response(JSON.stringify({ id: 'resp_123', status: 'completed', usage: {
                input_tokens: 1000, output_tokens: 100 }, output: [{ type: 'message', content: [{ type: 'output_text',
                text: JSON.stringify({ decision: 'abstain', goalId: 'wealth', goals: [], tool: null,
                    reason: 'Wait for more evidence.' }) }] }] }), { status: 200 });
        };
        const result = await provider(fetch).complete(request, new AbortController().signal);
        const body = JSON.parse(String(sent?.body));
        expect(sent?.headers).toEqual({ Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' });
        expect(body.store).toBeFalse();
        expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
        expect(body.max_output_tokens).toBe(1500);
        expect(body.reasoning).toEqual({ effort: 'medium' });
        expect(body.input).toContain('Trusted state');
        expect(result.output).toMatchObject({ decision: 'abstain', goalId: 'wealth' });
        expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 100, costMicros: 3200 });
        expect(result.providerRequestId).toBe('resp_123');
    });

    test('does not expose the API key in a sanitized HTTP error', async () => {
        const fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key',
            message: 'The key test-secret is invalid.' } }), { status: 401 });
        await expect(provider(fetch).complete(request, new AbortController().signal))
            .rejects.toThrow('OpenAI request failed (HTTP 401 invalid_api_key)');
        try { await provider(fetch).complete(request, new AbortController().signal); }
        catch (error) { expect(String(error)).not.toContain('test-secret'); }
    });

    test('requires an environment key and explicit pricing', () => {
        expect(() => createOpenAIProvider({ schemaVersion: 1, enabled: true, automaticReplanning: false,
            provider: 'openai', model: 'test',
            plannerPrompt: 'Plan for a RuneScape agent.',
            pricing: { inputMicrosPerMillionTokens: 1, outputMicrosPerMillionTokens: 1 },
            skillBuilder: { enabled: false, prompt: 'Build bounded skills.', intervalMs: 60000,
                cooldownMs: 3600000, maxAttemptsPerGap: 3, maxCostMicrosPerGap: 50000,
                maxDailyCostMicros: 100000, maxDurationMs: 60000, maxOutputTokens: 6000 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1,
                maxCostMicros: 100, maxOutputTokens: 1000 } }, {}))
            .toThrow('OPENAI_API_KEY');
    });
});
