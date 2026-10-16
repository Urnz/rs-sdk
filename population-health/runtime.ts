import { existsSync } from 'node:fs';
import type { AgentStateStore, AgentStateSimulationClock } from '../agent-state/store.js';
import type { PopulationAgePolicy } from '../population-lifecycle/age.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { PopulationHealthStore } from './store.js';
import type { HealthContext, HealthPolicy, PopulationHealthView } from './types.js';

export interface PopulationHealthRuntimeOptions {
    statePath: string;
    engineEvidencePath: string;
    policy: HealthPolicy;
}

/** A local engine source failure blocks recovery instead of implying that there were no injuries. */
export function runPopulationHealthCycle(agents: AgentStateStore, shared: AgentStateSimulationClock,
    agePolicy: PopulationAgePolicy, options: PopulationHealthRuntimeOptions,
    now = new Date().toISOString()): { byAgent: Map<string, PopulationHealthView>; sourceAvailable: boolean; pending: boolean } {
    const health = new PopulationHealthStore(options.statePath);
    let source: PlayerHealthEvidenceStore | null = null;
    let blockCurrentObservation: (() => void) | null = null;
    try {
        const members = agents.listPopulationMembers(), byAgent = new Map<string, PopulationHealthView>();
        const context = (agentId: string): HealthContext => {
            const clock = shared.store.get(shared.clockId)!;
            const member = agents.getPopulationMember(agentId)!;
            return { member, policy: options.policy, agePolicy,
                clock: { clockId: clock.clockId, profileDigest: clock.profileDigest, simulationTime: clock.lastSimulationTime,
                    wallTime: clock.lastObservedWallTime, status: clock.status, revision: clock.revision, engineTick: null },
                playerTime: shared.store.getPlayerTimeState(shared.clockId, member.playerUsername) };
        };
        blockCurrentObservation = () => { for (const member of members) health.advance(context(member.agentId), false); };
        const clockState = shared.store.get(shared.clockId);
        if (!clockState) throw new Error('Population health requires the shared clock');
        shared.store.observe(shared.clockId, now < clockState.lastObservedWallTime ? clockState.lastObservedWallTime : now);
        if (!existsSync(options.engineEvidencePath)) {
            for (const member of members) {
                // No new domain state is synthesized from a missing source.
                if (health.events().some(event => event.agentId === member.agentId)) {
                    const view = health.advance(context(member.agentId), false);
                    if (view) byAgent.set(member.agentId, { ...view, sourceStatus: 'unavailable' });
                }
            }
            return { byAgent, sourceAvailable: false, pending: false };
        }
        source = new PlayerHealthEvidenceStore(options.engineEvidencePath, true);
        const cursor = health.sourceCursor('local-engine-health');
        if (cursor.sequence > 0) {
            const anchor = source.list(cursor.sequence - 1, 1)[0];
            if (!anchor || anchor.sequence !== cursor.sequence || anchor.eventDigest !== cursor.eventDigest) {
                throw new Error('Population health engine source was truncated/replaced');
            }
        }
        const events = source.list(cursor.sequence, 1000);
        for (const event of events) {
            const candidates = members.filter(member => member.playerUsername === event.username
                && member.status === 'active' && member.characterLifecycle.status === 'active'
                && event.occurredAt >= member.createdAt);
            if (candidates.length > 1) throw new Error('Engine damage avatar has multiple active population identities');
            const member = candidates[0];
            if (member) {
                const currentClock = shared.store.get(shared.clockId)!;
                shared.store.bindEvent({ clockId: shared.clockId, domain: 'population-health-engine-damage', sourceId: event.eventId,
                    sourceDigest: event.eventDigest, wallTime: event.occurredAt < currentClock.lastObservedWallTime
                        ? currentClock.lastObservedWallTime : event.occurredAt, engineTick: event.engineTick });
                health.ingestDamage(context(member.agentId), event);
            }
            health.acknowledgeSource('local-engine-health', event.sequence, event.eventDigest);
        }
        const pending = source.list(health.sourceCursor('local-engine-health').sequence, 1).length > 0;
        const ready = source.isReady(now);
        for (const member of members) {
            const view = health.advance(context(member.agentId), ready && !pending);
            if (view) byAgent.set(member.agentId, { ...view, sourceStatus: !ready ? 'unavailable' : pending ? 'pending' : 'verified' });
        }
        return { byAgent, sourceAvailable: ready, pending };
    } catch (error) {
        try { blockCurrentObservation?.(); }
        catch (blockedError) { throw new AggregateError([error, blockedError], String(error)); }
        throw error;
    } finally { source?.close(); health.close(); }
}
