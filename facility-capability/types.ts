export type FacilityAccessKind = 'employment' | 'lease' | 'contract' | 'explicit';
export interface FacilityCapabilityDefinition { capabilityId: string; capacityUnits: number }
export interface FacilityDefinition {
    facilityId: string;
    label: string;
    propertyId: string;
    businessId: string | null;
    capabilities: FacilityCapabilityDefinition[];
    allowedAccessKinds: FacilityAccessKind[];
}
export interface FacilityCapabilityCatalog { schemaVersion: 1; facilities: FacilityDefinition[]; digest: string }
export interface FacilityAccessGrantEvidence {
    grantId: string;
    kind: FacilityAccessKind;
    subjectAgentId: string;
    facilityId: string;
    capabilityId: string;
    validFrom: string;
    validUntil: string | null;
    status: 'active';
    sourceEvidenceId: string;
}
export interface FacilityAccessRequest { subjectAgentId: string; facilityId: string; capabilityId: string; at: string }
export interface FacilityCapabilityAuthorization extends FacilityAccessRequest {
    propertyId: string;
    businessId: string | null;
    capacityUnits: number;
    grantId: string;
    accessKind: FacilityAccessKind;
    sourceEvidenceId: string;
    catalogDigest: string;
}
