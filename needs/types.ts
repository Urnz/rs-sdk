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
