import type { ItemStateMode } from '../item-lifecycle/types.js';
import type { ThievingOutcomeReceipt } from '../thieving-procedures/types.js';

export type ItemProvenanceTier = 'value-restitution' | 'provenance-lot' | 'identified-asset';
export type ItemPartyKind = 'agent' | 'business' | 'faction';
export interface ItemParty { kind: ItemPartyKind; id: string }
export interface ItemProvenanceRule {
    itemId: number;
    itemName: string;
    tier: ItemProvenanceTier;
    rationale: string;
}
export interface ItemProvenancePolicyCatalog {
    schemaVersion: 1;
    rules: ItemProvenanceRule[];
    digest: string;
}
export interface ItemProvenanceEvidence {
    evidenceId: string;
    sourceDomain: 'item-lifecycle' | 'business-assets' | 'trade';
    sourceRecordId: string;
    sourceStateVersion: number;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface ItemProvenanceAsset {
    assetId: string;
    tier: Exclude<ItemProvenanceTier, 'value-restitution'>;
    stateMode: Extract<ItemStateMode, 'batch' | 'instance'>;
    itemId: number;
    quantity: number;
    titleOwner: ItemParty;
    holder: ItemParty;
    provenanceRootDigest: string;
    theftHistoryCount: number;
    lifecycleStatus: 'active' | 'consumed';
    consumedByTransformationId: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}
export interface ItemTransformationAssetRef { assetId: string; expectedRevision: number; storageId: string | null }
export interface ItemTransformationOutput { assetId: string; itemId: number; quantity: number; storageId: string | null }
export interface ItemTransformationEvidence {
    sourceRecordId: string;
    recipeId: string;
    recipeVersion: string;
    recipeCatalogDigest: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface TransformProvenanceAssets {
    transformationId: string;
    businessId: string;
    inputs: ItemTransformationAssetRef[];
    outputs: ItemTransformationOutput[];
    evidence: ItemTransformationEvidence;
}
export interface ItemTransformationRecord {
    transformationId: string;
    businessId: string;
    inputAssetIds: string[];
    outputAssetIds: string[];
    evidence: ItemTransformationEvidence;
    transformationDigest: string;
    recordedAt: string;
}
export type ItemProvenanceEventKind = 'registered' | 'title-transferred' | 'custody-transferred' | 'stolen';
export interface ItemProvenanceEvent {
    eventId: string;
    evidenceId: string;
    kind: ItemProvenanceEventKind;
    assetId: string | null;
    itemId: number;
    quantity: number;
    titleBefore: ItemParty | null;
    titleAfter: ItemParty;
    holderBefore: ItemParty | null;
    holderAfter: ItemParty;
    sourceDomain: ItemProvenanceEvidence['sourceDomain'] | 'thieving-procedures';
    sourceRecordId: string;
    sourceStateVersion: number;
    sourceEvidenceDigest: string;
    occurredAt: string;
    eventDigest: string;
    recordedAt: string;
}
export interface ItemRestitutionClaim {
    claimId: string;
    eventId: string;
    itemId: number;
    quantity: number;
    titleOwner: ItemParty;
    liableActorAgentId: string;
    unitValueCoins: number;
    amountCoins: number;
    status: 'open';
    createdAt: string;
}
export interface RegisterProvenanceAsset {
    eventId: string;
    assetId: string;
    itemId: number;
    quantity: number;
    titleOwner: ItemParty;
    holder: ItemParty;
    evidence: ItemProvenanceEvidence;
}
export interface TransferItemTitle {
    eventId: string;
    assetId: string;
    expectedRevision: number;
    from: ItemParty;
    to: ItemParty;
    evidence: ItemProvenanceEvidence;
}
export interface TransferItemCustody {
    eventId: string;
    assetId: string;
    expectedRevision: number;
    from: ItemParty;
    to: ItemParty;
    evidence: ItemProvenanceEvidence;
}
export interface RecordItemTheft {
    eventId: string;
    claimId: string | null;
    assetId: string | null;
    expectedRevision: number | null;
    itemId: number;
    quantity: number;
    titleOwner: ItemParty;
    previousHolder: ItemParty;
    thiefAgentId: string;
    unitValueCoins: number | null;
}
export type ItemProvenanceVerifier = (evidence: ItemProvenanceEvidence) => boolean;
export type ItemTheftVerifier = (receipt: ThievingOutcomeReceipt, input: RecordItemTheft) => boolean;
export type ItemTransformationVerifier = (input: Readonly<TransformProvenanceAssets>) => boolean;
