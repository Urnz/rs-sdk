import type {
    FacilityAccessGrantEvidence,
    FacilityAccessRequest,
    FacilityCapabilityAuthorization,
    FacilityCapabilityCatalog
} from './types.js';
import { facilityCapabilityCatalogDigest } from './catalog.js';

export type FacilityGrantVerifier = (grant: FacilityAccessGrantEvidence) => boolean;

export function authorizeFacilityCapability(catalog: FacilityCapabilityCatalog, request: FacilityAccessRequest,
    grants: readonly FacilityAccessGrantEvidence[], verify?: FacilityGrantVerifier): FacilityCapabilityAuthorization {
    if (catalog.digest !== facilityCapabilityCatalogDigest({ schemaVersion: catalog.schemaVersion, facilities: catalog.facilities })) {
        throw new Error('Facility capability catalog digest mismatch');
    }
    const facility = catalog.facilities.find(entry => entry.facilityId === request.facilityId);
    if (!facility) throw new Error('Facility is unknown');
    const capability = facility.capabilities.find(entry => entry.capabilityId === request.capabilityId);
    if (!capability) throw new Error('Facility does not provide the requested capability');
    const at = Date.parse(request.at);
    if (!Number.isFinite(at)) throw new Error('Facility access time is invalid');
    const grant = grants.find(entry => entry.status === 'active' && entry.subjectAgentId === request.subjectAgentId
        && entry.facilityId === request.facilityId && entry.capabilityId === request.capabilityId
        && facility.allowedAccessKinds.includes(entry.kind) && Number.isFinite(Date.parse(entry.validFrom))
        && Date.parse(entry.validFrom) <= at && (entry.validUntil === null
            || (Number.isFinite(Date.parse(entry.validUntil)) && Date.parse(entry.validUntil) >= at)) && verify?.(entry));
    if (!grant) throw new Error('Facility capability requires a trusted active entitlement');
    return { ...request, propertyId: facility.propertyId, businessId: facility.businessId,
        capacityUnits: capability.capacityUnits, grantId: grant.grantId, accessKind: grant.kind,
        sourceEvidenceId: grant.sourceEvidenceId, catalogDigest: catalog.digest };
}
