import { describe, expect, test } from 'bun:test';

import {
    authorizeFacilityCapability,
    loadDefaultFacilityCapabilityCatalog,
    validateFacilityCapabilityCatalog,
    type FacilityAccessGrantEvidence
} from '../index.js';

const request = { subjectAgentId: 'smith-1', facilityId: 'varrock.east-workshop.forge',
    capabilityId: 'smithing.basic-forging', at: '2026-09-20T12:00:00.000Z' };
const grant = (kind: FacilityAccessGrantEvidence['kind']): FacilityAccessGrantEvidence => ({
    grantId: `${kind}-grant`, kind, subjectAgentId: 'smith-1', facilityId: request.facilityId,
    capabilityId: request.capabilityId, validFrom: '2026-09-20T11:00:00.000Z', validUntil: null,
    status: 'active', sourceEvidenceId: `${kind}-evidence`
});

describe('Property and Business facility capabilities', () => {
    test('loads versioned Property facilities with production and storage capabilities', () => {
        const catalog = loadDefaultFacilityCapabilityCatalog();
        expect(catalog.digest).toHaveLength(64);
        expect(catalog.facilities.flatMap(facility => facility.capabilities.map(capability => capability.capabilityId)))
            .toEqual(expect.arrayContaining(['smithing.basic-forging', 'storage.secure', 'cooking.commercial-kitchen']));
    });

    test.each(['employment', 'lease', 'contract', 'explicit'] as const)('authorizes trusted %s access', kind => {
        expect(authorizeFacilityCapability(loadDefaultFacilityCapabilityCatalog(), request, [grant(kind)], () => true))
            .toMatchObject({ propertyId: 'varrock.east-workshop', businessId: null,
                capacityUnits: 1, accessKind: kind, grantId: `${kind}-grant` });
    });

    test('does not let personal skill replace facility entitlement', () => {
        const catalog = loadDefaultFacilityCapabilityCatalog();
        expect(() => authorizeFacilityCapability(catalog, request, [], () => true)).toThrow('entitlement');
        expect(() => authorizeFacilityCapability(catalog, request, [grant('employment')], () => false)).toThrow('entitlement');
        expect(() => authorizeFacilityCapability(catalog, { ...request, capabilityId: 'smithing.precision-1' },
            [grant('employment')], () => true)).toThrow('does not provide');
        expect(() => authorizeFacilityCapability(catalog, request,
            [{ ...grant('employment'), validFrom: 'not-a-time' }], () => true)).toThrow('entitlement');
        expect(() => authorizeFacilityCapability({ ...catalog, digest: '0'.repeat(64) }, request,
            [grant('employment')], () => true)).toThrow('digest mismatch');
    });

    test('supports an exact Business binding and rejects unknown owners', () => {
        const catalog = loadDefaultFacilityCapabilityCatalog();
        const raw = { schemaVersion: catalog.schemaVersion, facilities: structuredClone(catalog.facilities) };
        raw.facilities[0]!.businessId = 'varrock-smiths';
        expect(validateFacilityCapabilityCatalog(raw, new Set(['varrock.east-workshop', 'karamja.fishing-hut']),
            new Set(['varrock-smiths'])).facilities[0]?.businessId).toBe('varrock-smiths');
        expect(() => validateFacilityCapabilityCatalog(raw, new Set(['varrock.east-workshop', 'karamja.fishing-hut'])))
            .toThrow('unknown Business');
    });
});
