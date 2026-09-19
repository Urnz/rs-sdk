export const SIMULATION_CLOCK_SCHEMA_VERSION = 1 as const;
export const SIMULATION_CLOCK_STORE_SCHEMA_VERSION = 4 as const;

export type SimulationClockStatus = 'running' | 'paused';

export interface SimulationClockRate {
    simulationMilliseconds: number;
    wallMilliseconds: number;
}

export interface SimulationClockProfile {
    schemaVersion: typeof SIMULATION_CLOCK_SCHEMA_VERSION;
    profileId: string;
    version: string;
    seed: string;
    rate: SimulationClockRate;
}

export interface SimulationClockState {
    schemaVersion: typeof SIMULATION_CLOCK_SCHEMA_VERSION;
    clockId: string;
    profile: SimulationClockProfile;
    profileDigest: string;
    status: SimulationClockStatus;
    anchorWallTime: string;
    anchorSimulationTime: string;
    lastObservedWallTime: string;
    lastSimulationTime: string;
    nextEventSequence: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface SimulationClockObservation {
    clockId: string;
    wallTime: string;
    simulationTime: string;
    engineTick: number | null;
    status: SimulationClockStatus;
    profileDigest: string;
    revision: number;
}

export interface SimulationEventStamp extends SimulationClockObservation {
    sequence: number;
}

export interface BoundSimulationEventStamp extends SimulationEventStamp {
    domain: string;
    sourceId: string;
    sourceDigest: string;
}

export interface BindSimulationEventInput {
    clockId: string;
    domain: string;
    sourceId: string;
    sourceDigest: string;
    wallTime: string;
    engineTick?: number;
}

export interface CreateSimulationClockInput {
    clockId: string;
    profile: SimulationClockProfile;
    wallTime: string;
    simulationTime: string;
    status?: SimulationClockStatus;
}

export type PlayerPresence = 'online' | 'offline';
export type PlayerRestState = 'awake' | 'sleeping';
export type SleeperKind = 'npc-agent' | 'human-player';
export type SleepAccessKind = 'physical-presence' | 'bed-entitlement';

export interface SleepAccessEvidence {
    kind: SleepAccessKind;
    evidenceId: string;
    sourceDigest: string;
    validUntilSimulationTime: string | null;
}

export interface StartPlayerSleepInput {
    sleeperKind: SleeperKind;
    sleepPlaceId: string;
    access: SleepAccessEvidence;
}

export interface PlayerSleepContext extends StartPlayerSleepInput {
    startedAtSimulationTime: string;
}

export interface PlayerTimeState {
    clockId: string;
    playerId: string;
    presence: PlayerPresence;
    rest: PlayerRestState;
    sleepContext: PlayerSleepContext | null;
    offlineDelegation: 'disabled';
    presenceChangedAt: string;
    restChangedAt: string;
    updatedAt: string;
    updatedWallTime: string;
    revision: number;
}

export interface PlayerTimeCapabilities {
    worldClockAdvances: true;
    physicalExecutionAllowed: boolean;
    offlineDelegationAllowed: false;
    reason: string;
}
