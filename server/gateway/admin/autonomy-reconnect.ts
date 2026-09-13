import { AgentStateStore } from '../../../agent-state/store.js';
import type { AgentReplanCoordinator } from './replan-coordinator.js';
import { enqueueDurableReplan } from './durable-replan-coordinator.js';
import { agentStateDbPath } from './paths.js';

export interface AutonomyReconnectWakeupOptions {
    agentPath?: string;
    now?: string;
}

export interface AutonomyReconnectWakeupResult {
    status: 'created' | 'existing' | 'ignored' | 'unsupported';
    agentId: string | null;
    eventId: string | null;
}

/** Enqueues inert reconnect evidence. The autonomy supervisor remains the sole lease claimant. */
export function enqueueAutonomyReconnectWakeup(coordinator: AgentReplanCoordinator,
    playerUsername: string, connectionId: string,
    options: AutonomyReconnectWakeupOptions = {}): AutonomyReconnectWakeupResult {
    const now = options.now ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(now))) throw new Error('Autonomy reconnect time must be an ISO timestamp');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
        throw new Error('Autonomy reconnect connection id must be a UUID');
    }
    const store = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    try {
        const username = playerUsername.toLowerCase();
        const identity = store.listIdentities().find(item => item.playerUsername === username);
        const enrollment = identity ? store.getAutonomyEnrollment(identity.agentId) : null;
        if (!identity || (enrollment?.status !== 'desired' && enrollment?.status !== 'running')) {
            return { status: 'ignored', agentId: identity?.agentId ?? null, eventId: null };
        }
        const eventId = crypto.randomUUID();
        const queued = enqueueDurableReplan(coordinator, { eventId, agentId: identity.agentId,
            type: 'autonomy-reconnect', sourceKey: `autonomy:reconnect:${connectionId}`, occurredAt: now,
            summary: 'The enrolled avatar published its first fresh state after reconnect.',
            selectionSeed: `autonomy-reconnect:${connectionId}` }, now);
        if (!queued) return { status: 'unsupported', agentId: identity.agentId, eventId: null };
        return { status: queued.created ? 'created' : 'existing', agentId: identity.agentId,
            eventId: queued.record.event.eventId };
    } finally { store.close(); }
}
