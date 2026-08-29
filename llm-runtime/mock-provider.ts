import type { LlmProvider, LlmProviderRequest, LlmProviderResponse } from './types.js';

export type MockReply = LlmProviderResponse | Error | ((request: LlmProviderRequest) => LlmProviderResponse | Promise<LlmProviderResponse>);

export class ScriptedMockProvider implements LlmProvider {
    readonly id = 'mock';
    readonly requests: LlmProviderRequest[] = [];

    constructor(private readonly replies: MockReply[]) {}

    async complete(request: LlmProviderRequest, signal: AbortSignal): Promise<LlmProviderResponse> {
        if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
        this.requests.push(structuredClone(request));
        const reply = this.replies.shift();
        if (!reply) throw new Error('Mock provider has no scripted reply');
        if (reply instanceof Error) throw reply;
        return typeof reply === 'function' ? await reply(request) : structuredClone(reply);
    }
}
