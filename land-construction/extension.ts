import { landConstructionCatalogDigest } from './catalog.js';
import type { ConstructionOwnerRef, ConstructionProjectReference, LandConstructionCatalog } from './types.js';

const ID = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
export function prepareConstructionProject(input: { projectId: string; landParcelId: string; blueprintId: string;
    futurePropertyId: string; owner: ConstructionOwnerRef; parcelOwnershipEvidenceDigest: string },
catalog: LandConstructionCatalog, existingPropertyIds: ReadonlySet<string>): ConstructionProjectReference {
    const { digest, ...definition } = catalog;
    if (digest !== landConstructionCatalogDigest(definition)) throw new Error('Land construction catalog digest mismatch');
    for (const [field, value] of Object.entries({ projectId: input.projectId, futurePropertyId: input.futurePropertyId })) {
        if (typeof value !== 'string' || value.length > 128 || !ID.test(value)) throw new Error(`${field} is invalid`);
    }
    const parcel = catalog.parcels.find(item => item.landParcelId === input.landParcelId);
    if (!parcel) throw new Error('Unknown land parcel');
    if (!parcel.enabled) throw new Error('Land parcel is not enabled for projects');
    if (!catalog.blueprints.some(item => item.blueprintId === input.blueprintId)) throw new Error('Unknown blueprint');
    if (existingPropertyIds.has(input.futurePropertyId)) throw new Error('Future Property id already exists');
    if (!input.owner || !['player', 'business', 'faction'].includes(input.owner.kind)
        || typeof input.owner.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(input.owner.id)) {
        throw new Error('Construction owner is invalid');
    }
    if (!/^[0-9a-f]{64}$/.test(input.parcelOwnershipEvidenceDigest)) {
        throw new Error('Parcel ownership evidence digest is invalid');
    }
    return { ...input, catalogDigest: catalog.digest, status: 'planned' };
}
