import type { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import { bindAutonomousSkillParameters } from './autonomous-skill-binding.js';
import type { AutonomousSkillParameterCandidate } from './autonomous-skill-binding.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';
import { evaluateAutonomousSkillPolicy } from './autonomous-skill-policy.js';

/** Additive plan-adoption boundary, reusing existing dispatch checks and the budget ledger. */
export function adoptBoundedImmediatePlan(store: AgentStateStore, proposalId: string,
    definition: SkillDefinition, config: LlmAutonomousExecutionConfig,
    parameters: Record<string, string | number | boolean> = {}, now = new Date().toISOString(),
    source?: AutonomousSkillParameterCandidate, leaseOwner?: string) {
    const proposal = store.getGoalProposal(proposalId);
    if (!proposal?.skill || proposal.skill.id !== definition.id || proposal.skill.version !== definition.version)
        throw new Error('Proposal does not match the exact reviewed skill');
    const policy = evaluateAutonomousSkillPolicy(config, definition);
    if (!policy.allowed) throw new Error(policy.reason);
    const binding = bindAutonomousSkillParameters(definition, [source ?? { sourceKind: 'llm-suggestion',
        sourceId: proposal.runId, skill: proposal.skill, parameters }]);
    const envelope = evaluateAuthorizationEnvelope(policy.authorization!, definition, binding.parameters);
    if (!envelope.allowed) throw new Error(envelope.reason);
    const enrollment = store.getAutonomyEnrollment(proposal.agentId);
    if (!enrollment) throw new Error('No autonomy enrollment for bounded adoption');
    return store.adoptImmediateGoalProposal(proposalId, proposal.revision, { decisionId: proposal.runId,
        binding, scopeDigest: stateDigest({ config, definition, binding, policyId: enrollment.policyId,
            policyVersion: enrollment.policyVersion }), reservedGp: envelope.reservedGp,
        dailyLimitGp: policy.authorization!.maxGpPerDay ?? 0,
        policyId: enrollment.policyId, policyVersion: enrollment.policyVersion, leaseOwner }, now);
}
