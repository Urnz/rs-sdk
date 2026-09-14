import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { observeLiveState } from '../../../agent-state/live.js';
import { selectImmediateGoal } from '../../../agent-state/planner.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { delegateBusinessPlayerAction, finishAdminPlayerActionRun, listAdminAgents,
    startAdminPlayerActionRequest } from './agent-state.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import { agentStateDbPath, capabilityGapsPath, llmReplanLogPath } from './paths.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { AgentReplanCoordinator, type AgentReplanCoordinatorDependencies,
    AUTONOMY_LEASE_OWNER_MISMATCH_REASON, type ReplanOutcome, type ReplanRecord } from './replan-coordinator.js';
import type { GatewayBotSnapshot } from './types.js';
import { resolveLearnAndPlan } from './deterministic-learning.js';
import { resolveSkillForCapability } from '../../../agent-skills/capability-gaps.js';
import { createAdminGoalProposal } from './agent-state.js';
import { loadLlmRuntimeConfig } from './llm-settings.js';
import { resolveAdminSkillForAgent } from './skill-catalog.js';
import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';
import type { SkillDefinition, SkillOperationName, SkillStep } from '../../../agent-skills/types.js';
import type { BotSupervisor } from './supervisor.js';
import type { AdminAgentSkillCatalogOptions } from './skill-catalog.js';
import { DurableAgentReplanCoordinator, enqueueDurableReplan } from './durable-replan-coordinator.js';
import { replanInboxDbPath } from './paths.js';
import { bindAutonomousSkillParameters, classifySkillFailure,
    type AutonomousSkillParameterCandidate } from './autonomous-skill-binding.js';
import { selectAllowedGoalTemplate } from './goal-templates.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';
import type { EconomicContract } from './economic-contracts.js';
import type { AgentSkillRunOutcome } from '../../../agent-state/types.js';
import type { ReplanInboxSimulationClock } from './replan-inbox.js';

let appendTail: Promise<void> = Promise.resolve();

const ROUTINE_AUTONOMOUS_OPERATIONS: SkillOperationName[] = ['walk-to', 'wait-for-area', 'talk-to-npc',
    'navigate-dialog', 'interact-loc', 'interact-npc', 'gather-loc', 'gather-npc', 'smith-at-anvil',
    'open-shop', 'sell-to-shop', 'close-shop', 'open-bank', 'deposit-item', 'withdraw-item', 'close-bank',
    'wait-ticks'];

export function appendReplanRecord(record: ReplanRecord, path = llmReplanLogPath): Promise<void> {
    appendTail = appendTail.catch(() => undefined).then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    });
    return appendTail;
}

export async function readReplanRecords(limit = 100, path = llmReplanLogPath): Promise<ReplanRecord[]> {
    try {
        const contents = await readFile(path, 'utf8');
        return contents.trim().split(/\r?\n/).filter(Boolean).flatMap(line => {
            try {
                const record = JSON.parse(line) as ReplanRecord;
                return record?.event?.eventId && record.gate ? [record] : [];
            } catch { return []; }
        }).slice(-Math.max(1, Math.min(1000, Math.trunc(limit) || 100))).reverse();
    } catch { return []; }
}

function useStore<T>(callback: (store: AgentStateStore) => T, path = agentStateDbPath,
    simulationClock?: ReplanInboxSimulationClock): T {
    const store = new AgentStateStore(path, simulationClock);
    try { return callback(store); }
    finally { store.close(); }
}

export function contractObligationCandidates(agentId: string,
    contracts: readonly EconomicContract[]): AutonomousSkillParameterCandidate[] {
    return contracts.flatMap(contract => {
        if (contract.status !== 'active') return [];
        const party = contract.partyAAgentId === agentId ? 'a'
            : contract.partyBAgentId === agentId ? 'b' : null;
        if (!party || (party === 'a' ? contract.partyASatisfied : contract.partyBSatisfied)) return [];
        const required = party === 'a' ? contract.partyAProvides : contract.partyBProvides;
        if (!required.skill) return [];
        return [{ sourceKind: 'contract-obligation' as const, sourceId: contract.contractId,
            skill: required.skill, parameters: {} }];
    });
}

export interface GatewayAgentReplanOptions {
    agentPath?: string;
    capabilityGapPath?: string;
    llmConfigPath?: string;
    skillCatalog?: AdminAgentSkillCatalogOptions;
    replanInboxPath?: string | null;
    requiredAutonomyLeaseOwner?: string;
    simulationClock?: ReplanInboxSimulationClock;
}

export function evaluateAutonomousSkillPolicy(config: LlmAutonomousExecutionConfig,
    definition: SkillDefinition): { allowed: boolean; reason: string;
        authorization?: LlmAutonomousExecutionConfig['allowedSkills'][number] } {
    const reference = `${definition.id}@${definition.version}`;
    if (!config.enabled) return { allowed: false, reason: 'Autonomous execution is disabled.' };
    const authorization = config.allowedSkills.find(skill => skill.id === definition.id
        && skill.version === definition.version);
    if (!authorization) {
        return { allowed: false, reason: `${reference} is not on the exact autonomous allowlist.` };
    }
    if (definition.status !== 'verified') return { allowed: false, reason: `${reference} is not verified.` };
    if (definition.limits.maxOperations > config.maxOperations || definition.limits.timeoutMs > config.maxTimeoutMs) {
        return { allowed: false, reason: `${reference} exceeds the autonomous operation or time limit.` };
    }
    const allowedOperations = new Set(authorization.operations ?? ROUTINE_AUTONOMOUS_OPERATIONS);
    const inspect = (steps: SkillStep[]): string | null => {
        for (const step of steps) {
            if (step.kind === 'call') return 'Composed skill calls are not allowed in the initial autonomous policy.';
            if (step.kind === 'repeat') { const nested = inspect(step.steps); if (nested) return nested; continue; }
            if (!allowedOperations.has(step.operation)) {
                return `Operation ${step.operation} is outside the exact autonomous authorization.`;
            }
        }
        return null;
    };
    const unsafe = inspect(definition.steps);
    return unsafe ? { allowed: false, reason: unsafe } : { allowed: true,
        reason: `${reference} passed autonomous policy.`, authorization };
}

/** Prevents a failed precondition from hot-looping the same skill without acquiring its missing input. */
export function terminalFailureFallback(outcome: AgentSkillRunOutcome | null,
    alternative?: { id: string; version: string }): ReplanOutcome | null {
    if (!outcome || outcome.classification === 'completed') return null;
    if (alternative) return { runId: outcome.runId, status: 'alternative-selected',
        decision: { kind: 'alternative-skill', skill: alternative },
        reason: `The failed skill is suppressed; ${alternative.id}@${alternative.version} was selected for the next bounded attempt.` };
    if (outcome.classification === 'acquire-input') return { runId: outcome.runId, status: 'input-required',
        reason: `Input acquisition or an explicit bounded wait is required before retrying: ${outcome.detail}` };
    if (outcome.classification === 'retry') return { runId: outcome.runId, status: 'bounded-wait',
        reason: `The same failed skill is suppressed until the supervisor backoff expires: ${outcome.detail}` };
    return { runId: outcome.runId, status: 'operator-warning',
        reason: `Operator attention is required before repeating this ${outcome.classification} failure: ${outcome.detail}` };
}

export function createGatewayAgentReplanCoordinator(gatewayBots: () => Map<string, GatewayBotSnapshot>,
    supervisor: BotSupervisor,
    append: (record: ReplanRecord) => Promise<void> = appendReplanRecord,
    options: GatewayAgentReplanOptions = {}): AgentReplanCoordinator {
    const agentPath = options.agentPath ?? agentStateDbPath;
    const gapPath = options.capabilityGapPath ?? capabilityGapsPath;
    const listAgents = () => listAdminAgents(agentPath, { skillCatalog: options.skillCatalog,
        gatewayBots: gatewayBots() });
    const dependencies: AgentReplanCoordinatorDependencies = {
        resolveAgentId: async playerUsername => useStore(store => store.listIdentities()
            .find(identity => identity.playerUsername === playerUsername.toLowerCase())?.agentId ?? null, agentPath),
        listAgentIds: async () => useStore(store => store.listIdentities().map(identity => identity.agentId), agentPath),
        listEconomicAgentIds: async () => useStore(store => store.listAutonomyEnrollments()
            .filter(enrollment => enrollment.status === 'desired' || enrollment.status === 'running')
            .filter(enrollment => {
                const economicGoal = store.listGoals(enrollment.agentId, 'active').some(goal =>
                    /\b(coin|coins|gp|trade|market|shop|bank|sell|buy|wage|profit|gazdas|keresk|piac|elad|vásár|bér)\b/i
                        .test(`${goal.title} ${goal.description}`));
                return economicGoal || store.listCommitments(enrollment.agentId, undefined, 'open').length > 0;
            }).sort((a, b) => a.agentId.localeCompare(b.agentId)).slice(0, 25).map(item => item.agentId), agentPath),
        plan: async (agentId: string, event: LlmReplanEvent): Promise<ReplanOutcome> => {
            if (event.type !== 'manual-request') {
                if (useStore(store => store.getAutonomyControl().emergencyStop, agentPath)) {
                    return { runId: event.eventId, status: 'skipped',
                        reason: 'Global autonomy emergency stop is active.' };
                }
                const enrollment = useStore(store => store.getAutonomyEnrollment(agentId), agentPath);
                if (!enrollment || enrollment.status !== 'running' || !enrollment.leaseExpiresAt
                    || Date.parse(enrollment.leaseExpiresAt) <= Date.now()) {
                    return { runId: event.eventId, status: 'skipped',
                        reason: 'Agent does not hold a live autonomy lease.' };
                }
                if (options.requiredAutonomyLeaseOwner
                    && enrollment.leaseOwner !== options.requiredAutonomyLeaseOwner) {
                    return { runId: event.eventId, status: 'skipped',
                        reason: AUTONOMY_LEASE_OWNER_MISMATCH_REASON };
                }
            }
            const initial = await listAgents();
            const agent = initial.agents.find(entry => entry.identity.agentId === agentId);
            if (!agent) return { runId: event.eventId, status: 'skipped', reason: 'Agent state no longer exists.' };
            const avatar = agent.controlProfile.avatarPlayerUsername;
            if (!avatar) return { runId: event.eventId, status: 'skipped', reason: 'Agent has no player avatar.' };
            if (agent.controlProfile.role !== 'player' || agent.identity.playerUsername !== avatar) {
                return { runId: event.eventId, status: 'skipped', reason: 'Agent has no exact player-avatar binding.' };
            }
            const gateway = [...gatewayBots().entries()]
                .find(([name]) => name.toLowerCase() === avatar)?.[1];
            if (!gateway?.state?.player || gateway.status !== 'active'
                || Date.now() - gateway.lastStateReceivedAt > 5_000) {
                return { runId: event.eventId, status: 'skipped', reason: 'No fresh online world state is available.' };
            }
            if (event.type !== 'manual-request' && gateway.controllers > 0) {
                return { runId: event.eventId, status: 'skipped',
                    reason: 'The avatar already has an active controller.' };
            }
            const now = new Date().toISOString();
            useStore(store => {
                const previous = store.getWorkingMemory(agentId);
                store.setWorkingMemory(agentId, previous?.revision ?? null, observeLiveState(gateway.state!, now), now);
            }, agentPath);
            const refreshed = await listAgents();
            let current = refreshed.agents.find(entry => entry.identity.agentId === agentId);
            if (!current) return { runId: event.eventId, status: 'skipped', reason: 'Agent state disappeared before planning.' };
            try {
                const config = (await loadLlmRuntimeConfig(options.llmConfigPath ? {
                    defaultConfigPath: options.llmConfigPath,
                    overrideConfigPath: `${options.llmConfigPath}.override`
                } : {})).config;
                if (!config.automaticReplanning) return { runId: event.eventId, status: 'skipped',
                    reason: 'Automatic replanning is disabled.' };
                const durableEnrollment = useStore(store => store.getAutonomyEnrollment(agentId), agentPath);
                const template = durableEnrollment
                    ? selectAllowedGoalTemplate(current.goals, durableEnrollment) : null;
                if (template) {
                    useStore(store => store.createGoal(agentId, { ...template.goal,
                        parentGoalId: template.parentGoalId }, now), agentPath, options.simulationClock);
                    const templated = await listAgents();
                    current = templated.agents.find(entry => entry.identity.agentId === agentId);
                    if (!current) throw new Error('Agent state disappeared after goal template materialization');
                }
                const terminalOutcome = event.type === 'skill-failed'
                    ? useStore(store => store.getSkillRunOutcome(event.eventId), agentPath) : null;
                const failedDispatch = terminalOutcome
                    ? useStore(store => store.getSkillDispatch(event.eventId), agentPath) : null;
                const failedGoal = failedDispatch
                    ? current.goals.find(goal => goal.goalId === failedDispatch.goalId
                        && goal.horizon === 'immediate' && goal.status === 'active') : null;
                const immediate = failedGoal ?? selectImmediateGoal(current, event.selectionSeed);
                let alternative: { id: string; version: string } | undefined;
                if (terminalOutcome && immediate) {
                    const failed = new Set(useStore(store => store.listFailedSkillReferencesForGoal(
                        immediate.goalId), agentPath).map(skill => `${skill.id}@${skill.version}`));
                    const known = current.knownSkills.filter(item => item.status === 'known' || item.status === 'preferred');
                    const resolution = resolveSkillForCapability(immediate, current.catalogSkills
                        .filter(skill => known.some(item => item.skill.id === skill.id
                            && item.skill.version === skill.version))
                        .filter(skill => !failed.has(skill.reference) && !skill.tags.includes('procedure'))
                        .map(skill => ({ ...skill, status: 'verified' as const, visibility: 'shared' as const })),
                    known.map(item => ({ ...item.skill, status: item.status })));
                    if (resolution) {
                        const execution = useStore(store => store.getGoalExecution(immediate.goalId), agentPath);
                        const candidate = await resolveAdminSkillForAgent(
                            `${resolution.skill.id}@${resolution.skill.version}`, agentId, options.skillCatalog);
                        const parameterSource = execution ? [{ sourceKind: execution.binding.sourceKind,
                            sourceId: execution.binding.sourceId, skill: resolution.skill,
                            parameters: execution.binding.parameters }] : [];
                        try {
                            const binding = bindAutonomousSkillParameters(candidate.definition, parameterSource);
                            const policy = evaluateAutonomousSkillPolicy(config.autonomousExecution, candidate.definition);
                            const envelope = policy.allowed ? evaluateAuthorizationEnvelope(policy.authorization!,
                                candidate.definition, binding.parameters) : { allowed: false };
                            if (policy.allowed && envelope.allowed) {
                                useStore(store => store.setGoalSkill(agentId, immediate.goalId, immediate.revision,
                                    resolution.skill, now), agentPath, options.simulationClock);
                                alternative = { id: resolution.skill.id, version: resolution.skill.version };
                            }
                        } catch {
                            // An alternative without an exact persisted parameter binding is not executable.
                        }
                    }
                }
                const failureFallback = terminalFailureFallback(terminalOutcome, alternative);
                const deterministicResolution = !failureFallback && immediate ? resolveSkillForCapability(immediate,
                    current.catalogSkills.map(skill => ({ ...skill, status: 'verified' as const,
                        visibility: 'shared' as const })), current.knownSkills.map(item => ({
                        ...item.skill, status: item.status }))) : null;
                const expectedCost = deterministicResolution || failureFallback ? 0 : config.limits.maxCostMicros;
                const trigger = event.type === 'autonomy-startup' || event.type === 'autonomy-idle'
                    ? 'scheduled' : 'event';
                const profileRevision = current.controlProfile.revision;
                const contextDigest = createHash('sha256').update(current.decisionContext).digest('hex');
                useStore(store => store.recordDecision(agentId, profileRevision, {
                    decisionId: event.eventId, trigger, llmCostMicros: expectedCost,
                    operationalBudgetGp: 0, contextDigest
                }, now), agentPath);
                if (failureFallback) return failureFallback;
                const dispatch = async (goalId: string, candidate: Awaited<ReturnType<typeof resolveAdminSkillForAgent>>,
                    candidates: AutonomousSkillParameterCandidate[], decisionId: string) => {
                    const policy = evaluateAutonomousSkillPolicy(config.autonomousExecution, candidate.definition);
                    if (!policy.allowed) return { runId: decisionId, status: 'approval-required' as const,
                        reason: policy.reason };
                    const binding = bindAutonomousSkillParameters(candidate.definition, candidates);
                    const envelope = evaluateAuthorizationEnvelope(policy.authorization!, candidate.definition,
                        binding.parameters);
                    if (!envelope.allowed) return { runId: decisionId, status: 'approval-required' as const,
                        reason: envelope.reason };
                    useStore(store => store.reserveDecisionOperationalBudget(decisionId, envelope.reservedGp,
                        policy.authorization!.maxGpPerDay ?? 0), agentPath);
                    const enrollment = useStore(store => store.getAutonomyEnrollment(agentId), agentPath);
                    if (!enrollment) throw new Error('Autonomous skill dispatch has no durable enrollment');
                    let runId = crypto.randomUUID();
                    let workOrder = binding.sourceKind === 'work-order'
                        ? current!.incomingPlayerActions.find(item => item.requestId === binding.sourceId) : undefined;
                    if (workOrder?.status === 'running') {
                        if (!workOrder.runId) throw new Error('Running work order has no bound run id');
                        return { runId: workOrder.runId, status: 'executing' as const,
                            reason: 'The exact work order is already running under its one-use authorization.' };
                    }
                    if (workOrder?.status === 'pending' || workOrder?.status === 'accepted') {
                        workOrder = delegateBusinessPlayerAction(workOrder.requestId, runId, agentPath, now).request;
                    } else if (workOrder?.status === 'approved') {
                        if (!workOrder.approvalId) throw new Error('Approved work order has no approval id');
                        workOrder = startAdminPlayerActionRequest(workOrder.requestId, workOrder.assigneeAgentId,
                            workOrder.revision, workOrder.approvalId, runId, agentPath);
                    }
                    useStore(store => store.recordSkillDispatch({ runId, decisionId, agentId, goalId,
                        skill: { id: candidate.definition.id, version: candidate.definition.version }, binding,
                        policyId: enrollment.policyId, policyVersion: enrollment.policyVersion }), agentPath);
                    try {
                        const process = await supervisor.startSkill(avatar,
                            `${candidate.definition.id}@${candidate.definition.version}`, binding.parameters, { runId,
                                runtimeAuthorization: {
                                    operations: policy.authorization!.operations ?? ROUTINE_AUTONOMOUS_OPERATIONS,
                                    itemNames: policy.authorization!.itemNames ?? [],
                                    partners: policy.authorization!.partners ?? [],
                                    maxQuantity: policy.authorization!.maxQuantity ?? 28,
                                    maxUnitPriceGp: policy.authorization!.maxUnitPriceGp ?? 0,
                                    maxGpPerRun: policy.authorization!.maxGpPerRun ?? 0
                                } });
                        return { runId: process.runId, status: 'executing' as const, reason: envelope.reason };
                    } catch (error) {
                        const detail = error instanceof Error ? error.message : String(error);
                        useStore(store => store.recordSkillRunOutcome(runId, 'failed',
                            classifySkillFailure(undefined, detail), detail), agentPath, options.simulationClock);
                        if (workOrder?.runId === runId) finishAdminPlayerActionRun(runId, false,
                            `Skill start failed: ${detail}`, agentPath);
                        throw error;
                    }
                };
                if (immediate) {
                    const deterministic = await resolveLearnAndPlan(agentId, immediate, current.catalogSkills,
                        current.knownSkills, { now, agentPath, catalog: options.skillCatalog,
                            selectionSeed: event.selectionSeed, simulationClock: options.simulationClock });
                    if (deterministic?.decision.kind === 'execute-skill') {
                        const requested = `${deterministic.resolution.skill.id}@${deterministic.resolution.skill.version}`;
                        const candidate = await resolveAdminSkillForAgent(requested, agentId, options.skillCatalog);
                        const execution = useStore(store => store.getGoalExecution(immediate.goalId), agentPath);
                        const candidates: AutonomousSkillParameterCandidate[] = [];
                        for (const request of current.incomingPlayerActions.filter(item =>
                            ['pending', 'accepted', 'approved', 'running'].includes(item.status))) {
                            candidates.push({ sourceKind: 'work-order', sourceId: request.requestId,
                                skill: request.skill, parameters: request.parameters });
                        }
                        candidates.push(...contractObligationCandidates(agentId, current.economicContracts));
                        if (execution) candidates.push({ sourceKind: execution.binding.sourceKind,
                            sourceId: execution.binding.sourceId, skill: immediate.skill!,
                            parameters: execution.binding.parameters });
                        const launched = await dispatch(immediate.goalId, candidate, candidates, event.eventId);
                        return { ...launched, decision: deterministic.decision };
                    }
                }
                const result = await runAdminLlmDryRun(current, current.catalogSkills, { now, runId: event.eventId,
                    untrustedText: event.type === 'offer-received' ? [event.summary] : [], automatic: true,
                    requireAuthoritativeContext: true,
                    configPath: options.llmConfigPath,
                    capabilityGapStore: new CapabilityGapStore(gapPath) });
                if (result.plan.status === 'proposed' && result.plan.decision?.kind === 'propose-goal-plan') {
                    const anchor = current.goals.find(goal => goal.goalId === result.plan.decision!.goalId);
                    if (anchor) {
                        const proposal = createAdminGoalProposal(agentId, { proposalId: crypto.randomUUID(),
                            runId: result.plan.runId, anchorGoalId: anchor.goalId,
                            anchorGoalRevision: anchor.revision, goals: result.plan.decision.goals,
                            skill: result.plan.decision.skill, reason: result.plan.decision.reason }, agentPath);
                        return { runId: result.plan.runId, status: 'approval-required',
                            decision: { ...result.plan.decision, proposalId: proposal.proposalId },
                            reason: 'A validated strategic goal proposal is waiting for admin approval.' };
                    }
                }
                if (result.plan.status === 'proposed' && result.plan.decision?.kind === 'execute-skill') {
                    const requested = `${result.plan.decision.skill.id}@${result.plan.decision.skill.version}`;
                    const candidate = await resolveAdminSkillForAgent(requested, agentId, options.skillCatalog);
                    const execution = useStore(store => store.getGoalExecution(result.plan.decision!.goalId), agentPath);
                    const candidates: AutonomousSkillParameterCandidate[] = [];
                    for (const request of current.incomingPlayerActions.filter(item =>
                        ['pending', 'accepted', 'approved', 'running'].includes(item.status))) {
                        candidates.push({ sourceKind: 'work-order', sourceId: request.requestId,
                            skill: request.skill, parameters: request.parameters });
                    }
                    candidates.push(...contractObligationCandidates(agentId, current.economicContracts));
                    if (execution) candidates.push({ sourceKind: execution.binding.sourceKind,
                        sourceId: execution.binding.sourceId, skill: result.plan.decision.skill,
                        parameters: execution.binding.parameters });
                    if (Object.keys(result.plan.decision.parameters).length > 0) {
                        candidates.push({ sourceKind: 'llm-suggestion', sourceId: result.plan.runId,
                            skill: result.plan.decision.skill, parameters: result.plan.decision.parameters });
                    }
                    const launched = await dispatch(result.plan.decision.goalId, candidate, candidates, event.eventId);
                    return { ...launched, decision: result.plan.decision };
                }
                return { runId: result.plan.runId, status: result.plan.status,
                    decision: result.plan.decision, reason: result.plan.reason };
            } catch (error) {
                return { runId: event.eventId, status: 'skipped',
                    reason: error instanceof Error ? error.message : String(error) };
            }
        },
        append
    };
    const inboxPath = options.replanInboxPath === undefined
        ? (options.agentPath === undefined ? replanInboxDbPath : null) : options.replanInboxPath;
    return inboxPath ? new DurableAgentReplanCoordinator(dependencies,
        { path: inboxPath, simulationClock: options.simulationClock })
        : new AgentReplanCoordinator(dependencies);
}

export async function dispatchVerifiedCapabilityWakeups(coordinator: AgentReplanCoordinator,
    store = new CapabilityGapStore(capabilityGapsPath), now = new Date().toISOString()): Promise<ReplanRecord[]> {
    const wakeups = await store.claimVerifiedWakeups(100, now);
    return Promise.all(wakeups.map(async wakeup => {
        const event: LlmReplanEvent = { eventId: crypto.randomUUID(), agentId: wakeup.agentId,
            type: 'capability-ready',
            sourceKey: `capability:${wakeup.gapId}:${wakeup.agentId}:${wakeup.anchorGoalId}`,
            occurredAt: now,
            summary: `Capability ${wakeup.gapId} is ready as ${wakeup.resolvedSkill.id}@${wakeup.resolvedSkill.version}.`
        };
        try {
            const queued = enqueueDurableReplan(coordinator, event, now);
            if (queued) return { timestamp: now, event: queued.record.event,
                gate: { accepted: true as const, reason: 'accepted' as const, nextAllowedAt: now },
                outcome: { runId: queued.record.event.eventId, status: 'queued',
                    reason: 'Verified capability wakeup was durably queued for the autonomy supervisor.' },
                error: null };
            const record = await coordinator.submit({ ...event,
                sourceKey: `${event.sourceKey}:attempt:${now}` }, now);
            if (!record.gate.accepted || !record.outcome || record.outcome.status === 'skipped' || record.error) {
                await store.releaseWakeup(wakeup, now);
            }
            return record;
        } catch (error) {
            await store.releaseWakeup(wakeup, now);
            throw error;
        }
    }));
}
