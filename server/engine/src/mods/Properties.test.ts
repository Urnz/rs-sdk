import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
    createInitialPropertyState,
    loadPropertyCatalog,
    parsePropertyCatalog
} from './Properties.js';

const baseProperty = {
    propertyId: 'varrock.test-workshop',
    displayName: 'Test workshop',
    description: 'A test property used to validate the domain model.',
    type: 'workshop',
    location: { x: 3253, z: 3421, level: 0, region: 'Varrock East' },
    purchasePrice: 25000,
    entryPoints: [{ entryPointId: 'front-door', label: 'Front door', x: 3253, z: 3421, level: 0 }],
    revenue: { mode: 'none', amount: 0, intervalMinutes: 1440 },
    maintenance: { amount: 250, intervalMinutes: 1440 },
    permissions: {
        inspect: ['everyone'], purchase: ['eligible-player'], enter: ['owner', 'admin'], manage: ['owner', 'admin']
    }
};

describe('property catalog', () => {
    test('loads the versioned project catalog with three distinct MVP properties', () => {
        const path = fileURLToPath(new URL('../../../../config/properties.json', import.meta.url));
        const catalog = loadPropertyCatalog(path);
        expect(catalog.schemaVersion).toBe(1);
        expect(catalog.properties).toHaveLength(3);
        expect(new Set(catalog.properties.map(property => property.propertyId)).size).toBe(3);
        expect(catalog.properties.map(property => property.type)).toEqual(['workshop', 'house', 'warehouse']);
    });

    test('creates ownerless domain state separately from immutable definitions', () => {
        const catalog = parsePropertyCatalog({ schemaVersion: 1, properties: [baseProperty] });
        const state = createInitialPropertyState(catalog, '2026-08-28T12:00:00.000Z');
        expect(state).toEqual({
            schemaVersion: 1,
            revision: 0,
            properties: {
                'varrock.test-workshop': {
                    propertyId: 'varrock.test-workshop',
                    status: 'available',
                    ownerPlayerId: null,
                    acquiredAt: null,
                    updatedAt: '2026-08-28T12:00:00.000Z',
                    version: 1
                }
            }
        });
        expect(catalog.properties[0]?.purchasePrice).toBe(25000);
    });

    test('rejects duplicate stable property and entry-point identifiers', () => {
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [baseProperty, { ...baseProperty }]
        })).toThrow('duplicate propertyId');
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{ ...baseProperty, entryPoints: [baseProperty.entryPoints[0], baseProperty.entryPoints[0]] }]
        })).toThrow('duplicate identifiers');
    });

    test('rejects invalid prices, world coordinates and permission roles', () => {
        expect(() => parsePropertyCatalog({
            schemaVersion: 1, properties: [{ ...baseProperty, purchasePrice: 0 }]
        })).toThrow('purchasePrice must be a positive integer');
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{ ...baseProperty, location: { ...baseProperty.location, level: 4 } }]
        })).toThrow('level must be between 0 and 3');
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{
                ...baseProperty,
                permissions: { ...baseProperty.permissions, manage: ['superuser'] }
            }]
        })).toThrow('unsupported role');
    });

    test('requires internally consistent economy rules', () => {
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{ ...baseProperty, revenue: { mode: 'none', amount: 100, intervalMinutes: 1440 } }]
        })).toThrow('amount must be zero when mode is none');
        expect(() => parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{ ...baseProperty, maintenance: { amount: 250, intervalMinutes: 0 } }]
        })).toThrow('intervalMinutes must be a positive integer');
    });
});
