export interface FencingRelationshipSnapshot { counterpartyAgentId: string; familiarity: number; trust: number }
export interface FencingCandidateSnapshot {
    candidateId: string;
    kind: 'agent' | 'business';
    operatorAgentId: string;
    lifecycleStatus: 'active' | 'deceased' | 'imprisoned' | 'insolvent' | 'inactive';
    availableGp: number;
    storageAvailableUnits: number;
    capabilities: string[];
    relationships: FencingRelationshipSnapshot[];
    sourceEvidenceDigest: string;
}
export interface FencingOpportunity {
    opportunityId: string;
    sellerAgentId: string;
    itemId: number;
    quantity: number;
    assetId: string | null;
    provenanceDigest: string | null;
    storageUnits: number;
    acquisitionCostGp: number;
    expectedResaleGp: number;
    estimatedRiskCostGp: number;
    requiredCapabilities: string[];
    sourceEvidenceDigest: string;
}
export interface FencingMarketPolicy {
    schemaVersion: 1;
    minimumFamiliarity: number;
    minimumTrust: number;
    minimumExpectedProfitGp: number;
    digest: string;
}
export interface FencingParticipationDecision {
    candidateId: string;
    candidateKind: FencingCandidateSnapshot['kind'];
    operatorAgentId: string;
    opportunityId: string;
    participate: boolean;
    reason: 'eligible-profitable' | 'inactive' | 'insufficient-funds' | 'insufficient-storage'
        | 'missing-capability' | 'no-relationship' | 'unprofitable';
    expectedProfitGp: number;
    committedCapitalGp: number;
    sourceDigests: [string, string];
    policyDigest: string;
    decisionDigest: string;
}
export interface FencingMarketProjection {
    opportunityId: string;
    availability: 'available' | 'unavailable';
    participants: FencingParticipationDecision[];
}
export interface FencingTradeReceipt {
    receiptId: string;
    buyerAgentId: string;
    sellerAgentId: string;
    itemId: number;
    quantity: number;
    coinsPaid: number;
    assetId: string | null;
    assetRevision: number | null;
    provenanceDigest: string | null;
    status: 'committed';
    partial: false;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface FencingSettlementRequest {
    settlementId: string;
    reservationId: string | null;
    storageId: string | null;
    candidate: FencingCandidateSnapshot;
    opportunity: FencingOpportunity;
    decision: FencingParticipationDecision;
    trade: FencingTradeReceipt;
}
export interface FencingSettlementRecord {
    settlementId: string;
    candidateId: string;
    opportunityId: string;
    tradeReceiptId: string;
    requestDigest: string;
    provenanceCommitted: boolean;
    stockCommitted: boolean;
    moneyCommitted: boolean;
    status: 'settling' | 'committed';
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface FencingProvenanceCommit {
    operationId: string;
    assetId: string;
    expectedRevision: number;
    fromAgentId: string;
    to: { kind: 'agent' | 'business'; id: string };
    tradeReceiptId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface FencingBusinessStockCommit {
    operationId: string;
    businessId: string;
    operatorAgentId: string;
    storageId: string | null;
    itemId: number;
    quantity: number;
    tradeReceiptId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface FencingBusinessMoneyCommit {
    settlementId: string;
    reservationId: string;
    businessId: string;
    amountGp: number;
    tradeReceiptId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface FencingSettlementPorts {
    commitProvenance(input: Readonly<FencingProvenanceCommit>): void;
    commitBusinessStock(input: Readonly<FencingBusinessStockCommit>): void;
    commitBusinessMoney(input: Readonly<FencingBusinessMoneyCommit>): void;
}
export type FencingTradeVerifier = (receipt: Readonly<FencingTradeReceipt>) => boolean;
