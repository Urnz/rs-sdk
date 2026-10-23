import { AgentStateStore } from '../../../../agent-state/store.js';
import { adoptBoundedImmediatePlan } from '../bounded-plan-adoption.js';
import type { SkillDefinition } from '../../../../agent-skills/types.js';
import type { LlmAutonomousExecutionConfig } from '../../../../llm-runtime/types.js';
import type { EconomicObservation } from '../../../../agent-state/economic-context.js';

const [path, stage, raw] = process.argv.slice(2);
const input = JSON.parse(raw!) as { definition: SkillDefinition; grant: LlmAutonomousExecutionConfig;
    now: string; later: string; runId: string; observation: EconomicObservation };
const s = new AgentStateStore(path!);
if (stage === 'proposal') s.createGoalProposal('worker', { proposalId: 'proposal', runId: 'decision',
    anchorGoalId: 'buffer', anchorGoalRevision: 1,
    goals: [{ goalId: 'get-food', parentGoalId: 'buffer', horizon: 'immediate', title: 'Acquire food' }],
    skill: input.definition, reason: 'Bounded reserve recovery' }, input.now);
else if (stage === 'adoption') adoptBoundedImmediatePlan(s, 'proposal', input.definition, input.grant, {}, input.now);
else if (stage === 'dispatch') s.recordSkillDispatch({ runId: input.runId, decisionId: 'decision', agentId: 'worker',
    goalId: 'get-food', skill: input.definition, binding: s.getGoalExecution('get-food')!.binding,
    policyId: 'private-local-default', policyVersion: '1.0.0' }, input.now);
else if (stage === 'outcome') s.recordSkillRunOutcome(input.runId, 'completed', 'completed', 'Native terminal', input.later);
else if (stage === 'evaluation') s.evaluateGoalStates('worker', input.observation, input.observation.observedAt);
else throw new Error('Unknown crash barrier');
// Abrupt process termination deliberately omits close/finally; the next process must recover the WAL.
process.exit(79);
