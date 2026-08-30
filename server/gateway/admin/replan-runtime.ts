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

function useStore<T>(callback: (store: AgentStateStore) => T): T {
    const store = new AgentStateStore(agentStateDbPath);
    try { return callback(store); }
    finally { store.close(); }
}

export function createGatewayAgentReplanCoordinator(gatewayBots: () => Map<string, GatewayBotSnapshot>,
    append: (record: ReplanRecord) => Promise<void> = appendReplanRecord): AgentReplanCoordinator {
    return new AgentReplanCoordinator({
        resolveAgentId: async playerUsername => useStore(store => store.listIdentities()
            .find(identity => identity.playerUsername === playerUsername.toLowerCase())?.agentId ?? null),
        listAgentIds: async () => useStore(store => store.listIdentities().map(identity => identity.agentId)),
        plan: async (agentId: string, event: LlmReplanEvent): Promise<ReplanOutcome> => {
            const initial = await listAdminAgents();
            const agent = initial.agents.find(entry => entry.identity.agentId === agentId);
            if (!agent) return { runId: event.eventId, status: 'skipped', reason: 'Agent state no longer exists.' };
            const gateway = [...gatewayBots().entries()]
                .find(([name]) => name.toLowerCase() === agent.identity.playerUsername)?.[1];
            if (!gateway?.state?.player || gateway.status !== 'active'
                || Date.now() - gateway.lastStateReceivedAt > 5_000) {
                return { runId: event.eventId, status: 'skipped', reason: 'No fresh online world state is available.' };
            }
            const now = new Date().toISOString();
            useStore(store => {
                const previous = store.getWorkingMemory(agentId);
                store.setWorkingMemory(agentId, previous?.revision ?? null, observeLiveState(gateway.state!, now), now);
            });
            const refreshed = await listAdminAgents();
            const current = refreshed.agents.find(entry => entry.identity.agentId === agentId);
            if (!current) return { runId: event.eventId, status: 'skipped', reason: 'Agent state disappeared before planning.' };
            try {
                const immediate = current.goals.filter(goal => goal.status === 'active' && goal.horizon === 'immediate')
                    .sort((left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0];
                if (immediate) {
                    const deterministic = await resolveLearnAndPlan(agentId, immediate, current.catalogSkills,
                        current.knownSkills, { now });
                    if (deterministic?.decision.kind === 'execute-skill') {
                        return { runId: event.eventId, status: 'deterministic', decision: deterministic.decision,
                            reason: `Resolved without an LLM call; learned=${deterministic.learned}, assigned=${deterministic.assigned}.` };
                    }
                }
                const result = await runAdminLlmDryRun(current, current.catalogSkills, { now, runId: event.eventId,
                    untrustedText: event.type === 'offer-received' ? [event.summary] : [], automatic: true,
                    capabilityGapStore: new CapabilityGapStore(capabilityGapsPath) });
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
