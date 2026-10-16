export type PersistentActorEvidenceKind='business-ownership'|'business-employment'|'property-entitlement'|'treasury-control'
    |'governance-membership'|'social-relationship';
export interface ActorIdentityBoundaryPolicy {
    schemaVersion:1;
    defaultDisposition:'ambient';
    visualTypePromotion:'forbidden';
    economicEvidenceKinds:PersistentActorEvidenceKind[];
    socialEvidenceKinds:PersistentActorEvidenceKind[];
    digest:string;
}
export interface WorldEntityIdentityObservation {
    entityRef:string;
    entityKind:'npc'|'animal'|'mob';
    typeId:string;
    displayName:string;
}
export interface PersistentActorEvidenceClaim {
    evidenceId:string;
    kind:PersistentActorEvidenceKind;
    persistentRecordId:string;
    subjectRef:string;
    sourceDigest:string;
}
export interface WorldEntityIdentityAssessment {
    entityRef:string;
    disposition:'ambient'|'persistent-actor';
    reason:'no-verified-persistent-state'|'verified-economic-state'|'verified-social-state';
    acceptedEvidenceIds:string[];
    policyDigest:string;
    digest:string;
}
export type PersistentActorEvidenceVerifier=(claim:PersistentActorEvidenceClaim,
    observation:WorldEntityIdentityObservation)=>boolean;
