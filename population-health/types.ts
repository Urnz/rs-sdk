import type { AgentPopulationMember } from '../agent-state/types.js';
import type { PlayerTimeState, SimulationClockObservation } from '../simulation-clock/types.js';
import type { PopulationAgePolicy } from '../population-lifecycle/age.js';

export interface HealthPolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    agePolicy: { policyId: string; version: string; digest: string };
    recoveryBurdenPerSimulationHour: number;
    treatmentRequiredBurden: number;
    untreatedRecoveryFloor: number;
    criticalBurden: number;
    maximumOpenInjuries: number;
    treatments: Array<{ treatmentId: string; skill: { id: string; version: string; checksum: string };
        capabilityId: string; minimumHerbloreLevel: number; reliefBurden: number }>;
}
export interface HealthPolicy extends HealthPolicyDefinition { digest: string }
export interface HealthInjury {
    injuryId: string;
    sourceEventId: string;
    originalBurden: number;
    remainingBurden: number;
    treatmentRequired: boolean;
    treated: boolean;
}
export interface PopulationHealthState {
    agentId: string;
    membershipDigest: string;
    clockId: string;
    clockProfileDigest: string;
    policy: { policyId: string; version: string; digest: string };
    observedAtSimulationTime: string;
    latestInjuryAtSimulationTime: string;
    injuries: HealthInjury[];
    recoveryRemainder: number;
    revision: number;
}
export interface PopulationHealthView {
    sourceStatus?: 'verified' | 'unavailable' | 'pending';
    state: PopulationHealthState;
    status: 'well' | 'injured' | 'critical' | 'inactive';
    injuryBurden: number;
    restRequired: boolean;
    treatmentRequired: boolean;
    workloadCapacityBasisPoints: number;
}
export interface HealthContext {
    member: AgentPopulationMember;
    clock: SimulationClockObservation;
    agePolicy: PopulationAgePolicy;
    policy: HealthPolicy;
    playerTime: PlayerTimeState | null;
}
