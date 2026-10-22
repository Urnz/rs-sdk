import { join } from 'node:path';
import type { AgentPopulationMember } from '../agent-state/types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { NeedsStore } from '../needs/store.js';
import { populationNeedsBinding } from '../needs/population-binding.js';
import { evaluateSurvivalDeficit, loadSurvivalProfile, type SurvivalMeal } from '../needs/survival.js';
import { NativeFoodSource, assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { healthDigest } from '../population-health/policy.js';
import { evaluatePopulationAge, type PopulationAgePolicy } from './age.js';
import { createStarvationDeathEvidence, type PopulationDeathEvidence } from './death.js';

/** Re-read canonical consumptions, including commits not yet projected by the
 * gateway. The immutable needs admission is the initial condition, not a
 * second nutrition wallet or a wall-time hunger accumulator. */
export function readPopulationStarvation(options: { workspace: string; worldId: string; checkpointPath: string },
    member: AgentPopulationMember, clock: SimulationClockObservation) {
    const selected = loadSurvivalProfile(options.workspace); if (!selected) return null;
    const binding = populationNeedsBinding(options.worldId, member);
    if (clock.clockId !== binding.clockId || clock.profileDigest !== binding.clockProfileDigest
        || clock.profileDigest !== selected.selection.clockProfileDigest) throw new Error('Starvation clock/lifecycle binding differs');
    const path = join(options.workspace, '.local/simulation/food-needs.sqlite');
    assertNativeFoodDomainPath({ ...options, checkpointPath: path });
    const needs = new NeedsStore(path, selected.policy, selected.dynamics, { readonly: true });
    let source: NativeFoodSource | undefined;
    try {
        const current = needs.get(binding); if (!current) throw new Error('Starvation requires an admitted needs source');
        const initial = needs.atRevision(binding, 1);
        if (initial.state.values.find(v => v.needId === 'hunger')?.value !== 0 || initial.terminal
            || current.state.observedAtSimulationTime > clock.simulationTime) throw new Error('Starvation admission/time differs');
        source = new NativeFoodSource(options);
        return source.snapshot(() => {
            const journal = source!.current(), meals: SurvivalMeal[] = [];
            if (current.lastFoodReceipt) {
                const anchor = journal.entries[current.lastFoodReceipt.sequence - 1];
                if (journal.sourceId !== current.lastFoodReceipt.sourceId || anchor?.digest !== current.lastFoodReceipt.sourceDigest
                    || anchor.actionId !== current.lastFoodReceipt.actionId) throw new Error('Starvation nutrition source was replaced/truncated');
            }
            for (const entry of journal.entries) {
                const { result } = source!.delivery(entry.sequence), action = result.action;
                if (entry.legacy || !entry.clock) throw new Error('Starvation cannot certify a legacy nutrition source');
                if (action.actorId !== binding.actorId && action.username !== binding.playerId) continue;
                if (action.actorId !== binding.actorId || action.username !== binding.playerId || action.lifecycleId !== binding.lifecycleId
                    || action.clockId !== binding.clockId || action.clockProfileDigest !== binding.clockProfileDigest)
                    throw new Error('Starvation meal identity differs');
                if (entry.clock.simulationTime > clock.simulationTime) throw new Error('Starvation source is ahead of the world clock');
                if (result.outcome === 'consumed') meals.push({ actionId: action.actionId, atSimulationTime: entry.clock.simulationTime, sourceDigest: entry.digest });
            }
            const result = evaluateSurvivalDeficit(selected.rules, initial.state.observedAtSimulationTime, clock.simulationTime, meals);
            return { ...result, binding, rules: selected.rules, admissionDigest: initial.admissionDigest,
                sourceId: journal.sourceId, sourceSequence: journal.entries.length, sourceHead: journal.entries.at(-1)?.digest ?? null,
                evidenceDigest: healthDigest({ binding, admission: initial.admissionDigest, result,
                    sourceId: journal.sourceId, sourceSequence: journal.entries.length, sourceHead: journal.entries.at(-1)?.digest ?? null }) };
        });
    } finally { source?.close(); needs.close(); }
}

export function createPopulationStarvationDeath(options: Parameters<typeof readPopulationStarvation>[0],
    member: AgentPopulationMember, clock: SimulationClockObservation, age: PopulationAgePolicy): PopulationDeathEvidence | null {
    evaluatePopulationAge(member, clock, age);
    if (member.status !== 'active' || member.characterLifecycle.status !== 'active') return null;
    const proof = readPopulationStarvation(options, member, clock);
    if (!proof?.deathAt) return null;
    const cause = { kind: 'starvation' as const, survivalPolicyDigest: proof.policyDigest, nutritionEvidenceDigest: proof.evidenceDigest,
        admittedAt: proof.admittedAt, deficitSimulationMilliseconds: proof.deficitSimulationMilliseconds };
    return createStarvationDeathEvidence(member, clock, age, cause, proof.deathAt);
}
