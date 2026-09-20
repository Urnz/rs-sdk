export type EconomicNpcMigrationStage='audit'|'shadow-accounting'|'finite-pilot'|'cutover';
export interface EconomicNpcReadinessGate { gateId:string;status:'pending';requiredEvidence:string }
export interface EconomicNpcMigrationCandidate {
    migrationId:string;
    serviceKind:'shop'|'repair'|'hospitality'|'transport';
    status:'planned';
    legacy:{npcTypeIds:string[];sharedInventoryId:string|null;sourcePaths:string[]};
    target:{businessId:string;institutionAgentId:string;ownerAgentId:string;propertyId:string;treasuryActorId:string};
    stages:EconomicNpcMigrationStage[];
    readinessGates:EconomicNpcReadinessGate[];
}
export interface EconomicNpcMigrationCatalog {
    schemaVersion:1;
    activation:'planning-only';
    candidates:EconomicNpcMigrationCandidate[];
    digest:string;
}
