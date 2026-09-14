import { createHash } from 'node:crypto';
import { SIMULATION_CLOCK_SCHEMA_VERSION, type SimulationClockProfile } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`);
    }
}

function boundedInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 86_400_000) {
        throw new Error(`${label} must be an integer between 1 and 86400000`);
    }
    return value as number;
}

function identifier(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(value)) {
        throw new Error(`${label} is invalid`);
    }
    return value;
}

export function validateSimulationClockProfile(value: unknown): SimulationClockProfile {
    if (!record(value)) throw new Error('Simulation clock profile must be an object');
    exactKeys(value, ['schemaVersion', 'profileId', 'version', 'seed', 'rate'], 'Simulation clock profile');
    if (value.schemaVersion !== SIMULATION_CLOCK_SCHEMA_VERSION) {
        throw new Error(`Unsupported simulation clock profile schema version: ${String(value.schemaVersion)}`);
    }
    if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value.version)) {
        throw new Error('Simulation clock profile version must be semantic');
    }
    if (typeof value.seed !== 'string' || value.seed.length < 1 || value.seed.length > 256
        || value.seed.trim() !== value.seed) {
        throw new Error('Simulation clock profile seed is invalid');
    }
    if (!record(value.rate)) throw new Error('Simulation clock rate must be an object');
    exactKeys(value.rate, ['simulationMilliseconds', 'wallMilliseconds'], 'Simulation clock rate');
    return { schemaVersion: SIMULATION_CLOCK_SCHEMA_VERSION,
        profileId: identifier(value.profileId, 'Simulation clock profile id'), version: value.version,
        seed: value.seed, rate: {
            simulationMilliseconds: boundedInteger(value.rate.simulationMilliseconds,
                'Simulation milliseconds'),
            wallMilliseconds: boundedInteger(value.rate.wallMilliseconds, 'Wall milliseconds')
        } };
}

export function simulationClockProfileDigest(value: SimulationClockProfile): string {
    const profile = validateSimulationClockProfile(value);
    return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}
