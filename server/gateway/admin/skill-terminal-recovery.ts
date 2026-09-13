import { AgentStateStore } from '../../../agent-state/store.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { agentStateDbPath, skillRunsDir } from './paths.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { readSkillRun, readSkillRunHistory, type AdminSkillRun } from './skill-history.js';
import type { SkillMarkerReconciliation } from './supervisor.js';
import { skillParameterDigest } from '../../../agent-state/skill-binding.js';
import { classifyAutonomousExecutionFailure } from './autonomous-skill-binding.js';
import { recoverGoalEventWakeups } from './goal-event-recovery.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { capabilityGapsPath } from './paths.js';
import { economicContractsDbPath } from './paths.js';
import { EconomicContractStore } from './economic-contracts.js';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { finishAdminPlayerActionRun } from './agent-state.js';

export interface SkillTerminalRecoveryOptions {
    agentPath?: string;
    skillRunRoot?: string;
    loadRuns?: () => Promise<AdminSkillRun[]>;
    loadRun?: (runId: string) => Promise<AdminSkillRun | null>;
    capabilityGapPath?: string;
    economicContractsPath?: string;
}

export interface OrphanedSkillRecoveryResult {
    examinedMarkers: number;
    createdEventIds: string[];
    existingEventIds: string[];
    journaledRunIds: string[];
}

export interface SkillTerminalRecoveryResult {
    scannedRuns: number;
    matchedEnrollments: number;
    reconciledWorkOrderRunIds: string[];
    createdEventIds: string[];
    existingEventIds: string[];
}

function loadRunningEnrollments(path: string) {
    const store = new AgentStateStore(path);
    try {
        return store.listAutonomyEnrollments('running').flatMap(enrollment => {
            const avatar = store.getControlProfile(enrollment.agentId)?.avatarPlayerUsername;
            return avatar ? [{ enrollment, avatar: avatar.toLowerCase() }] : [];
        });
    } finally { store.close(); }
}

function terminalEvent(agentId: string, run: AdminSkillRun): LlmReplanEvent {
    const successful = run.status === 'completed';
    const detail = (run.message || run.reason || run.status).replace(/\s+/g, ' ').trim().slice(0, 600);
    return { eventId: run.runId, agentId, type: successful ? 'skill-finished' : 'skill-failed',
        sourceKey: `skill:${run.runId}:terminal`, occurredAt: run.finishedAt,
        summary: `${run.skill.id}@${run.skill.version} ${run.status}: ${detail}`.slice(0, 1_000),
        selectionSeed: `skill-terminal:${run.runId}` };
}

/**
 * Rebuilds only terminal events that can belong to a currently running durable lease.
 * Historical unrelated runs are deliberately ignored.
 */
export async function recoverSkillTerminalWakeups(inboxPath: string,
    options: SkillTerminalRecoveryOptions = {}): Promise<SkillTerminalRecoveryResult> {
    const running = loadRunningEnrollments(options.agentPath ?? agentStateDbPath);
    const runs = await (options.loadRuns ?? (() => readSkillRunHistory(500,
        options.skillRunRoot ?? skillRunsDir, 1)))();
    const store = new ReplanInboxStore(inboxPath);
    const result: SkillTerminalRecoveryResult = { scannedRuns: runs.length,
        matchedEnrollments: 0, reconciledWorkOrderRunIds: [], createdEventIds: [], existingEventIds: [] };
    try {
        for (const { enrollment, avatar } of running) {
            const candidates = runs.filter(run => run.username === avatar
                && Date.parse(run.startedAt) >= Date.parse(enrollment.updatedAt))
                .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
            if (candidates.length === 0) continue;
            result.matchedEnrollments++;
            for (const run of candidates) {
                let effectiveRun = run;
                const agentStore = new AgentStateStore(options.agentPath ?? agentStateDbPath);
                try {
                    const dispatch = agentStore.getSkillDispatch(run.runId);
                    if (dispatch) {
                        const parametersMatch = run.parameters !== null && run.parameters !== undefined
                            && skillParameterDigest(run.parameters) === dispatch.binding.digest;
                        const skillMatches = run.skill.id === dispatch.skill.id && run.skill.version === dispatch.skill.version;
                        const detail = !skillMatches ? 'Terminal journal skill does not match its durable dispatch.'
                            : !parametersMatch ? 'Terminal journal parameters do not match their durable dispatch digest.'
                                : run.message || run.reason || run.status;
                        const status = skillMatches && parametersMatch ? run.status : 'failed';
                        const failure = status === 'completed' || !skillMatches || !parametersMatch ? null
                            : classifyAutonomousExecutionFailure(
                                run.events.findLast(event => event.type === 'step.failed')?.code, detail);
                        const classification = status === 'completed' ? 'completed'
                            : (!skillMatches || !parametersMatch) ? 'authorization' : failure!.disposition;
                        const recorded = agentStore.recordSkillRunOutcome(run.runId, status, classification, detail, run.finishedAt);
                        if (status === 'completed' && dispatch.binding.sourceKind === 'contract-obligation') {
                            const contractPath = options.economicContractsPath
                                ?? (options.agentPath ? join(dirname(options.agentPath), 'economic-contracts.sqlite')
                                    : economicContractsDbPath);
                            if (!existsSync(contractPath)) throw new Error('Bound economic contract store is unavailable');
                            const avatars = new Map(agentStore.listIdentities().map(identity => [identity.agentId,
                                agentStore.getControlProfile(identity.agentId)?.avatarPlayerUsername ?? null]));
                            const contracts = new EconomicContractStore(contractPath);
                            try {
                                contracts.recordRunEvidence(dispatch.binding.sourceId, dispatch.agentId,
                                    effectiveRun, avatars, run.finishedAt);
                            } finally { contracts.close(); }
                        }
                        if (recorded.created && failure?.gapKind === 'procedure') {
                            const goal = agentStore.getGoal(dispatch.goalId);
                            await new CapabilityGapStore(options.capabilityGapPath ?? capabilityGapsPath).report({
                                agentId: dispatch.agentId, goalId: dispatch.goalId,
                                anchorGoalId: goal?.parentGoalId ?? dispatch.goalId,
                                title: `Repair ${dispatch.skill.id} capability`, description: detail,
                                tags: ['terminal-failure', 'skill-capability'], worldVersion: 'lostcity-local'
                            }, run.finishedAt);
                        }
                        if (!skillMatches || !parametersMatch) effectiveRun = { ...run, status: 'failed',
                            reason: detail, message: detail };
                    }
                } finally { agentStore.close(); }
                const workOrder = finishAdminPlayerActionRun(effectiveRun.runId,
                    effectiveRun.status === 'completed',
                    effectiveRun.message || effectiveRun.reason || effectiveRun.status,
                    options.agentPath ?? agentStateDbPath,
                    effectiveRun.status === 'completed' ? randomUUID() : null);
                if (workOrder) result.reconciledWorkOrderRunIds.push(effectiveRun.runId);
                const queued = store.enqueue(terminalEvent(enrollment.agentId, effectiveRun), run.finishedAt);
                (queued.created ? result.createdEventIds : result.existingEventIds).push(queued.record.event.eventId);
            }
        }
    } finally { store.close(); }
    // Goal completion is committed first; its append-only event is then translated
    // by the same restart-safe path used for every other goal transition.
    recoverGoalEventWakeups(inboxPath, options.agentPath ?? agentStateDbPath);
    return result;
}

/** Converts only proven-dead, exact-lease markers without a terminal journal into failure wakeups. */
export async function recoverOrphanedSkillWakeups(inboxPath: string,
    markers: SkillMarkerReconciliation[], options: SkillTerminalRecoveryOptions = {}): Promise<OrphanedSkillRecoveryResult> {
    const running = loadRunningEnrollments(options.agentPath ?? agentStateDbPath);
    const orphaned = markers.filter(item => item.status === 'stale-removed' && item.snapshot);
    const result: OrphanedSkillRecoveryResult = { examinedMarkers: orphaned.length,
        createdEventIds: [], existingEventIds: [], journaledRunIds: [] };
    const store = new ReplanInboxStore(inboxPath);
    try {
        for (const marker of orphaned) {
            const snapshot = marker.snapshot!;
            const owner = running.find(item => item.avatar === marker.username.toLowerCase()
                && Date.parse(snapshot.startedAt) >= Date.parse(item.enrollment.updatedAt));
            if (!owner) continue;
            const journal = await (options.loadRun ?? (runId => readSkillRun(runId,
                options.skillRunRoot ?? skillRunsDir, 1)))(snapshot.runId);
            if (journal) {
                result.journaledRunIds.push(snapshot.runId);
                continue;
            }
            const queued = store.enqueue({ eventId: snapshot.runId, agentId: owner.enrollment.agentId,
                type: 'skill-failed', sourceKey: `skill:${snapshot.runId}:terminal`,
                occurredAt: snapshot.startedAt,
                summary: `${snapshot.skill} became orphaned after its trusted marker PID exited without a terminal journal.`,
                selectionSeed: `skill-terminal:${snapshot.runId}` });
            (queued.created ? result.createdEventIds : result.existingEventIds).push(queued.record.event.eventId);
        }
        return result;
    } finally { store.close(); }
}
