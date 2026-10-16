import type { BusinessAssetStore, ReceiveExternalBusinessAssets } from '../business-assets/index.js';
import type { ItemProvenanceStore } from '../item-provenance/index.js';
import type { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import type { FencingSettlementPorts } from './types.js';

export interface FencingStoreAdapters {
    provenance: ItemProvenanceStore;
    businessAssets: BusinessAssetStore;
    treasury: InstitutionTreasuryStore;
    verifyBusinessReceipt?: (input: Readonly<ReceiveExternalBusinessAssets>) => boolean;
}

/** Concrete adapters for the existing idempotent provenance, Business asset and treasury stores. */
export function createFencingSettlementPorts(stores:FencingStoreAdapters):FencingSettlementPorts{return{
    commitProvenance:input=>{stores.provenance.transferCustody({eventId:input.operationId,assetId:input.assetId,
        expectedRevision:input.expectedRevision,from:{kind:'agent',id:input.fromAgentId},to:input.to,
        evidence:{evidenceId:`${input.operationId}.evidence`,sourceDomain:'trade',sourceRecordId:input.tradeReceiptId,
            sourceStateVersion:1,sourceEvidenceDigest:input.sourceEvidenceDigest,occurredAt:input.occurredAt}},evidence=>
                evidence.sourceDomain==='trade'&&evidence.sourceRecordId===input.tradeReceiptId
                &&evidence.sourceEvidenceDigest===input.sourceEvidenceDigest,input.occurredAt)},
    commitBusinessStock:input=>{stores.businessAssets.receiveExternal({operationId:input.operationId,
        businessId:input.businessId,actorAgentId:input.operatorAgentId,storageId:input.storageId,itemId:input.itemId,
        count:input.quantity,sourceReceiptId:input.tradeReceiptId,sourceEvidenceDigest:input.sourceEvidenceDigest,
        occurredAt:input.occurredAt},stores.verifyBusinessReceipt,input.occurredAt)},
    commitBusinessMoney:input=>{const reservation=stores.treasury.getReservation(input.reservationId);
        if(!reservation||reservation.kind!=='business'||reservation.actorId!==input.businessId
            ||reservation.amountGp!==input.amountGp||reservation.status==='released'
            ||reservation.settlementId&&reservation.settlementId!==input.settlementId)
            throw new Error('Fencing payment does not match its funded Business reservation');
        stores.treasury.bindSettlement(input.reservationId,input.settlementId,input.occurredAt);
        stores.treasury.commit(input.reservationId,input.settlementId,input.occurredAt)}
}}
