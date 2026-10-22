import { createHash } from 'node:crypto';
import type { AgentPopulationMember } from '../agent-state/types.js';
import type { NeedsBinding } from './store.js';
export function populationNeedsBinding(worldId: string, member: AgentPopulationMember): NeedsBinding {
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return { worldId, actorId: member.agentId, playerId: member.playerUsername, lifecycleId: digest({ agentId: member.agentId,
        createdAt: member.characterLifecycle.createdAt, origin: member.characterLifecycle.origin,
        createdAtSimulationTime: member.characterLifecycle.createdAtSimulationTime,
        sourceResultId: member.sourceResultId, sourceResultDigest: member.sourceResultDigest,
        worldProfile: member.worldProfile, lifecyclePolicy: member.lifecyclePolicy, simulationClock: member.simulationClock }),
        clockId: member.simulationClock.clockId, clockProfileDigest: member.simulationClock.profileDigest,
        worldProfileDigest: member.worldProfile.digest, lifecyclePolicyDigest: member.lifecyclePolicy.digest };
}
