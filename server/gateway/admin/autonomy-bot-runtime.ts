import type { BotSupervisor } from './supervisor.js';
import type { GatewayBotSnapshot } from './types.js';

export interface AutonomyBotReconciliation {
    ready: boolean;
    status: 'adopted' | 'starting' | 'spawned' | 'controller-conflict' | 'failed';
    reason: string;
}

/** Ensures an enrolled avatar has one usable bot session without handling credentials itself. */
export async function ensureAutonomyBotSession(username: string,
    gatewayBots: () => Map<string, GatewayBotSnapshot>, supervisor: BotSupervisor,
    nowMs = Date.now()): Promise<AutonomyBotReconciliation> {
    const gateway = [...gatewayBots().entries()]
        .find(([name]) => name.toLowerCase() === username.toLowerCase())?.[1];
    if (gateway?.status === 'active' && gateway.connected && gateway.state?.player
        && nowMs - gateway.lastStateReceivedAt <= 5_000) {
        if (gateway.controllers > 0) return { ready: false, status: 'controller-conflict',
            reason: `${username} already has ${gateway.controllers} active controller(s).` };
        return { ready: true, status: 'adopted', reason: `${username} has a fresh controller-free gateway session.` };
    }
    const process = supervisor.snapshot(username);
    if (process?.status === 'starting' || process?.status === 'running' || process?.status === 'stopping') {
        return { ready: false, status: 'starting',
            reason: `${username} has a managed bot process waiting for a fresh session.` };
    }
    try {
        await supervisor.spawn({ username });
        return { ready: false, status: 'spawned',
            reason: `${username} was started from its local bot.env and is waiting for fresh state.` };
    } catch (error) {
        return { ready: false, status: 'failed',
            reason: error instanceof Error ? error.message : String(error) };
    }
}
