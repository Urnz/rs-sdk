import { existsSync } from 'node:fs';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { ReplanRecord } from './replan-coordinator.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { agentStateDbPath, replanInboxDbPath } from './paths.js';
import { economicContractsDbPath } from './paths.js';
import { EconomicContractStore } from './economic-contracts.js';

export type AgentTimelineKind = 'wake-up' | 'decision' | 'policy-result' | 'parameter-binding'
    | 'skill-action' | 'evidence' | 'memory-update' | 'goal-update' | 'domain-action' | 'next-wake-up';

export interface AgentTimelineEntry {
    id: string;
    timestamp: string;
    kind: AgentTimelineKind;
    status: string;
    summary: string;
    correlation: { eventId?: string; decisionId?: string; runId?: string; goalId?: string; sourceId?: string };
    details: Record<string, unknown>;
}

export interface AgentTimelineOptions {
    agentPath?: string; inboxPath?: string; economicContractsPath?: string; limit?: number;
}

function terminal(value: string | null): ReplanRecord | null {
    if (!value) return null;
    try { return JSON.parse(value) as ReplanRecord; } catch { return null; }
}

/** Read-only projection over authoritative ledgers; it creates no new timeline state. */
export function readAgentTimeline(agentId: string, options: AgentTimelineOptions = {}) {
    const limit = options.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Agent timeline limit is invalid');
    const store = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    const entries: AgentTimelineEntry[] = [];
    try {
        const identity = store.getIdentity(agentId);
        if (!identity) throw new Error('Unknown agent timeline');
        const inboxPath = options.inboxPath ?? replanInboxDbPath;
        if (existsSync(inboxPath)) {
            const inbox = new ReplanInboxStore(inboxPath);
            try {
                for (const item of inbox.listForAgent(identity.agentId, 1_000)) {
                    entries.push({ id: `wake-up:${item.event.eventId}`, timestamp: item.createdAt,
                        kind: 'wake-up', status: item.status, summary: item.event.summary,
                        correlation: { eventId: item.event.eventId }, details: { eventType: item.event.type,
                            sourceKey: item.event.sourceKey, payloadDigest: item.payloadDigest,
                            attempt: item.attempt, lastError: item.lastError } });
                    const record = terminal(item.terminalOutcome);
                    if (record) entries.push({ id: `policy:${item.event.eventId}`, timestamp: item.updatedAt,
                        kind: 'policy-result', status: record.error ? 'error' : record.outcome?.status ?? record.gate.reason,
                        summary: record.error ?? record.outcome?.reason ?? `Event gate: ${record.gate.reason}.`,
                        correlation: { eventId: item.event.eventId, decisionId: item.event.eventId,
                            ...(record.outcome?.runId ? { runId: record.outcome.runId } : {}) },
                        details: { gate: record.gate, decision: record.outcome?.decision ?? null } });
                }
            } finally { inbox.close(); }
        }
        for (const decision of store.listDecisions(identity.agentId)) entries.push({
            id: `decision:${decision.decisionId}`, timestamp: decision.occurredAt, kind: 'decision', status: 'admitted',
            summary: `${decision.trigger} decision admitted.`, correlation: { decisionId: decision.decisionId },
            details: { contextDigest: decision.contextDigest, llmCostMicros: decision.llmCostMicros,
                operationalBudgetGp: decision.operationalBudgetGp, profileRevision: decision.profileRevision }
        });
        for (const dispatch of store.listSkillDispatches(identity.agentId)) {
            entries.push({ id: `binding:${dispatch.runId}`, timestamp: dispatch.createdAt,
                kind: 'parameter-binding', status: 'bound',
                summary: `${dispatch.skill.id}@${dispatch.skill.version} bound from ${dispatch.binding.sourceKind}.`,
                correlation: { decisionId: dispatch.decisionId, runId: dispatch.runId,
                    goalId: dispatch.goalId, sourceId: dispatch.binding.sourceId },
                details: { skill: dispatch.skill, binding: dispatch.binding,
                    policyId: dispatch.policyId, policyVersion: dispatch.policyVersion } });
            const outcome = store.getSkillRunOutcome(dispatch.runId);
            entries.push({ id: `skill:${dispatch.runId}`, timestamp: outcome?.occurredAt ?? dispatch.createdAt,
                kind: outcome ? 'evidence' : 'skill-action', status: outcome?.status ?? 'dispatched',
                summary: outcome?.detail ?? `${dispatch.skill.id}@${dispatch.skill.version} dispatched.`,
                correlation: { decisionId: dispatch.decisionId, runId: dispatch.runId, goalId: dispatch.goalId },
                details: { skill: dispatch.skill, classification: outcome?.classification ?? null } });
        }
        for (const event of store.listGoalEvents(identity.agentId)) entries.push({
            id: `goal:${event.sequence}`, timestamp: event.occurredAt, kind: 'goal-update', status: event.status,
            summary: `${event.goalId}: ${event.kind}.`, correlation: { goalId: event.goalId },
            details: { previousStatus: event.previousStatus, revision: event.revision, skill: event.skill }
        });
        for (const episode of store.listEpisodes(identity.agentId, { limit: 500 })) entries.push({
            id: `memory:${episode.episodeId}`, timestamp: episode.occurredAt, kind: 'memory-update',
            status: episode.trust, summary: episode.summary, correlation: {}, details: {
                episodeId: episode.episodeId, episodeKind: episode.kind, source: episode.source,
                goalIds: episode.goalIds, externalKey: episode.externalKey }
        });
        for (const request of store.listPlayerActionRequests(identity.agentId)) entries.push({
            id: `domain:player-action:${request.requestId}`, timestamp: request.updatedAt,
            kind: 'domain-action', status: request.status, summary: request.objective,
            correlation: { sourceId: request.requestId, ...(request.runId ? { runId: request.runId } : {}) },
            details: { requesterAgentId: request.requesterAgentId, assigneeAgentId: request.assigneeAgentId,
                rewardGp: request.rewardGp, settlementId: request.settlementId, revision: request.revision }
        });
        const contractsPath = options.economicContractsPath ?? economicContractsDbPath;
        if (existsSync(contractsPath)) {
            const contracts = new EconomicContractStore(contractsPath);
            try {
                for (const contract of contracts.listContracts(500).filter(item =>
                    item.partyAAgentId === identity.agentId || item.partyBAgentId === identity.agentId)) {
                    entries.push({ id: `domain:contract:${contract.contractId}`,
                        timestamp: contract.resolvedAt ?? contract.fulfilledAt ?? contract.acceptedAt,
                        kind: 'domain-action', status: contract.status, summary: contract.title,
                        correlation: { sourceId: contract.contractId }, details: {
                            kind: contract.kind, termsDigest: contract.termsDigest, revision: contract.revision,
                            partyASatisfied: contract.partyASatisfied, partyBSatisfied: contract.partyBSatisfied,
                            evidenceRunIds: contract.evidence.map(item => item.runId),
                            settlementIds: contract.settlements.map(item => item.settlementId),
                            escrowIds: contract.playerEscrows.map(item => item.escrowId)
                        } });
                }
            } finally { contracts.close(); }
        }
        const enrollment = store.getAutonomyEnrollment(identity.agentId);
        if (enrollment) entries.push({ id: `next-wake:${enrollment.revision}`, timestamp: enrollment.updatedAt,
            kind: 'next-wake-up', status: enrollment.status,
            summary: enrollment.nextWakeupAt ? `Next wake-up at ${enrollment.nextWakeupAt}.`
                : `No next wake-up while ${enrollment.status}.`, correlation: {},
            details: { nextWakeupAt: enrollment.nextWakeupAt, leaseExpiresAt: enrollment.leaseExpiresAt,
                failureCount: enrollment.failureCount, quarantineReason: enrollment.quarantineReason,
                policyId: enrollment.policyId, policyVersion: enrollment.policyVersion } });
    } finally { store.close(); }
    entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id));
    return { agentId: agentId.toLowerCase(), entries: entries.slice(0, limit), generatedAt: new Date().toISOString() };
}
