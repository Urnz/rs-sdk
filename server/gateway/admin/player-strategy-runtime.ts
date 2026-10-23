import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import type { PlayerStrategyRequest } from '../../../agent-state/player-strategy.js';
import type { LlmPlanResult } from '../../../llm-runtime/types.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { buildPlayerStrategyOptions, type PlayerStrategySources } from './player-strategy-options.js';
import { adoptBoundedImmediatePlan } from './bounded-plan-adoption.js';
import type { ReplanOutcome } from './replan-coordinator.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import type { AgentSkillParameterBinding } from '../../../agent-state/types.js';

export interface PlayerStrategyContext extends PlayerStrategySources {
    trustedContext: string;
    blockers: string[];
    maxLlmCostMicros: number;
}
export interface PlayerStrategyPorts {
    requiredLeaseOwner?: string;
    simulationClock?: AgentStateSimulationClock;
    agentPath: string;
    read(): Promise<PlayerStrategyContext>;
    plan(context: PlayerStrategyContext, request: PlayerStrategyRequest): Promise<LlmPlanResult>;
    dispatch(goalId: string, definition: SkillDefinition, binding: AgentSkillParameterBinding, decisionId: string): Promise<ReplanOutcome>;
    gaps: CapabilityGapStore;
}

/** One durable model choice per admitted event. Inference with an uncertain terminal is never resent on replay. */
export async function runPlayerStrategy(event: LlmReplanEvent, ports: PlayerStrategyPorts): Promise<ReplanOutcome> {
    const store = new AgentStateStore(ports.agentPath, ports.simulationClock);
    const wait = (reason: string, status = 'bounded-wait'): ReplanOutcome => ({ runId: event.eventId, status, reason });
    try {
        let record = store.getPlayerStrategy(event.eventId);
        if (record && (record.request.agentId !== event.agentId || record.request.event.sourceKey !== event.sourceKey))
            throw new Error('Strategy event identity collision');
        if (record?.status === 'dispatched') {
            const outcome = store.getSkillRunOutcome(record.runId!);
            return { runId: record.runId!, status: outcome?.status ?? 'executing',
                reason: outcome?.detail ?? 'The chosen strategy already has its one durable dispatch.', decision: record.plan?.decision };
        }
        if (record?.status === 'waiting') return wait(record.reason);
        if (record?.status === 'inferring') return wait('Prior strategy inference is uncertain; replay cannot send or reserve another provider request.');
        let context = await ports.read();
        const enrollment = store.getAutonomyEnrollment(event.agentId);
        if (store.getAutonomyControl().emergencyStop || !enrollment || enrollment.status !== 'running'
            || !enrollment.leaseExpiresAt || enrollment.leaseExpiresAt <= context.now
            || (ports.requiredLeaseOwner && enrollment.leaseOwner !== ports.requiredLeaseOwner)
            || context.snapshot.characterLifecycle?.status === 'deceased' || context.world.player?.isDead)
            return wait('Player strategy requires a living avatar and the current live autonomy lease.', 'skipped');
        if (context.blockers.length) return wait(`Authoritative strategy context is unavailable: ${context.blockers.join(', ')}`, 'input-required');
        if (context.parent.stateEvaluation?.result !== 'unsatisfied') return wait('A fresh unsatisfied state objective is required before strategy inference.', 'input-required');
        const enumeration = buildPlayerStrategyOptions(context);
        if (!record) {
            const children = context.snapshot.goals.filter(g => g.status === 'active' && g.horizon === 'immediate'
                && g.parentGoalId === context.parent.goalId);
            if (children.length > 1) return wait('Resolve multiple active immediate children before a bounded strategy replacement.');
            const request: PlayerStrategyRequest = { event: { eventId:event.eventId,type:event.type,sourceKey:event.sourceKey },
                agentId:event.agentId,parent:{goalId:context.parent.goalId,revision:context.parent.revision},
                replaces: children[0] ? { goalId:children[0].goalId,revision:children[0].revision } : null,
                ...enumeration, observedAt:context.now,
                contextDigest:stateDigest({ context:context.trustedContext, enumeration, parent:context.parent, eventId:event.eventId }),
                policyDigest:stateDigest(context.config) };
            const proposalId = `strategy.${stateDigest(event.eventId).slice(0,32)}`;
            record = store.preparePlayerStrategy(request, context.profile.revision,
                request.options.length ? context.maxLlmCostMicros : 0, proposalId, context.now);
        }
        if (record.status === 'prepared' && !record.request.options.length) {
            const missing = record.request.unavailable.find(u => u.kind === 'procedure');
            if (missing) await ports.gaps.report({ agentId:event.agentId,goalId:record.request.parent.goalId,
                anchorGoalId:record.request.parent.goalId,title:context.parent.title,
                description:`Unavailable reviewed procedure ${missing.skill}; ${missing.reason}` });
            const reason = missing ? `Capability gap: ${missing.skill}; wait for a reviewed procedure.`
                : 'No executable authorized alternative; acquire the missing inputs/context or wait for a new bounded observation.';
            store.waitPlayerStrategy(event.eventId,reason);
            return wait(reason,missing ? 'capability-gap' : 'input-required');
        }
        if (record.status === 'prepared') {
            if (!store.claimPlayerStrategyInference(event.eventId)) return wait('Strategy inference is already claimed.');
            const plan = await ports.plan(context,record.request);
            record = store.finishPlayerStrategyInference(event.eventId,plan);
        }
        if (record.status === 'waiting') return wait(record.reason);
        const decision = record.plan?.decision;
        if (decision?.kind !== 'choose-alternative') return wait('No validated strategy choice is available.');
        const chosen = record.request.options.find(o => o.optionId === decision.optionId)!;
        // Refresh source, parent and grant after inference, without a second provider call.
        context = await ports.read();
        const latestLease = store.getAutonomyEnrollment(event.agentId);
        const requiredOwner = ports.requiredLeaseOwner ?? enrollment.leaseOwner;
        if (store.getAutonomyControl().emergencyStop || latestLease?.status !== 'running'
            || !latestLease.leaseExpiresAt || latestLease.leaseExpiresAt <= context.now || latestLease.leaseOwner !== requiredOwner)
            throw new Error('Strategy autonomy lease changed during inference');
        const fresh = buildPlayerStrategyOptions(context).options.find(o => o.optionId === chosen.optionId);
        if (!fresh || stateDigest(context.config) !== record.request.policyDigest
            || context.parent.goalId !== record.request.parent.goalId || context.parent.revision !== record.request.parent.revision
            || context.blockers.length) throw new Error('Chosen strategy source, parent or grant changed after planning');
        const definition = context.definitions.find(d => d.id === chosen.skill.id && d.version === chosen.skill.version)!;
        if (record.status === 'decided' && !store.getGoalProposal(record.proposalId)) store.createGoalProposal(event.agentId, {
            proposalId:record.proposalId,runId:event.eventId,anchorGoalId:record.request.parent.goalId,
            anchorGoalRevision:record.request.parent.revision,
            goals:[{goalId:`${record.proposalId}.step`,parentGoalId:record.request.parent.goalId,horizon:'immediate',
                title:`${chosen.purpose}: ${definition.name}`.slice(0,200),description:decision.reason,priority:context.parent.priority}],
            skill:chosen.skill,reason:decision.reason },context.now);
        const goal = adoptBoundedImmediatePlan(store,record.proposalId,definition,context.config,chosen.parameters,context.now,
            {sourceKind:chosen.binding.sourceKind,sourceId:chosen.binding.sourceId,skill:chosen.skill,parameters:chosen.parameters},requiredOwner ?? undefined);
        const result = await ports.dispatch(goal.goalId,definition,store.getGoalExecution(goal.goalId)!.binding,event.eventId);
        return {...result,decision:{...decision,proposalId:record.proposalId,adoptedGoalId:goal.goalId}};
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Preserve an uncertain inference/adopted dispatch for explicit recovery; never start inference again.
        const current = store.getPlayerStrategy(event.eventId);
        if (current?.status !== 'inferring') store.waitPlayerStrategy(event.eventId,reason);
        return wait(reason);
    } finally { store.close(); }
}
