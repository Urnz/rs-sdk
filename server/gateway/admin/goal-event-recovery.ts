import { AgentStateStore } from '../../../agent-state/store.js';
import type { AgentGoal, AgentGoalEvent } from '../../../agent-state/types.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { AgentReplanCoordinator } from './replan-coordinator.js';
import { enqueueDurableReplan } from './durable-replan-coordinator.js';
import { agentStateDbPath } from './paths.js';
import { ReplanInboxStore } from './replan-inbox.js';

export interface GoalWakeupRecoveryResult {
    scannedEvents: number;
    createdEventIds: string[];
    existingEventIds: string[];
}

function replanEvent(event: AgentGoalEvent, goal: AgentGoal): LlmReplanEvent | null {
    const newImmediate = event.kind === 'created' && goal.horizon === 'immediate'
        && goal.status === 'active' && goal.revision === event.revision;
    const ended = event.kind === 'status-changed'
        && (event.status === 'completed' || event.status === 'blocked' || event.status === 'abandoned');
    if (!newImmediate && !ended) return null;
    return { eventId: crypto.randomUUID(), agentId: event.agentId, type: 'goal-changed',
        sourceKey: `goal:${event.goalId}:event:${event.sequence}:at:${event.occurredAt}`, occurredAt: event.occurredAt,
        summary: newImmediate
            ? `Immediate goal ${event.goalId} became active at revision ${event.revision}.`
            : `Goal ${event.goalId} changed to ${event.status} at revision ${event.revision}.`,
        selectionSeed: `goal-event:${event.goalId}:${event.sequence}` };
}

function enrolledGoalEvents(path: string): Array<{ event: AgentGoalEvent; goal: AgentGoal }> {
    const store = new AgentStateStore(path);
    try {
        const output: Array<{ event: AgentGoalEvent; goal: AgentGoal }> = [];
        for (const enrollment of store.listAutonomyEnrollments()
            .filter(item => item.status === 'desired' || item.status === 'running')) {
            const events = store.listGoalEvents(enrollment.agentId, enrollment.createdAt);
            if (events.length > 1_000) throw new Error(`Goal wakeup recovery exceeds 1000 events for ${enrollment.agentId}`);
            for (const event of events) {
                const goal = store.getGoal(event.goalId);
                if (goal) output.push({ event, goal });
            }
        }
        return output;
    } finally { store.close(); }
}

/** Rebuilds durable wakeups from the AgentState goal-event ledger after commits or restart. */
export function recoverGoalEventWakeups(inboxPath: string, agentPath = agentStateDbPath): GoalWakeupRecoveryResult {
    const source = enrolledGoalEvents(agentPath);
    const inbox = new ReplanInboxStore(inboxPath);
    const result: GoalWakeupRecoveryResult = { scannedEvents: source.length,
        createdEventIds: [], existingEventIds: [] };
    try {
        for (const { event, goal } of source) {
            const wakeup = replanEvent(event, goal);
            if (!wakeup) continue;
            const queued = inbox.enqueue(wakeup, event.occurredAt);
            (queued.created ? result.createdEventIds : result.existingEventIds).push(queued.record.event.eventId);
        }
        return result;
    } finally { inbox.close(); }
}

/** Fast path after a committed mutation; periodic ledger recovery remains the crash-safe fallback. */
export function enqueueLatestGoalEventWakeup(coordinator: AgentReplanCoordinator, agentId: string,
    goalId: string, agentPath = agentStateDbPath): boolean {
    const store = new AgentStateStore(agentPath);
    try {
        const enrollment = store.getAutonomyEnrollment(agentId);
        if (!enrollment || (enrollment.status !== 'desired' && enrollment.status !== 'running')) return false;
        const goal = store.getGoal(goalId);
        const event = store.listGoalEvents(agentId).filter(item => item.goalId === goalId).at(-1);
        const wakeup = goal && event && event.occurredAt >= enrollment.createdAt ? replanEvent(event, goal) : null;
        return wakeup ? !!enqueueDurableReplan(coordinator, wakeup, event!.occurredAt) : false;
    } finally { store.close(); }
}
