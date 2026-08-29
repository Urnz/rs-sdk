import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { observeLiveState } from '../../../agent-state/live.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { listAdminAgents } from './agent-state.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import { agentStateDbPath, llmReplanLogPath } from './paths.js';
import { AgentReplanCoordinator, type ReplanOutcome, type ReplanRecord } from './replan-coordinator.js';
import type { GatewayBotSnapshot } from './types.js';

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
                const result = await runAdminLlmDryRun(current, refreshed.skills, { now, runId: event.eventId,
                    untrustedText: event.type === 'offer-received' ? [event.summary] : [] });
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
