export const NEEDS_SCHEMA_VERSION = 1 as const;
export const CORE_NEED_IDS = ['hunger', 'fatigue'] as const;
export type CoreNeedId = typeof CORE_NEED_IDS[number];

export interface NeedDefinition {
    needId: string;
    label: string;
    minimumValue: 0;
    maximumValue: number;
    initialValue: number;
    criticalThreshold: number;
}

export interface NeedsPolicyDefinition {
    schemaVersion: typeof NEEDS_SCHEMA_VERSION;
    policyId: string;
    version: string;
    needs: NeedDefinition[];
}

export interface NeedsPolicy extends NeedsPolicyDefinition {
    digest: string;
}

export interface NeedsPolicyCatalog {
    schemaVersion: typeof NEEDS_SCHEMA_VERSION;
    policies: NeedsPolicy[];
}

export interface NeedValue {
    needId: string;
    value: number;
    /** Fractional rate numerator carried with a fixed 3,600,000 denominator. */
    remainderNumerator: number;
}

export interface NeedsStateDefinition {
    schemaVersion: typeof NEEDS_SCHEMA_VERSION;
    stateId: string;
    version: string;
    characterAgentId: string;
    clockId: string;
    observedAtSimulationTime: string;
    policy: { policyId: string; version: string; digest: string };
    values: NeedValue[];
}

export interface NeedsState extends NeedsStateDefinition {
    digest: string;
}

export const NEEDS_DYNAMICS_SCHEMA_VERSION = 1 as const;

export interface NeedRateRule {
    needId: string;
    onlineAwakePerHour: number;
    offlineAwakePerHour: number;
    onlineSleepingPerHour: number;
    offlineSleepingPerHour: number;
}

export interface NeedsDynamicsPolicyDefinition {
    schemaVersion: typeof NEEDS_DYNAMICS_SCHEMA_VERSION;
    policyId: string;
    version: string;
    needsPolicy: { policyId: string; version: string };
    rules: NeedRateRule[];
}

export interface NeedsDynamicsPolicy extends NeedsDynamicsPolicyDefinition {
    digest: string;
}

export interface NeedsDynamicsPolicyCatalog {
    schemaVersion: typeof NEEDS_DYNAMICS_SCHEMA_VERSION;
    policies: NeedsDynamicsPolicy[];
}

export interface NeedTransitionDelta {
    needId: string;
    before: number;
    ratePerSimulationHour: number;
    appliedDelta: number;
    after: number;
}

export interface NeedsTransitionDefinition {
    schemaVersion: typeof NEEDS_DYNAMICS_SCHEMA_VERSION;
    previousStateDigest: string;
    clockId: string;
    fromSimulationTime: string;
    toSimulationTime: string;
    elapsedSimulationMilliseconds: number;
    presence: 'online' | 'offline';
    rest: 'awake' | 'sleeping';
    dynamicsPolicy: { policyId: string; version: string; digest: string };
    deltas: NeedTransitionDelta[];
    state: NeedsState;
}

export interface NeedsTransition extends NeedsTransitionDefinition {
    digest: string;
}

export interface AvailableFoodCandidate {
    itemId: number;
    inventorySlot: number;
    quantity: number;
    hungerRelief: number;
}

export interface AvailableSleepPlaceCandidate {
    sleepPlaceId: string;
    available: boolean;
    accessAllowed: boolean;
    fatigueRecoveryPerHour: number;
    safetyLevel: number;
}

export interface SelfMaintenanceObservation {
    foods: AvailableFoodCandidate[];
    sleepPlaces: AvailableSleepPlaceCandidate[];
}

export type SelfMaintenanceAction =
    | { operation: 'consume-food'; itemId: number; inventorySlot: number; quantity: 1; hungerRelief: number }
    | { operation: 'seek-sleep-place'; sleepPlaceId: string; fatigueRecoveryPerHour: number };

export type SelfMaintenanceDecisionKind = 'consume-food' | 'seek-sleep-place' | 'blocked' | 'none';

export interface SelfMaintenanceDecisionDefinition {
    kind: SelfMaintenanceDecisionKind;
    decisionSource: 'deterministic-needs-routine';
    llmCallRequired: false;
    stateDigest: string;
    criticalNeedId: 'hunger' | 'fatigue' | null;
    reasonCode: 'food-selected' | 'sleep-place-selected' | 'critical-resource-unavailable' | 'no-critical-need';
    action: SelfMaintenanceAction | null;
}

export interface SelfMaintenanceDecision extends SelfMaintenanceDecisionDefinition {
    digest: string;
}
