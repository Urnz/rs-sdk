import { AgentStateStore } from '../../../agent-state/store.js';
import { agentStateDbPath } from './paths.js';

export interface ControllerAdmission {
    allowed: boolean;
    preemptExisting: boolean;
    reason: string;
}

export function decideControllerAdmission(liveAutonomyLease: boolean,
    existingControllers: number): ControllerAdmission {
    if (!Number.isInteger(existingControllers) || existingControllers < 0) {
        throw new Error('Existing controller count is invalid');
    }
    if (liveAutonomyLease && existingControllers > 0) return { allowed: false, preemptExisting: false,
        reason: 'An autonomy lease already owns the avatar controller.' };
    return { allowed: true, preemptExisting: existingControllers > 0,
        reason: existingControllers > 0 ? 'Manual last-controller-wins compatibility applies.' : 'Controller slot is free.' };
}

export function avatarHasLiveAutonomyLease(username: string, now = new Date().toISOString(),
    path = agentStateDbPath): boolean {
    const timestamp = Date.parse(now);
    if (Number.isNaN(timestamp)) throw new Error('Controller admission time must be an ISO timestamp');
    const store = new AgentStateStore(path);
    try {
        const identity = store.listIdentities().find(item => item.playerUsername === username.toLowerCase());
        if (!identity) return false;
        const enrollment = store.getAutonomyEnrollment(identity.agentId);
        return enrollment?.status === 'running' && !!enrollment.leaseExpiresAt
            && Date.parse(enrollment.leaseExpiresAt) > timestamp;
    } finally { store.close(); }
}
