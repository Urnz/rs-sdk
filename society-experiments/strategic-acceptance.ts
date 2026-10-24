import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LlmOrchestrator } from '../llm-runtime/orchestrator.js';
import { LlmDailyBudgetStore } from '../llm-runtime/budget.js';
import { InferenceQueue } from '../llm-runtime/queue.js';
import { validateLlmRuntimeConfig } from '../llm-runtime/config.js';
import { OpenAIResponsesProvider, calculateOpenAIUsage } from '../llm-runtime/openai-provider.js';
import { ScriptedMockProvider, type MockReply } from '../llm-runtime/mock-provider.js';
import type { LlmAuditEvent, LlmPlanResult, LlmPlanningInput, LlmProvider, LlmProviderRequest } from '../llm-runtime/types.js';

// The Windows control-plane module belongs to the root TS project, not engine
// NodeNext. Resolve this runtime-only boundary without pulling its CJS metadata
// into the engine's native fixture compilation.
async function secrets(workspace: string) {
    const module = '../server/control-plane/secret-store.js';
    const { ServerSecretStore } = await import(module);
    return new ServerSecretStore(workspace);
}

export const STRATEGIC_SCENARIOS = ['control', 'income-loss', 'raw-scarcity', 'cooperation'] as const;
export type StrategicScenario = typeof STRATEGIC_SCENARIOS[number];
export const strategicDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const STRATEGIC_LIMITS = { maxCalls: 8, maxCostMicros: 50000, maxInputBytes: 8192,
    maxOutputTokens: 2000, requestMs: 30000, totalMs: 180000, maxGp: 10 } as const;
export const STRATEGIC_PROMPT = 'Choose a useful bounded response to your own observed economic situation. Compare the listed alternatives, costs, inputs and obligations. Keep food and cash for future needs. An ended income source cannot be continued. Missing raw input calls for acquisition or another feasible activity. Consider voluntary work with known partners. You may abstain. Never invent authority, resources or consent.';
export interface StrategicManifest {
    protocol: 'si-b06.v1' | 'si-b06.v2'; runId: string; provider: 'scripted' | 'openai'; model: string;
    credentialWorkspace: string; sourceDigest: string; baselineDigest: string;
    startedAt: string; scenarios: readonly StrategicScenario[];
}
export interface StrategicTrace {
    scenario: StrategicScenario; baselineDigest: string; eventId: string;
    eventSource: string; observedSource: string; agentId: string;
    plan: LlmPlanResult | null; alternativeIds: string[]; selectedStrategy: string | null;
    adoptedRunId: string | null; nativeRunId: string | null; nativeVerified: boolean;
    outcome: { rawDelta: number; gpDelta: number; proposalId: string | null; partnerAccepted: boolean };
    reason: string;
    executionPlan?: LlmPlanResult; selectedContractId?: string | null;
    contractId?: string; consentPlan?: LlmPlanResult;
    contractParties?: string[];
    perceivedChange?: boolean;
}

function trialConfig(manifest: StrategicManifest) {
    return validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true,
        provider: manifest.provider === 'openai' ? 'openai' : 'mock', model: manifest.model,
        plannerPrompt: STRATEGIC_PROMPT, reasoningEffort: 'medium',
        pricing: { inputMicrosPerMillionTokens: 100000, outputMicrosPerMillionTokens: 500000 },
        dailyBudget: { scope: manifest.provider === 'openai' ? 'lostcity-local' : 'si-b06-scripted',
            maxCostMicros: STRATEGIC_LIMITS.maxCostMicros, maxDecisions: 1000, estimatedCostMicros: 5000 },
        limits: { maxDurationMs: STRATEGIC_LIMITS.requestMs, maxModelRequests: 1, maxToolCalls: 1,
            maxCostMicros: STRATEGIC_LIMITS.maxCostMicros, maxOutputTokens: STRATEGIC_LIMITS.maxOutputTokens } });
}

/** Grades a locally collected trace. Native verification is performed by the native runner,
 * not accepted from an HTTP/model upload. Hashes bind artifacts; they are not source authority. */
export function reportStrategicAcceptance(manifest: StrategicManifest, traces: readonly StrategicTrace[],
    providerReady: boolean, usage: { calls: number; reservedMicros: number; durationMs: number; actualCostMicros?: number; uncertainCalls?: number }) {
    const control = traces.find(t => t.scenario === 'control');
    const scenarios = STRATEGIC_SCENARIOS.map(scenario => {
        const matching = traces.filter(t => t.scenario === scenario), t = matching[0];
        const problems: string[] = [];
        if (matching.length !== 1) problems.push('Exactly one retained trial per declared scenario is required');
        if (t) {
            if (t.baselineDigest !== manifest.baselineDigest) problems.push('Different baseline');
            if (!t.eventSource || t.observedSource !== t.eventSource || !t.perceivedChange) problems.push('Native event was not perceived from the same source');
            if (new Set(t.alternativeIds).size < 2) problems.push('No choice between at least two executable alternatives');
            const p = t.plan;
            if (p?.status !== 'proposed' || p.runId !== t.eventId || p.agentId !== t.agentId
                || p.decision?.kind !== 'choose-alternative' || !t.alternativeIds.includes(p.decision.optionId))
                problems.push('No valid bounded model choice');
            if (!t.adoptedRunId || t.adoptedRunId !== t.nativeRunId || !t.nativeVerified)
                problems.push('No adopted plan correlated to canonical native result');
            if (scenario === 'income-loss' && (!t.selectedStrategy || t.selectedStrategy === control?.selectedStrategy))
                problems.push('Routine continuation is not a strategy/work switch');
            if (scenario === 'income-loss' && t.outcome.rawDelta <= 0 && t.outcome.gpDelta <= 0)
                problems.push('Changed action has no livelihood result');
            if (scenario === 'raw-scarcity' && t.outcome.rawDelta <= 0)
                problems.push('No native acquisition or alternative input result');
            if (scenario === 'cooperation' && (!t.outcome.proposalId || !t.outcome.partnerAccepted || t.outcome.gpDelta <= 0))
                problems.push('No independent proposal, consent and native economic result');
            if (scenario === 'cooperation' && (t.executionPlan?.status !== 'proposed'
                || t.executionPlan.decision?.kind !== 'choose-alternative' || !t.contractId || t.selectedContractId !== t.contractId
                || t.consentPlan?.status !== 'proposed' || t.consentPlan.agentId === t.agentId
                || !t.contractParties?.includes(t.agentId) || !t.contractParties.includes(t.consentPlan?.agentId ?? '')
                || t.consentPlan.decision?.kind !== 'choose-alternative'))
                problems.push('Accepted work was not independently planned and adopted through B03/B05');
        }
        return { scenario, status: problems.length ? 'fail' : 'pass', problems };
    });
    const budgetOk = usage.calls <= STRATEGIC_LIMITS.maxCalls && usage.reservedMicros <= STRATEGIC_LIMITS.maxCostMicros
        && usage.durationMs <= STRATEGIC_LIMITS.totalMs && traces.every(t => Math.abs(t.outcome.gpDelta) <= STRATEGIC_LIMITS.maxGp);
    return { protocol: manifest.protocol, runId: manifest.runId,
        technical: budgetOk && scenarios.every(s => s.status === 'pass') ? 'pass' : 'fail',
        realLlm: manifest.provider !== 'openai' || !providerReady || !usage.calls ? 'not-tested'
            : budgetOk && scenarios.every(s => s.status === 'pass') ? 'pass' : 'fail',
        scenarios, budgetOk, usage,
        limitations: ['Disposable packed native microbenchmark; not SI-A15 economic survival or realism acceptance.',
            'A scripted technical PASS never establishes real model autonomy.'] };
}

/** One process owns one attempt. A fresh output directory prevents overwrite/cherry-pick;
 * requests are durably reserved before network, never retried or refunded on uncertainty. */
export class StrategicTrialPlanner {
    private calls = 0;
    private reservedMicros = 0;
    private actualCostMicros = 0;
    private latestProviderCost: number | null = null;
    private uncertainCalls = 0;
    private halted = false;
    private queue = new InferenceQueue({ maxRateLimitRetries: 0, maxBacklog: 1 });
    private started = performance.now();
    private provider: LlmProvider | null = null;
    private requested = new Set<string>();
    constructor(readonly directory: string, readonly manifest: StrategicManifest) {
        if (manifest.provider === 'openai' && (!/^[a-f0-9]{64}$/.test(manifest.sourceDigest) || manifest.model !== 'gpt-6-luna'))
            throw new Error('Real trial requires a pinned source and the declared Luna model');
        mkdirSync(directory, { recursive: false });
        const config = trialConfig(manifest);
        writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, limits: STRATEGIC_LIMITS,
            fixtureWallClock: manifest.provider === 'scripted' ? 'test-only advancement to existing cooldown deadlines' : 'real wall time',
            config, configDigest: strategicDigest(config),
            opportunities: { player: ['three funded native work sources paying 5/4/3 GP; the original 5 GP source is cancelled on income loss', 'native consume own cooked lobster'],
                cooperation: ['propose one native gather for 4 or 5 GP', 'independently accept or decline', 'plan accepted work through B03'] }
        }, null, 2), { flag: 'wx' });
        if (process.env.SI_B06_SOURCE_INFO) writeFileSync(join(directory, 'source.json'), process.env.SI_B06_SOURCE_INFO, { flag: 'wx' });
    }
    async ready(): Promise<boolean> {
        if (this.manifest.provider === 'scripted') return true;
        return (await secrets(this.manifest.credentialWorkspace)).status('openai-api-key');
    }
    usage() { return { calls: this.calls, reservedMicros: this.reservedMicros, actualCostMicros: this.actualCostMicros,
        uncertainCalls: this.uncertainCalls, durationMs: performance.now() - this.started }; }
    private audit(event: LlmAuditEvent) {
        appendFileSync(join(this.directory, 'audit.jsonl'), `${JSON.stringify(event)}\n`);
        console.info('[strategic-trial]', JSON.stringify({ runId: event.runId, type: event.type, elapsedMs: performance.now() - this.started }));
    }
    async plan(input: LlmPlanningInput, scripted: MockReply): Promise<LlmPlanResult> {
        if (this.requested.has(input.runId!)) throw new Error('A trial request cannot be repeated');
        if (this.halted) throw new Error('Trial stopped after an earlier provider failure; no further request');
        this.requested.add(input.runId!);
        if (!this.provider && this.manifest.provider === 'openai') {
            const key = await (await secrets(this.manifest.credentialWorkspace)).get('openai-api-key');
            if (!key) throw new Error('Provider not configured; real-LLM not-tested');
            this.provider = new OpenAIResponsesProvider({ apiKey: key,
                pricing: { inputMicrosPerMillionTokens: 100000, outputMicrosPerMillionTokens: 500000 },
                fetch: async (url, init) => {
                    const response = await globalThis.fetch(url, init);
                    const raw = await response.clone().json().catch(() => null) as Record<string, any> | null;
                    // Preserve incomplete outputs and usage too. Error messages can
                    // echo credentials, so retain only status/type/code on errors.
                    appendFileSync(join(this.directory, 'provider-responses.jsonl'), `${JSON.stringify({ status: response.status,
                        requestId: response.headers.get('x-request-id'), body: response.ok ? raw
                            : { error: { type: raw?.error?.type, code: raw?.error?.code } } })}\n`);
                    if (Number.isSafeInteger(raw?.usage?.input_tokens) && Number.isSafeInteger(raw?.usage?.output_tokens)) {
                        this.latestProviderCost = calculateOpenAIUsage(raw!.usage, trialConfig(this.manifest).pricing!, this.manifest.model).costMicros;
                        this.actualCostMicros += this.latestProviderCost;
                        this.uncertainCalls--;
                    }
                    return response;
                } });
        }
        const underlying = this.provider ?? new ScriptedMockProvider([scripted]);
        const guarded: LlmProvider = { id: underlying.id, complete: async (request, signal) => {
            if (this.halted) throw new Error('Provider trial already stopped');
            const bytes = Buffer.byteLength(JSON.stringify(request));
            // UTF-8 bytes conservatively bound text token count; no cache discount is assumed.
            // Include a conservative 8 KiB envelope for the existing provider's
            // strict output schema and message framing, in addition to the input.
            const reservation = Math.ceil((bytes + 8192) * 125000 / 1000000) + Math.ceil(request.maxOutputTokens * 500000 / 1000000);
            if (bytes > STRATEGIC_LIMITS.maxInputBytes || this.calls >= STRATEGIC_LIMITS.maxCalls
                || this.reservedMicros + reservation > STRATEGIC_LIMITS.maxCostMicros
                || performance.now() - this.started >= STRATEGIC_LIMITS.totalMs) throw new Error('Strategic trial budget exhausted');
            this.calls++; this.reservedMicros += reservation;
            appendFileSync(join(this.directory, 'requests.jsonl'), `${JSON.stringify({ request, reservation, sequence: this.calls })}\n`);
            if (this.manifest.provider === 'openai') this.uncertainCalls++;
            this.latestProviderCost = null;
            let response;
            try { response = await underlying.complete(request, AbortSignal.any([signal, AbortSignal.timeout(Math.max(0, Math.ceil(STRATEGIC_LIMITS.totalMs - (performance.now() - this.started))))])); }
            catch (error) { this.halted = true; throw error; }
            if (this.manifest.provider === 'openai' && this.latestProviderCost === null) {
                this.halted = true; throw new Error('Provider usage is unavailable; retain the budget reservation');
            }
            appendFileSync(join(this.directory, 'responses.jsonl'), `${JSON.stringify({ runId: request.runId, response })}\n`);
            if (this.manifest.provider === 'scripted') this.actualCostMicros += response.usage.costMicros;
            return response;
        } };
        const budget = new LlmDailyBudgetStore(this.manifest.provider === 'openai'
            ? join(this.manifest.credentialWorkspace, '.local/admin/llm-budget.sqlite') : join(this.directory, 'llm-budget.sqlite'));
        try { const result = await new LlmOrchestrator(trialConfig(this.manifest),
            guarded, { append: event => this.audit(event) }, this.queue, budget).plan(input);
            if (['failed', 'rejected', 'limit-reached', 'stopped'].includes(result.status)) this.halted = true;
            return result;
        } finally { budget.close(); }
    }
    record(trace: StrategicTrace) {
        appendFileSync(join(this.directory, 'traces.jsonl'), `${JSON.stringify(trace)}\n`);
        console.info('[strategic-trial]', JSON.stringify({ scenario: trace.scenario, nativeVerified: trace.nativeVerified, reason: trace.reason }));
    }
    finish(ready: boolean) {
        const path = join(this.directory, 'traces.jsonl');
        let traces: StrategicTrace[] = [];
        try { traces = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const report = reportStrategicAcceptance(this.manifest, traces, ready, this.usage());
        writeFileSync(join(this.directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
        return report;
    }
}
