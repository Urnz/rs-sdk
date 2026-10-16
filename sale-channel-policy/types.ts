export type SaleChannel = 'business-shop' | 'npc-shop' | 'player-trade';
export interface SaleCounterparty { kind: 'agent' | 'business' | 'npc'; id: string }
export interface ItemSaleOffer {
    offerId: string;
    channel: SaleChannel;
    sellerAgentId: string;
    acquirer: SaleCounterparty;
    itemId: number;
    quantity: number;
    assetId: string | null;
    provenanceDigest: string | null;
}
export type ItemInspectionMethod = 'reported-identifier' | 'physical-mark' | 'document-check' | 'local-provenance-record';
export interface ItemInspectionEvidence {
    evidenceId: string;
    offerId: string;
    inspector: SaleCounterparty;
    method: ItemInspectionMethod;
    finding: 'recognized-ineligible' | 'no-match' | 'inconclusive';
    sourceRecordId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface SaleChannelRule {
    channel: SaleChannel;
    acquirerKind: SaleCounterparty['kind'];
    inspection: 'observer-evidence' | 'none';
    recognizedIneligible: 'reject' | 'pass-through';
    provenanceDisposition: 'preserve';
}
export interface SaleChannelPolicyCatalog { schemaVersion: 1; channels: SaleChannelRule[]; digest: string }
export interface SaleChannelDecision {
    offer: ItemSaleOffer;
    status: 'accepted' | 'rejected';
    reason: 'direct-trade' | 'not-recognized' | 'recognized-ineligible';
    consideredEvidenceIds: string[];
    provenanceDisposition: 'preserve';
    policyDigest: string;
    decisionDigest: string;
}
export type ItemInspectionVerifier = (evidence: Readonly<ItemInspectionEvidence>) => boolean;
