export type RightsResourceKind='item-ownership'|'storage-ownership'|'property-ownership'|'entry-entitlement';
export type RightsOwnerKind='agent'|'business'|'faction';
export interface RightsOwner { kind:RightsOwnerKind; id:string }
export type RightsViolationAction='take'|'use'|'transfer'|'open'|'withdraw'|'deposit'|'occupy'|'alter'|'enter'|'remain';
export interface RightsViolationEvidence {
    evidenceId:string;
    resourceKind:RightsResourceKind;
    resourceId:string;
    owner:RightsOwner;
    actorAgentId:string;
    action:RightsViolationAction;
    authorizationDecision:'denied';
    sourceDomain:'item-lifecycle'|'business-assets'|'property'|'property-access';
    sourceStateVersion:number;
    sourceEvidenceDigest:string;
    occurredAt:string;
}
export interface RecordRightsViolation { eventId:string;evidence:RightsViolationEvidence }
export interface RightsViolationEvent extends RightsViolationEvidence {
    eventId:string;
    eventDigest:string;
    recordedAt:string;
}
