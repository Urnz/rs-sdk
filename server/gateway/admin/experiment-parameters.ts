import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { experimentParametersDbPath } from './paths.js';

export type ExperimentParameterOrigin = 'manual' | 'grid-search' | 'automated' | 'learning';

export interface ExperimentParameterSet {
    respawns: Array<{ targetKey: string; ticks: number }>;
    xpRewards: Array<{ activityKey: string; multiplier: number }>;
    marketPrices: Array<{ itemId: number; itemName: string; buyGp: number | null; sellGp: number | null }>;
    finishedProducts: Array<{ itemId: number; itemName: string; valueGp: number }>;
}

export interface ExperimentParameterProfile {
    schemaVersion: 1;
    profileId: string;
    version: string;
    label: string;
    description: string;
    origin: ExperimentParameterOrigin;
    parameters: ExperimentParameterSet;
    digest: string;
    createdAt: string;
}

export interface CreateExperimentParameterProfile {
    profileId: string;
    version: string;
    label: string;
    description?: string;
    origin: ExperimentParameterOrigin;
    parameters: ExperimentParameterSet;
}

interface ProfileRow {
    profile_id: string; version: string; label: string; description: string;
    origin: ExperimentParameterOrigin; parameters_json: string; digest: string; created_at: string;
}

const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const KEY = /^[a-z0-9][a-z0-9 .:_/-]{0,119}$/i;

function text(value: unknown, field: string, maximum: number): string {
    if (typeof value !== 'string') throw new Error(`${field} is required`);
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain 1-${maximum} characters`);
    return normalized;
}

function timestamp(value: string): string {
    if (Number.isNaN(Date.parse(value))) throw new Error('Experiment parameter timestamp must be ISO formatted');
    return new Date(value).toISOString();
}

function unique<T>(values: T[], key: (value: T) => string, field: string): T[] {
    const seen = new Set<string>();
    for (const value of values) {
        const id = key(value);
        if (seen.has(id)) throw new Error(`${field} contains duplicate key ${id}`);
        seen.add(id);
    }
    return values;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function canonicalParameters(input: ExperimentParameterSet): ExperimentParameterSet {
    if (!input || typeof input !== 'object') throw new Error('Experiment parameters are required');
    const bounded = (value: unknown, field: string, maximum: number): unknown[] => {
        if (!Array.isArray(value) || value.length > maximum) throw new Error(`${field} must be a bounded array`);
        return value;
    };
    const respawns = unique(bounded(input.respawns, 'respawns', 500).map((entry, index) => {
        if (!entry || typeof entry !== 'object') throw new Error(`respawns[${index}] is invalid`);
        const row = entry as Record<string, unknown>;
        const targetKey = text(row.targetKey, `respawns[${index}].targetKey`, 120).toLocaleLowerCase('en-US');
        if (!KEY.test(targetKey)) throw new Error(`respawns[${index}].targetKey is invalid`);
        return { targetKey, ticks: integer(row.ticks, `respawns[${index}].ticks`, 1, 12_000) };
    }), value => value.targetKey, 'respawns').sort((a, b) => a.targetKey.localeCompare(b.targetKey));
    const xpRewards = unique(bounded(input.xpRewards, 'xpRewards', 500).map((entry, index) => {
        if (!entry || typeof entry !== 'object') throw new Error(`xpRewards[${index}] is invalid`);
        const row = entry as Record<string, unknown>;
        const activityKey = text(row.activityKey, `xpRewards[${index}].activityKey`, 120).toLocaleLowerCase('en-US');
        if (!KEY.test(activityKey) || typeof row.multiplier !== 'number' || !Number.isFinite(row.multiplier)
            || row.multiplier < 0 || row.multiplier > 10) throw new Error(`xpRewards[${index}] is invalid`);
        return { activityKey, multiplier: Number(row.multiplier.toFixed(6)) };
    }), value => value.activityKey, 'xpRewards').sort((a, b) => a.activityKey.localeCompare(b.activityKey));
    const marketPrices = unique(bounded(input.marketPrices, 'marketPrices', 2_000).map((entry, index) => {
        if (!entry || typeof entry !== 'object') throw new Error(`marketPrices[${index}] is invalid`);
        const row = entry as Record<string, unknown>;
        const itemId = integer(row.itemId, `marketPrices[${index}].itemId`, 0, 65_535);
        const itemName = text(row.itemName, `marketPrices[${index}].itemName`, 100);
        const price = (value: unknown, field: string) => value === null ? null : integer(value, field, 0, 2_147_483_647);
        const buyGp = price(row.buyGp, `marketPrices[${index}].buyGp`);
        const sellGp = price(row.sellGp, `marketPrices[${index}].sellGp`);
        if (buyGp === null && sellGp === null) throw new Error(`marketPrices[${index}] requires a buy or sell price`);
        return { itemId, itemName, buyGp, sellGp };
    }), value => String(value.itemId), 'marketPrices').sort((a, b) => a.itemId - b.itemId);
    const finishedProducts = unique(bounded(input.finishedProducts, 'finishedProducts', 2_000).map((entry, index) => {
        if (!entry || typeof entry !== 'object') throw new Error(`finishedProducts[${index}] is invalid`);
        const row = entry as Record<string, unknown>;
        return { itemId: integer(row.itemId, `finishedProducts[${index}].itemId`, 0, 65_535),
            itemName: text(row.itemName, `finishedProducts[${index}].itemName`, 100),
            valueGp: integer(row.valueGp, `finishedProducts[${index}].valueGp`, 0, 2_147_483_647) };
    }), value => String(value.itemId), 'finishedProducts').sort((a, b) => a.itemId - b.itemId);
    if (respawns.length + xpRewards.length + marketPrices.length + finishedProducts.length === 0) {
        throw new Error('An experiment parameter profile cannot be empty');
    }
    return { respawns, xpRewards, marketPrices, finishedProducts };
}

export function validateExperimentParameterProfile(input: CreateExperimentParameterProfile,
    now = new Date().toISOString()): ExperimentParameterProfile {
    const profileId = text(input.profileId, 'profileId', 64).toLocaleLowerCase('en-US');
    if (!ID.test(profileId)) throw new Error('Experiment parameter profileId is invalid');
    const version = text(input.version, 'version', 64);
    if (!VERSION.test(version)) throw new Error('Experiment parameter version must be semantic');
    if (!['manual', 'grid-search', 'automated', 'learning'].includes(input.origin)) {
        throw new Error('Experiment parameter origin is invalid');
    }
    const profile = { schemaVersion: 1 as const, profileId, version,
        label: text(input.label, 'label', 120), description: typeof input.description === 'string'
            ? input.description.trim().replace(/\s+/g, ' ').slice(0, 500) : '', origin: input.origin,
        parameters: canonicalParameters(input.parameters), createdAt: timestamp(now) };
    const digest = createHash('sha256').update(JSON.stringify({ schemaVersion: profile.schemaVersion,
        profileId: profile.profileId, version: profile.version, label: profile.label,
        description: profile.description, origin: profile.origin, parameters: profile.parameters })).digest('hex');
    return { ...profile, digest };
}

function fromRow(row: ProfileRow): ExperimentParameterProfile {
    return { schemaVersion: 1, profileId: row.profile_id, version: row.version, label: row.label,
        description: row.description, origin: row.origin,
        parameters: JSON.parse(row.parameters_json) as ExperimentParameterSet,
        digest: row.digest, createdAt: row.created_at };
}

export class ExperimentParameterStore {
    private readonly database: Database;

    constructor(path = experimentParametersDbPath) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS experiment_parameter_profile (
            profile_id TEXT NOT NULL, version TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL,
            origin TEXT NOT NULL CHECK (origin IN ('manual', 'grid-search', 'automated', 'learning')),
            parameters_json TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
            PRIMARY KEY (profile_id, version))`);
    }

    close(): void { this.database.close(false); }

    create(input: CreateExperimentParameterProfile, now = new Date().toISOString()): ExperimentParameterProfile {
        const profile = validateExperimentParameterProfile(input, now);
        const existing = this.get(profile.profileId, profile.version);
        if (existing) {
            if (existing.digest !== profile.digest) throw new Error('Experiment parameter profile version is immutable');
            return existing;
        }
        this.database.run(`INSERT INTO experiment_parameter_profile
            (profile_id, version, label, description, origin, parameters_json, digest, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`, [profile.profileId, profile.version, profile.label,
            profile.description, profile.origin, JSON.stringify(profile.parameters), profile.digest, profile.createdAt]);
        return this.get(profile.profileId, profile.version)!;
    }

    get(profileId: string, version: string): ExperimentParameterProfile | null {
        const row = this.database.query(`SELECT * FROM experiment_parameter_profile
            WHERE profile_id = ?1 AND version = ?2`).get(profileId, version) as ProfileRow | null;
        return row ? fromRow(row) : null;
    }

    list(limit = 100): ExperimentParameterProfile[] {
        const bounded = Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, limit)) : 100;
        return (this.database.query(`SELECT * FROM experiment_parameter_profile
            ORDER BY created_at DESC, profile_id, version LIMIT ?1`).all(bounded) as ProfileRow[]).map(fromRow);
    }
}
