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
import { assertManagedModuleRoot, managedContext } from '../../../control-plane/instance-context.js';
import { FOOD_ITEM, FOOD_POLICY, foodDigest, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { createPopulationStarvationDeath } from '../../../../population-lifecycle/starvation.js';
import { loadSurvivalProfile } from '../../../../needs/survival.js';
import { resolve } from 'node:path';
import type { AgentPopulationMember } from '../../../../agent-state/types.js';

const root = new URL('../../../../', import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, root));
let runtime: ReturnType<typeof openRuntime> | null = null;
let failed = false;
let completedMortalityPass:{clock:SimulationClockObservation;local:ReturnType<typeof openRuntime>;source:PlayerHealthEvidenceStore}|null=null;
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
function clockObservation(engineTick?: number): SimulationClockObservation {
    const local = getRuntime()!;
    return local.shared.store.observeNow(local.shared.clockId, engineTick);
}
export function populationFoodTickClock(engineTick: number): SimulationClockObservation | null {
    const local = getRuntime();
    if (!local || !local.agents.listPopulationMembers().length) return null;
    return clockObservation(engineTick);
}
/** Observer roster, including offline/terminal members; never infers membership from connected avatars. */
export function populationMiningCoverageRoster() {
    assertManagedModuleRoot(fileURLToPath(root));
    const local=getRuntime();if(!local)throw Error('Population roster unavailable');
    return local.agents.listPopulationMembers().map(member=>({actorId:member.agentId,username:member.playerUsername,
        lifecycleId:foodDigest({agentId:member.agentId,createdAt:member.characterLifecycle.createdAt,origin:member.characterLifecycle.origin,
            createdAtSimulationTime:member.characterLifecycle.createdAtSimulationTime,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest,
            worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,simulationClock:member.simulationClock}),
        worldId:managedContext()?.id??`local:${foodDigest(fileURLToPath(root))}`,clockId:member.simulationClock.clockId,
        clockProfileDigest:member.simulationClock.profileDigest}));
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

/** Native food uses the existing population identity and clock authorities, never a caller-supplied receipt. */
export function populationFoodContext(username: string, actionId: string, slot: number, engineTick: number): NativeFoodContext | null {
    assertManagedModuleRoot(fileURLToPath(root));
    const member = memberFor(username);
    if (!member) return null;
    if (populationAvatarRestricted(username)) throw new Error('Terminal population avatar cannot consume food');
    const clock = clockObservation(engineTick);
    if (loadSurvivalProfile(fileURLToPath(root))) {
        const local = getRuntime()!;
        admitPopulationStarvation(member, clock, engineHealthRuntime(), local.age, local.mortality, starvationOptions());
        if (engineHealthRuntime().deathFor(username)) throw new Error('Starved population avatar cannot act');
    }
    if (clock.clockId !== member.simulationClock.clockId || clock.profileDigest !== member.simulationClock.profileDigest)
        throw new Error('Native food population clock mismatch');
    return { action: { actionId, worldId: managedContext()?.id ?? `local:${foodDigest(fileURLToPath(root))}`,
        actorId: member.agentId, username, lifecycleId: foodDigest({ agentId: member.agentId,
            createdAt: member.characterLifecycle.createdAt, origin: member.characterLifecycle.origin,
            createdAtSimulationTime: member.characterLifecycle.createdAtSimulationTime,
            sourceResultId: member.sourceResultId, sourceResultDigest: member.sourceResultDigest,
            worldProfile: member.worldProfile, lifecyclePolicy: member.lifecyclePolicy, simulationClock: member.simulationClock }),
        itemId: FOOD_ITEM, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY),
        clockId: clock.clockId, clockProfileDigest: clock.profileDigest }, clock };
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
export function admitPopulationStarvation(member: AgentPopulationMember, clock: SimulationClockObservation,
    source: PlayerHealthEvidenceStore, age: PopulationAgePolicy, mortality: PopulationMortalityPolicy,
    options: Parameters<typeof createPopulationStarvationDeath>[0]): boolean {
    if (source.deathFor(member.playerUsername) || member.status !== 'active' || member.characterLifecycle.status !== 'active') return false;
    const event = createPopulationStarvationDeath(options, member, clock, age);
    if (!event) return false;
    const natural = evaluatePopulationMortality(member, clock, age, mortality);
    if (natural.candidate?.due && natural.candidate.atSimulationTime <= event.atSimulationTime) return false;
    source.bindFiniteAvatar(member); source.recordStarvationDeath(event); return true;
}
function starvationOptions() {
    const workspace = fileURLToPath(root);
    return { workspace, worldId: managedContext()?.id ?? `local:${foodDigest(workspace)}`,
        checkpointPath: resolve(workspace, 'server/engine', process.env.PLAYER_CHECKPOINT_DATABASE ?? process.env.GE_DATABASE ?? 'data/player-checkpoints.sqlite') };
}
export function populationAvatarIsFinite(username: string): boolean { return !!memberFor(username); }

/** Runtime identity/profile lookup, never an LLM-supplied profile or an averaged legacy default. */
export function populationAttributeContext(username: string, engineTick: number) {
    assertManagedModuleRoot(fileURLToPath(root));
    const member = memberFor(username);
    if (!member) return null;
    if (populationAvatarRestricted(username)) throw new Error('Terminal population avatar cannot gain XP');
    const binding = getRuntime()!.agents.getCharacterAttributes(member.agentId);
    if (!binding) throw new Error('Population character attributes are missing; explicit migration required');
    const clock = clockObservation(engineTick);
    if (clock.clockId !== binding.clockId || clock.profileDigest !== binding.clockProfileDigest)
        throw new Error('Character attribute clock mismatch');
    return { binding, clock, worldId: managedContext()?.id ?? `local:${foodDigest(fileURLToPath(root))}` };
}

/** Called before any world/client/NPC execution. Offline members are included. */
export function tickPopulationDeaths(engineTick: number): void {
    completedMortalityPass=null;
    try {
        const source = engineHealthRuntime(), local = getRuntime();
        if (local) {
            const clock = clockObservation(engineTick);
            for (const candidate of local.agents.listPopulationMembers()) {
                const member = memberFor(candidate.playerUsername)!;
                if (!member) throw new Error('Population member disappeared');
                if (loadSurvivalProfile(fileURLToPath(root))) admitPopulationStarvation(member, clock, source, local.age, local.mortality, starvationOptions());
            }
            admitNaturalPopulationDeaths(local.agents, clock, source, local.age, local.mortality);
            completedMortalityPass={clock,local,source};
        }
        failed = false;
    } catch (error) { failed = true; throw error; }
}

/** Only the successful current native tick can donate an observer witness. Does not run mortality or admit gameplay. */
export function nativePopulationMortalityPass(engineTick:number){
    const pass=completedMortalityPass;if(failed||!pass||pass.clock.engineTick!==engineTick)throw Error('No completed native mortality pass for this tick');
    return{clock:pass.clock,members:pass.local.agents.listPopulationMembers(),source:pass.source,agePolicyDigest:pass.local.age.digest,
        mortalityPolicyDigest:pass.local.mortality.digest,survivalSelectionDigest:loadSurvivalProfile(fileURLToPath(root))?.selection.digest??null};
}

export function populationAvatarRestricted(username: string): boolean {
    if (failed) return true;
    if (engineHealthRuntime().deathFor(username)) return true;
    const member = memberFor(username);
    if (member && member.status === 'active' && member.characterLifecycle.status === 'active' && loadSurvivalProfile(fileURLToPath(root))) {
        const local = getRuntime()!;
        admitPopulationStarvation(member, clockObservation(), engineHealthRuntime(), local.age, local.mortality, starvationOptions());
        if (engineHealthRuntime().deathFor(username)) return true;
    }
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
