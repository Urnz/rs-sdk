import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { landConstructionCatalogDigest, loadLandConstructionCatalog, prepareConstructionProject,
    validateLandConstructionCatalog } from '../index.js';

const configured = () => loadLandConstructionCatalog(join(import.meta.dir, '..', '..', 'config',
    'land-construction.json'));
const enabled = () => { const source = configured();
    const value = { ...source, parcels: source.parcels.map(parcel => ({ ...parcel, enabled: true })) };
    value.digest = landConstructionCatalogDigest({ schemaVersion: value.schemaVersion, parcels: value.parcels,
        blueprints: value.blueprints }); return value; };
const input = { projectId: 'project-1', landParcelId: 'falador.future-residential-1', blueprintId: 'small-house',
    futurePropertyId: 'falador.new-house-1', owner: { kind: 'player' as const, id: 'ada' },
    parcelOwnershipEvidenceDigest: 'a'.repeat(64) };

describe('future land and construction extension boundary', () => {
    test('loads disabled parcel inventory and versioned building blueprints', () => {
        const catalog = configured();
        expect(catalog.parcels[0]).toMatchObject({ enabled: false, purchasePriceGp: 30000 });
        expect(catalog.blueprints[0]?.stages.map(stage => stage.stageId))
            .toEqual(['foundation', 'structure', 'completion']);
        expect(catalog.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('prepares only a proven owned, explicitly enabled parcel with a new Property id', () => {
        expect(prepareConstructionProject(input, enabled(), new Set(['falador.south-house']))).toMatchObject({
            status: 'planned', futurePropertyId: 'falador.new-house-1', owner: { kind: 'player', id: 'ada' } });
        expect(() => prepareConstructionProject(input, configured(), new Set())).toThrow('not enabled');
        expect(() => prepareConstructionProject(input, enabled(), new Set(['falador.new-house-1'])))
            .toThrow('already exists');
        expect(() => prepareConstructionProject({ ...input, parcelOwnershipEvidenceDigest: 'invalid' },
        enabled(), new Set())).toThrow('evidence digest');
    });

    test('rejects unknown references and tampered catalogs before planning', () => {
        expect(() => prepareConstructionProject({ ...input, blueprintId: 'unknown' }, enabled(), new Set()))
            .toThrow('Unknown blueprint');
        expect(() => prepareConstructionProject(input, { ...enabled(), digest: '0'.repeat(64) }, new Set()))
            .toThrow('digest mismatch');
    });

    test('rejects unsafe coordinates, duplicate stages and executable-looking extra fields', () => {
        const catalog = configured();
        expect(() => validateLandConstructionCatalog({ schemaVersion: 1, parcels: [{ ...catalog.parcels[0],
            bounds: { ...catalog.parcels[0]!.bounds, maxX: -1 } }], blueprints: catalog.blueprints }))
            .toThrow('between 0 and');
        expect(() => validateLandConstructionCatalog({ schemaVersion: 1, parcels: catalog.parcels,
            blueprints: [{ ...catalog.blueprints[0], stages: [catalog.blueprints[0]!.stages[0],
                catalog.blueprints[0]!.stages[0]] }] })).toThrow('duplicate ids');
        expect(() => validateLandConstructionCatalog({ schemaVersion: 1, parcels: catalog.parcels,
            blueprints: catalog.blueprints, command: 'spawn-building' })).toThrow('fields are invalid');
    });
});
