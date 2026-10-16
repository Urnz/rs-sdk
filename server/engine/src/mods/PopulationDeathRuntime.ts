import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../../../agent-state/store.js';
import { openSimulationClockRuntime } from '../../../../simulation-clock/config.js';
import { loadPopulationAgePolicy } from '../../../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy, evaluatePopulationMortality, type PopulationMortalityPolicy } from '../../../../population-lifecycle/mortality.js';
import type { PopulationAgePolicy } from '../../../../population-lifecycle/age.js';
import type { PlayerHealthEvidenceStore } from './PlayerHealthEvidenceStore.js';
import { createPopulationDeathEvidence } from '../../../../population-lifecycle/death.js';
import { loadPopulationWorldProfileBindingCatalog } from '../../../../population-lifecycle/config.js';
import { engineHealthRuntime, type EngineHealthDamage } from './PlayerHealthEvidenceStore.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

const root = new URL('../../../../', import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, root));
let runtime: ReturnType<typeof openRuntime> | null = null;
let failed = false;
function openRuntime() {
    if (!existsSync(path('.local/simulation/simulation-clock.sqlite'))) throw new Error('Finite population clock is unavailable');
    const shared = openSimulationClockRuntime(path('config/simulation-clock.json'), path('.local/simulation/simulation-clock.sqlite'));
    let agents: AgentStateStore | null = null;
    try {
        agents = new AgentStateStore(path('.local/agent-state/agents.sqlite'), shared);
        return { agents, shared, age: loadPopulationAgePolicy(path('config/population-age-policy.json')),
            mortality: loadPopulationMortalityPolicy(path('config/population-mortality-policy.json')),
            bindings: loadPopulationWorldProfileBindingCatalog(path('config/population-world-profile-bindings.json')) };
    } catch (error) { agents?.close(); shared.store.close(); throw error; }
}
function getRuntime() {
    if (!existsSync(path('.local/agent-state/agents.sqlite'))) {
        if (runtime) throw new Error('Population identity source disappeared');
        return null;
    }
    return runtime ??= openRuntime();
}
function clockObservation(engineTick: number): SimulationClockObservation {
    const local = getRuntime()!; const prior = local.shared.store.get(local.shared.clockId)!;
    return local.shared.store.observe(local.shared.clockId,
        new Date(Math.max(Date.now(), Date.parse(prior.lastObservedWallTime))).toISOString(), engineTick);
}
function memberFor(username: string) {
    const local = getRuntime();
    if (!local) {
        if (engineHealthRuntime().finiteAvatar(username)) throw new Error('Finite avatar identity source is missing');
        return null;
    }
    const members = local.agents.listPopulationMembers().filter(member => member.playerUsername === username.toLowerCase());
    if (members.length > 1) throw new Error('Avatar has conflicting population memberships');
    const member = members[0];
    if (!member) {
        if (engineHealthRuntime().finiteAvatar(username)) throw new Error('Finite avatar membership disappeared');
        return null;
    }
    const binding = local.bindings.bindings.find(item => item.worldProfileId === member.worldProfile.profileId);
    if (!binding || binding.worldProfileDigest !== member.worldProfile.digest || binding.worldProfileVersion !== member.worldProfile.version
        || binding.policyDigest !== member.lifecyclePolicy.digest || binding.policyId !== member.lifecyclePolicy.policyId
        || binding.policyVersion !== member.lifecyclePolicy.version) throw new Error('Engine finite population binding is stale');
    return member;
}

export function admitNaturalPopulationDeaths(agents: AgentStateStore, clock: SimulationClockObservation,
    source: PlayerHealthEvidenceStore, age: PopulationAgePolicy, mortality: PopulationMortalityPolicy): number {
    let admitted = 0;
    for (const member of agents.listPopulationMembers()) {
        source.bindFiniteAvatar(member);
        if (member.status !== 'active' || member.characterLifecycle.status !== 'active' || source.deathFor(member.playerUsername)) continue;
        const proposal = evaluatePopulationMortality(member, clock, age, mortality);
        if (proposal.candidate?.due) {
            source.recordNaturalDeath(createPopulationDeathEvidence(member, clock, age, mortality)); admitted++;
        }
    }
    return admitted;
}
export function populationAvatarIsFinite(username: string): boolean { return !!memberFor(username); }

/** Called before any world/client/NPC execution. Offline members are included. */
export function tickPopulationDeaths(engineTick: number): void {
    try {
        const source = engineHealthRuntime(), local = getRuntime();
        if (local) {
            const clock = clockObservation(engineTick);
            for (const candidate of local.agents.listPopulationMembers()) {
                const member = memberFor(candidate.playerUsername)!;
                if (!member) throw new Error('Population member disappeared');
            }
            admitNaturalPopulationDeaths(local.agents, clock, source, local.age, local.mortality);
        }
        failed = false;
    } catch (error) { failed = true; throw error; }
}

export function populationAvatarRestricted(username: string): boolean {
    if (failed) return true;
    if (engineHealthRuntime().deathFor(username)) return true;
    const member = memberFor(username);
    return !!member && (member.status !== 'active' || member.characterLifecycle.status !== 'active');
}

/** Lethal damage and the permanent closure latch share one SQLite commit. */
export function recordPopulationDamage(input: Omit<EngineHealthDamage, 'eventId'>): boolean {
    if (populationAvatarRestricted(input.username)) throw new Error('Terminal population avatar cannot act');
    const member = memberFor(input.username), eventId = randomUUID(), local = member && getRuntime()!;
    if (member) engineHealthRuntime().bindFiniteAvatar(member);
    const death = member && input.hpAfter === 0 ? createPopulationDeathEvidence(member, clockObservation(input.engineTick),
        local!.age, local!.mortality, { damageEventId: eventId, sessionId: input.sessionId, engineTick: input.engineTick }) : undefined;
    engineHealthRuntime().record(input, eventId, death);
    return !!death;
}
