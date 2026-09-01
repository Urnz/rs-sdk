import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { observeLiveState } from '../../../agent-state/live.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { listAdminAgents } from './agent-state.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import { agentStateDbPath, capabilityGapsPath, llmReplanLogPath } from './paths.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { AgentReplanCoordinator, type ReplanOutcome, type ReplanRecord } from './replan-coordinator.js';
import type { GatewayBotSnapshot } from './types.js';
import { resolveLearnAndPlan } from './deterministic-learning.js';
import { resolveSkillForCapability } from '../../../agent-skills/capability-gaps.js';
import { createAdminGoalProposal } from './agent-state.js';
import { loadLlmRuntimeConfig } from './llm-settings.js';
import { resolveAdminSkillForAgent, validateAdminSkillParameters } from './skill-catalog.js';
import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';
import type { SkillDefinition, SkillStep } from '../../../agent-skills/types.js';
import type { BotSupervisor } from './supervisor.js';
import type { AdminAgentSkillCatalogOptions } from './skill-catalog.js';

let appendTail: Promise<void> = Promise.resolve();

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

function useStore<T>(callback: (store: AgentStateStore) => T, path = agentStateDbPath): T {
    const store = new AgentStateStore(path);
    try { return callback(store); }
    finally { store.close(); }
}

export interface GatewayAgentReplanOptions {
    agentPath?: string;
    capabilityGapPath?: string;
    llmConfigPath?: string;
    skillCatalog?: AdminAgentSkillCatalogOptions;
}

const FORBIDDEN_AUTONOMOUS_OPERATIONS = new Set(['buy-from-shop', 'sell-to-shop', 'trade-give-item']);

export function evaluateAutonomousSkillPolicy(config: LlmAutonomousExecutionConfig,
    definition: SkillDefinition): { allowed: boolean; reason: string } {
    const reference = `${definition.id}@${definition.version}`;
    if (!config.enabled) return { allowed: false, reason: 'Autonomous execution is disabled.' };
    if (!config.allowedSkills.some(skill => skill.id === definition.id && skill.version === definition.version)) {
        return { allowed: false, reason: `${reference} is not on the exact autonomous allowlist.` };
    }
    if (definition.status !== 'verified') return { allowed: false, reason: `${reference} is not verified.` };
    if (definition.limits.maxOperations > config.maxOperations || definition.limits.timeoutMs > config.maxTimeoutMs) {
        return { allowed: false, reason: `${reference} exceeds the autonomous operation or time limit.` };
    }
    const inspect = (steps: SkillStep[]): string | null => {
        for (const step of steps) {
            if (step.kind === 'call') return 'Composed skill calls are not allowed in the initial autonomous policy.';
            if (step.kind === 'repeat') { const nested = inspect(step.steps); if (nested) return nested; continue; }
            if (FORBIDDEN_AUTONOMOUS_OPERATIONS.has(step.operation)) {
                return `Operation ${step.operation} is forbidden for autonomous execution.`;
            }
        }
        return null;
    };
    const unsafe = inspect(definition.steps);
    return unsafe ? { allowed: false, reason: unsafe } : { allowed: true, reason: `${reference} passed autonomous policy.` };
}

export function createGatewayAgentReplanCoordinator(gatewayBots: () => Map<string, GatewayBotSnapshot>,
    supervisor: BotSupervisor,
    append: (record: ReplanRecord) => Promise<void> = appendReplanRecord,
    options: GatewayAgentReplanOptions = {}): AgentReplanCoordinator {
    const agentPath = options.agentPath ?? agentStateDbPath;
    const gapPath = options.capabilityGapPath ?? capabilityGapsPath;
    const listAgents = () => listAdminAgents(agentPath, { skillCatalog: options.skillCatalog });
    return new AgentReplanCoordinator({
        resolveAgentId: async playerUsername => useStore(store => store.listIdentities()
            .find(identity => identity.playerUsername === playerUsername.toLowerCase())?.agentId ?? null, agentPath),
        listAgentIds: async () => useStore(store => store.listIdentities().map(identity => identity.agentId), agentPath),
        plan: async (agentId: string, event: LlmReplanEvent): Promise<ReplanOutcome> => {
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
            const now = new Date().toISOString();
            useStore(store => {
                const previous = store.getWorkingMemory(agentId);
                store.setWorkingMemory(agentId, previous?.revision ?? null, observeLiveState(gateway.state!, now), now);
            }, agentPath);
            const refreshed = await listAgents();
            const current = refreshed.agents.find(entry => entry.identity.agentId === agentId);
            if (!current) return { runId: event.eventId, status: 'skipped', reason: 'Agent state disappeared before planning.' };
            try {
                const immediate = current.goals.filter(goal => goal.status === 'active' && goal.horizon === 'immediate')
                    .sort((left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0];
                const config = (await loadLlmRuntimeConfig(options.llmConfigPath ? {
                    defaultConfigPath: options.llmConfigPath,
                    overrideConfigPath: `${options.llmConfigPath}.override`
                } : {})).config;
                if (!config.automaticReplanning) return { runId: event.eventId, status: 'skipped',
                    reason: 'Automatic replanning is disabled.' };
                const deterministicResolution = immediate ? resolveSkillForCapability(immediate,
                    current.catalogSkills.map(skill => ({ ...skill, status: 'verified' as const,
                        visibility: 'shared' as const })), current.knownSkills.map(item => ({
                        ...item.skill, status: item.status }))) : null;
                const expectedCost = deterministicResolution ? 0 : config.limits.maxCostMicros;
                useStore(store => store.recordDecision(agentId, current.controlProfile.revision, {
                    decisionId: event.eventId, trigger: 'event', llmCostMicros: expectedCost,
                    operationalBudgetGp: 0
                }, now), agentPath);
                if (immediate) {
                    const deterministic = await resolveLearnAndPlan(agentId, immediate, current.catalogSkills,
                        current.knownSkills, { now, agentPath, catalog: options.skillCatalog });
                    if (deterministic?.decision.kind === 'execute-skill') {
                        const requested = `${deterministic.resolution.skill.id}@${deterministic.resolution.skill.version}`;
                        const candidate = await resolveAdminSkillForAgent(requested, agentId, options.skillCatalog);
                        const policy = evaluateAutonomousSkillPolicy(config.autonomousExecution, candidate.definition);
                        if (!policy.allowed) return { runId: event.eventId, status: 'approval-required',
                            decision: deterministic.decision, reason: policy.reason };
                        const parameters = validateAdminSkillParameters(candidate.definition, {});
                        const process = await supervisor.startSkill(avatar, requested, parameters, { runId: crypto.randomUUID() });
                        return { runId: process.runId, status: 'executing',
                            decision: deterministic.decision, reason: policy.reason };
                    }
                }
                const result = await runAdminLlmDryRun(current, current.catalogSkills, { now, runId: event.eventId,
                    untrustedText: event.type === 'offer-received' ? [event.summary] : [], automatic: true,
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
                    const policy = evaluateAutonomousSkillPolicy(config.autonomousExecution, candidate.definition);
                    if (!policy.allowed) return { runId: result.plan.runId, status: 'approval-required',
                        decision: result.plan.decision, reason: policy.reason };
                    const parameters = validateAdminSkillParameters(candidate.definition, {});
                    const process = await supervisor.startSkill(avatar, requested, parameters, { runId: crypto.randomUUID() });
                    return { runId: process.runId, status: 'executing', decision: result.plan.decision,
                        reason: policy.reason };
                }
                return { runId: result.plan.runId, status: result.plan.status,
                    decision: result.plan.decision, reason: result.plan.reason };
            } catch (error) {
                return { runId: event.eventId, status: 'skipped',
                    reason: error instanceof Error ? error.message : String(error) };
            }
        },
        append
    });
}

export async function dispatchVerifiedCapabilityWakeups(coordinator: AgentReplanCoordinator,
    store = new CapabilityGapStore(capabilityGapsPath), now = new Date().toISOString()): Promise<ReplanRecord[]> {
    const wakeups = await store.claimVerifiedWakeups(100, now);
    return Promise.all(wakeups.map(async wakeup => {
        try {
            const record = await coordinator.submit({ eventId: crypto.randomUUID(), agentId: wakeup.agentId,
                type: 'capability-ready',
                sourceKey: `capability:${wakeup.gapId}:${wakeup.agentId}:${wakeup.anchorGoalId}:attempt:${now}`,
                occurredAt: now, summary: `Capability ${wakeup.gapId} is ready as ${wakeup.resolvedSkill.id}@${wakeup.resolvedSkill.version}.`
            }, now);
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
