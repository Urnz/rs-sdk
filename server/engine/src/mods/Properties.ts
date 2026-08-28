import { readFileSync } from 'node:fs';

export const propertyTypes = [
    'house', 'farm', 'mine', 'shop', 'workshop', 'inn', 'warehouse', 'castle', 'bank', 'port'
] as const;
export type PropertyType = (typeof propertyTypes)[number];

export const propertyStatuses = ['available', 'owned', 'locked', 'disabled'] as const;
export type PropertyStatus = (typeof propertyStatuses)[number];

export const propertyRoles = ['everyone', 'eligible-player', 'owner', 'visitor', 'employee', 'admin'] as const;
export type PropertyRole = (typeof propertyRoles)[number];

export interface PropertyTile {
    x: number;
    z: number;
    level: number;
}

export interface PropertyEntryPoint extends PropertyTile {
    entryPointId: string;
    label: string;
}

export interface PropertyEconomyRule {
    mode: 'none' | 'fixed' | 'activity';
    amount: number;
    intervalMinutes: number;
}

export interface PropertyPermissions {
    inspect: PropertyRole[];
    purchase: PropertyRole[];
    enter: PropertyRole[];
    manage: PropertyRole[];
}

export interface PropertyDefinition {
    propertyId: string;
    displayName: string;
    description: string;
    type: PropertyType;
    location: PropertyTile & { region: string };
    purchasePrice: number;
    entryPoints: PropertyEntryPoint[];
    revenue: PropertyEconomyRule;
    maintenance: Omit<PropertyEconomyRule, 'mode'>;
    permissions: PropertyPermissions;
}

export interface PropertyCatalog {
    schemaVersion: 1;
    properties: PropertyDefinition[];
}

export interface PropertyStateEntry {
    propertyId: string;
    status: PropertyStatus;
    ownerPlayerId: string | null;
    acquiredAt: string | null;
    updatedAt: string;
    version: number;
}

export interface PropertyState {
    schemaVersion: 1;
    revision: number;
    properties: Record<string, PropertyStateEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maximum = 160): string {
    const value = record[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new Error(`${key} must be a non-empty string of at most ${maximum} characters`);
    }
    return value;
}

function nonNegativeInteger(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${key} must be a non-negative safe integer`);
    return Number(value);
}

function positiveInteger(record: Record<string, unknown>, key: string): number {
    const value = nonNegativeInteger(record, key);
    if (value === 0) throw new Error(`${key} must be a positive integer`);
    return value;
}

function parseTile(value: unknown, context: string): PropertyTile {
    if (!isRecord(value)) throw new Error(`${context} must be an object`);
    const x = nonNegativeInteger(value, 'x');
    const z = nonNegativeInteger(value, 'z');
    const level = nonNegativeInteger(value, 'level');
    if (x > 16383 || z > 16383) throw new Error(`${context} coordinates must be between 0 and 16383`);
    if (level > 3) throw new Error(`${context} level must be between 0 and 3`);
    return { x, z, level };
}

function parseRoles(value: unknown, context: string): PropertyRole[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${context} must contain at least one role`);
    const roles = value.map(role => {
        if (!propertyRoles.includes(role as PropertyRole)) throw new Error(`${context} contains an unsupported role`);
        return role as PropertyRole;
    });
    if (new Set(roles).size !== roles.length) throw new Error(`${context} contains duplicate roles`);
    return roles;
}

function parseEconomyRule(value: unknown, context: string): PropertyEconomyRule {
    if (!isRecord(value) || !['none', 'fixed', 'activity'].includes(String(value.mode))) {
        throw new Error(`${context}.mode must be none, fixed or activity`);
    }
    const amount = nonNegativeInteger(value, 'amount');
    const intervalMinutes = positiveInteger(value, 'intervalMinutes');
    if (value.mode === 'none' && amount !== 0) throw new Error(`${context}.amount must be zero when mode is none`);
    return { mode: value.mode as PropertyEconomyRule['mode'], amount, intervalMinutes };
}

function parseProperty(value: unknown): PropertyDefinition {
    if (!isRecord(value)) throw new Error('property must be an object');
    const propertyId = requiredString(value, 'propertyId', 64);
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(propertyId)) {
        throw new Error(`propertyId has an invalid stable identifier: ${propertyId}`);
    }
    const type = value.type;
    if (!propertyTypes.includes(type as PropertyType)) throw new Error(`${propertyId}.type is unsupported`);
    const location = parseTile(value.location, `${propertyId}.location`);
    if (!isRecord(value.location)) throw new Error(`${propertyId}.location must be an object`);
    const region = requiredString(value.location, 'region', 80);
    const purchasePrice = positiveInteger(value, 'purchasePrice');
    if (!Array.isArray(value.entryPoints) || value.entryPoints.length === 0 || value.entryPoints.length > 16) {
        throw new Error(`${propertyId}.entryPoints must contain between 1 and 16 entries`);
    }
    const entryPoints = value.entryPoints.map((entry, index) => {
        if (!isRecord(entry)) throw new Error(`${propertyId}.entryPoints[${index}] must be an object`);
        return {
            entryPointId: requiredString(entry, 'entryPointId', 64),
            label: requiredString(entry, 'label', 80),
            ...parseTile(entry, `${propertyId}.entryPoints[${index}]`)
        };
    });
    if (new Set(entryPoints.map(entry => entry.entryPointId)).size !== entryPoints.length) {
        throw new Error(`${propertyId}.entryPoints contains duplicate identifiers`);
    }
    if (!isRecord(value.maintenance)) throw new Error(`${propertyId}.maintenance must be an object`);
    const maintenance = {
        amount: nonNegativeInteger(value.maintenance, 'amount'),
        intervalMinutes: positiveInteger(value.maintenance, 'intervalMinutes')
    };
    if (!isRecord(value.permissions)) throw new Error(`${propertyId}.permissions must be an object`);
    return {
        propertyId,
        displayName: requiredString(value, 'displayName', 80),
        description: requiredString(value, 'description', 240),
        type: type as PropertyType,
        location: { ...location, region },
        purchasePrice,
        entryPoints,
        revenue: parseEconomyRule(value.revenue, `${propertyId}.revenue`),
        maintenance,
        permissions: {
            inspect: parseRoles(value.permissions.inspect, `${propertyId}.permissions.inspect`),
            purchase: parseRoles(value.permissions.purchase, `${propertyId}.permissions.purchase`),
            enter: parseRoles(value.permissions.enter, `${propertyId}.permissions.enter`),
            manage: parseRoles(value.permissions.manage, `${propertyId}.permissions.manage`)
        }
    };
}

export function parsePropertyCatalog(value: unknown): PropertyCatalog {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.properties)) {
        throw new Error('Property catalog must use schemaVersion 1 and contain a properties array');
    }
    const properties = value.properties.map(parseProperty);
    if (properties.length === 0) throw new Error('Property catalog must contain at least one property');
    const ids = properties.map(property => property.propertyId);
    if (new Set(ids).size !== ids.length) throw new Error('Property catalog contains duplicate propertyId values');
    return { schemaVersion: 1, properties };
}

export function loadPropertyCatalog(path: string): PropertyCatalog {
    try {
        return parsePropertyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    } catch (error) {
        throw new Error(`Property catalog cannot be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function createInitialPropertyState(catalog: PropertyCatalog, now = new Date().toISOString()): PropertyState {
    return {
        schemaVersion: 1,
        revision: 0,
        properties: Object.fromEntries(catalog.properties.map(property => [property.propertyId, {
            propertyId: property.propertyId,
            status: 'available',
            ownerPlayerId: null,
            acquiredAt: null,
            updatedAt: now,
            version: 1
        } satisfies PropertyStateEntry]))
    };
}
