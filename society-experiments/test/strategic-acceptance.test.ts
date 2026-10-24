import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InferenceQueueRateLimitError } from '../../llm-runtime/queue.js';
import { STRATEGIC_SCENARIOS, StrategicTrialPlanner, reportStrategicAcceptance,
    type StrategicManifest, type StrategicTrace } from '../strategic-acceptance.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
const manifest: StrategicManifest = { protocol: 'si-b06.v1', runId: 'attempt', provider: 'scripted', model: 'scripted',
    credentialWorkspace: '.', sourceDigest: 'source', baselineDigest: 'baseline', startedAt: new Date().toISOString(), scenarios: STRATEGIC_SCENARIOS };
function traces(): StrategicTrace[] {
    return STRATEGIC_SCENARIOS.map(scenario => ({ scenario, baselineDigest: 'baseline', eventId: scenario, agentId: 'worker',
        eventSource: 'source', observedSource: 'source', perceivedChange: true, alternativeIds: ['a', 'b'], selectedStrategy: scenario === 'control' ? 'routine' : 'acquire',
        plan: { runId: scenario, agentId: 'worker', status: 'proposed', decision: { kind: 'choose-alternative', goalId: 'reserve', optionId: 'a', reason: 'Choice' },
            approvalId: null, reason: 'Choice', usage: { costMicros: 1 }, durationMs: 1 },
        adoptedRunId: scenario, nativeRunId: scenario, nativeVerified: true, contractId: 'contract', selectedContractId: 'contract', contractParties: ['worker', 'partner'],
        executionPlan: { runId: 'execution', agentId: 'worker', status: 'proposed', decision: { kind: 'choose-alternative', goalId: 'reserve', optionId: 'a', reason: 'Work' },
            approvalId: null, reason: 'Work', usage: { costMicros: 1 }, durationMs: 1 },
        consentPlan: { runId: 'consent', agentId: 'partner', status: 'proposed', decision: { kind: 'choose-alternative', goalId: 'economic', optionId: 'accept', reason: 'Consent' },
            approvalId: null, reason: 'Consent', usage: { costMicros: 1 }, durationMs: 1 },
        outcome: { rawDelta: 1, gpDelta: 5, proposalId: 'offer', partnerAccepted: true }, reason: 'Fixture' }));
}
const usage = { calls: 5, reservedMicros: 5000, durationMs: 1000 };
test('scripted evidence cannot establish real-LLM PASS; unavailable provider stays not-tested', () => {
    expect(reportStrategicAcceptance(manifest, traces(), true, usage)).toMatchObject({ technical: 'pass', realLlm: 'not-tested' });
    expect(reportStrategicAcceptance({ ...manifest, provider: 'openai' }, [], false, { ...usage, calls: 0 }).realLlm).toBe('not-tested');
});
test('routine continuation, invalid model choice, unauthorized plan and ACK-only result fail the gate', () => {
    for (const mutate of [
        (t: StrategicTrace[]) => { t[1]!.selectedStrategy = t[0]!.selectedStrategy; },
        (t: StrategicTrace[]) => { t[1]!.plan!.decision = { kind: 'choose-alternative', goalId: 'reserve', optionId: 'forbidden', reason: 'Attack' }; },
        (t: StrategicTrace[]) => { t[1]!.plan!.status = 'rejected'; },
        (t: StrategicTrace[]) => { t[2]!.nativeVerified = false; },
        (t: StrategicTrace[]) => { t[2]!.outcome.rawDelta = 0; },
        (t: StrategicTrace[]) => { t[3]!.outcome.partnerAccepted = false; },
        (t: StrategicTrace[]) => { t[3]!.contractParties = ['worker', 'unrelated-business']; },
        (t: StrategicTrace[]) => { t[1]!.baselineDigest = 'changed'; },
        (t: StrategicTrace[]) => { t[1]!.observedSource = 'foreign'; },
        (t: StrategicTrace[]) => { t[1]!.perceivedChange = false; },
        (t: StrategicTrace[]) => { t.push(t[0]!); }
    ]) { const t = traces(); mutate(t); expect(reportStrategicAcceptance({ ...manifest, provider: 'openai' }, t, true, usage).realLlm).toBe('fail'); }
    expect(reportStrategicAcceptance(manifest, traces(), true, { ...usage, calls: 9 }).technical).toBe('fail');
});
test('trial planner validates a model reply through the real orchestrator and retains rejected output', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'si-b06-planner-')); directories.push(parent);
    const planner = new StrategicTrialPlanner(join(parent, 'attempt'), manifest);
    const input = { agentId: 'worker', runId: 'invalid', mode: 'choose-player-strategy' as const, goal: { goalId: 'reserve', title: 'Food', description: '' },
        goalHierarchy: [{ goalId: 'reserve', parentGoalId: null, horizon: 'current' as const, title: 'Food', description: '', priority: 1 }], trustedContext: 'Own resources',
        allowedSkills: [{ id: 'food', version: '1.0.0', name: 'Food', description: 'Resource' }], alternatives: ['a', 'b'].map(optionId => ({ optionId, skill: { id: 'food', version: '1.0.0' }, parameters: {}, purpose: 'produce' as const,
            costGp: 0, rewardGp: null, risk: 'routine', requirements: [], evidence: [] })) };
    const result = await planner.plan(input, { output: { decision: 'select_alternative', goalId: 'reserve', alternativeId: 'unauthorized', reason: 'Attack', goals: [], tool: null }, usage: { costMicros: 0 } });
    expect(result.status).toBe('rejected');
    expect(readFileSync(join(parent, 'attempt/responses.jsonl'), 'utf8')).toContain('unauthorized');
    expect(readFileSync(join(parent, 'attempt/audit.jsonl'), 'utf8')).toContain('decision.rejected');
    await expect(planner.plan(input, new Error('Cannot retry'))).rejects.toThrow('cannot be repeated');
    expect(planner.usage().calls).toBe(1);
    await expect(planner.plan({ ...input, runId: 'second' }, new Error('Cannot call again'))).rejects.toThrow('Trial stopped');
    expect(() => new StrategicTrialPlanner(join(parent, 'attempt'), manifest)).toThrow();
    const limited = new StrategicTrialPlanner(join(parent, 'rate-limit'), manifest);
    expect((await limited.plan({ ...input, runId: 'rate-limit' }, new InferenceQueueRateLimitError('Synthetic HTTP 429'))).status).toBe('failed');
    expect(limited.usage().calls).toBe(1);
    await expect(limited.plan({ ...input, runId: 'after-rate-limit' }, new Error('Cannot retry'))).rejects.toThrow('Trial stopped');
});
