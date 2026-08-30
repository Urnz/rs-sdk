import { describe, expect, test } from 'bun:test';
import { OpenAISkillBuilderProvider } from '../openai-builder-provider.js';

const request = {
    gap: { gapId: 'gap-123', title: 'Mine copper', description: 'Mine and bank copper.', tags: ['mining'],
        worldVersion: 'local', skillSchemaVersion: 1 },
    allowedOperations: ['walk-to', 'gather-loc', 'open-bank', 'deposit-item'] as const,
    existingSkills: []
};

describe('OpenAI Skill Builder provider', () => {
    test('uses strict structured output without exposing any tools', async () => {
        let body: Record<string, any> = {};
        const provider = new OpenAISkillBuilderProvider({ apiKey: 'test-secret-key', model: 'gpt-test',
            prompt: 'Prefer reusable parameters.', maxOutputTokens: 4000,
            reasoningEffort: 'medium', pricing: {
                inputMicrosPerMillionTokens: 2_000_000, outputMicrosPerMillionTokens: 12_000_000
            }, fetch: async (_input, init) => {
                body = JSON.parse(String(init?.body));
                return new Response(JSON.stringify({ id: 'resp_builder', status: 'completed',
                    usage: { input_tokens: 100, output_tokens: 50 }, output_text: JSON.stringify({
                        id: 'mining.varrock.copper', version: '0.1.0', name: 'Mine copper',
                        description: 'Mine and bank copper ore.', tags: ['mining', 'banking'],
                        parametersJson: '{}', limits: { timeoutMs: 120000, maxOperations: 20 },
                        preconditionsJson: '[]', stepsJson: JSON.stringify([{ kind: 'operation', id: 'walk',
                            operation: 'walk-to', arguments: { x: 3285, z: 3367 } }])
                    }) }), { status: 200 });
            } });

        const result = await provider.build(request, new AbortController().signal);

        expect(body).toMatchObject({ model: 'gpt-test', store: false, max_output_tokens: 4000,
            reasoning: { effort: 'medium' }, text: { format: {
                type: 'json_schema', name: 'agent_skill_draft', strict: true
            } } });
        expect(body.tools).toBeUndefined();
        expect(body.instructions).toContain('You have no tools');
        expect(body.input).toContain('gather-loc');
        expect(result).toMatchObject({ providerRequestId: 'resp_builder', usage: { costMicros: 800 },
            proposal: { id: 'mining.varrock.copper', parameters: {}, preconditions: [],
                steps: [{ operation: 'walk-to' }] } });
    });

    test('sanitizes HTTP errors without returning the API response message', async () => {
        const provider = new OpenAISkillBuilderProvider({ apiKey: 'test-secret-key', model: 'gpt-test',
            prompt: 'Build.', maxOutputTokens: 1000, pricing: {
                inputMicrosPerMillionTokens: 1, outputMicrosPerMillionTokens: 1
            }, fetch: async () => new Response(JSON.stringify({ error: {
                code: 'invalid_api_key', message: 'test-secret-key is invalid'
            } }), { status: 401 }) });
        await expect(provider.build(request, new AbortController().signal))
            .rejects.toThrow('OpenAI Skill Builder request failed (HTTP 401 invalid_api_key)');
    });
});
