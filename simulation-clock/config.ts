import { readFileSync } from 'node:fs';
import { simulationClockProfileDigest, validateSimulationClockProfile } from './profile.js';
import { SimulationClockStore } from './store.js';
import type { SimulationClockProfile } from './types.js';

export interface SimulationClockRuntimeConfig {
    schemaVersion: 1;
    clockId: string;
    initialSimulationTime: string;
    profile: SimulationClockProfile;
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalTimestamp(value: unknown): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
        || new Date(Date.parse(value)).toISOString() !== value) {
        throw new Error('Initial simulation time must be a canonical UTC ISO timestamp');
    }
    return value;
}

export function validateSimulationClockRuntimeConfig(value: unknown): SimulationClockRuntimeConfig {
    if (!record(value) || value.schemaVersion !== 1 || typeof value.clockId !== 'string'
        || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(value.clockId)
        || Object.keys(value).sort().join(',') !== 'clockId,initialSimulationTime,profile,schemaVersion') {
        throw new Error('Simulation clock runtime config is invalid');
    }
    return { schemaVersion: 1, clockId: value.clockId,
        initialSimulationTime: canonicalTimestamp(value.initialSimulationTime),
        profile: validateSimulationClockProfile(value.profile) };
}

export function loadSimulationClockRuntimeConfig(path: string): SimulationClockRuntimeConfig {
    return validateSimulationClockRuntimeConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function openSimulationClockRuntime(configPath: string, databasePath: string,
    wallTime = new Date().toISOString()): { store: SimulationClockStore; clockId: string; created: boolean } {
    const config = loadSimulationClockRuntimeConfig(configPath);
    const store = new SimulationClockStore(databasePath);
    try {
        const existing = store.get(config.clockId);
        if (!existing) {
            store.create({ clockId: config.clockId, profile: config.profile, wallTime,
                simulationTime: config.initialSimulationTime });
            return { store, clockId: config.clockId, created: true };
        }
        if (existing.profileDigest !== simulationClockProfileDigest(config.profile)) {
            throw new Error('Persisted simulation clock profile differs from config; use an explicit revisioned reconfiguration');
        }
        return { store, clockId: config.clockId, created: false };
    } catch (error) {
        store.close();
        throw error;
    }
}
