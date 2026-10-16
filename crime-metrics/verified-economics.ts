import type { FencingSettlementRecord, FencingSettlementRequest, FencingTradeReceipt } from '../fencing-market/types.js';
import type { ItemProvenanceStore } from '../item-provenance/store.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
export interface VerifiedCrimeEconomicProjection{
    scope:'selected-thieving-provenance-and-settlement-cohort';actorAgentId:string;
    sourceReceiptIds:string[];selectedTheftEventIds:string[];selectedSettlementIds:string[];
    coverage:{selectedReceipts:number;receiptsWithVerifiedTheftLoss:number;verifiedTheftEvents:number;
        receiptsWithObservedDiscovery:number;verifiedPaidDispositionChains:number;unlinkedSettlementIds:string[]};
    observed:{outcomesWithDiscovery:number;outcomesWithIdentification:number};
    /** Confirmed custody loss only. No claim amount or synthetic market valuation is used. */
    verifiedVictimLosses:Array<{theftEventId:string;receiptId:string;itemId:number;quantity:number;
        titleOwner:{kind:'agent'|'business'|'faction';id:string};monetaryDamageGp:null}>;
    /** Coins the engine trade verifier confirms the actor actually received. */
    verifiedGrossIncomeGp:number;
    paidDispositionChains:Array<{settlementId:string;tradeReceiptId:string;soldAssetId:string;
        sourceTheftEventIds:string[];transformationAncestorAssetIds:string[];coinsReceivedGp:number}>;
    unavailable:{netIncome:'no-verified-cost-basis';monetaryHarm:'no-verified-victim-valuation-or-realized-replacement-cost'};
}
export interface FencingSettlementMetricSource{verifyAuditChain():boolean;get(id:string):FencingSettlementRecord|null;
    getRecordedRequest(id:string):Readonly<FencingSettlementRequest>|null}
export type VerifiedTradeReceiptVerifier=(receipt:Readonly<FencingTradeReceipt>)=>boolean;
function ids(values:readonly string[],field:string,allowEmpty=false){if(!Array.isArray(values)||values.length>1_000
    ||(!allowEmpty&&values.length===0)||values.some(value=>typeof value!=='string'||!ID.test(value)))
    throw new Error(`${field} is invalid`);if(new Set(values).size!==values.length)throw new Error(`${field} contains duplicates`);return[...values]}

/** Read-only join over exact, caller-selected cohorts. Omission is coverage, never evidence of absence. */
export function projectVerifiedCrimeEconomics(
    thieving:Pick<ThievingProcedureStore,'verifyAuditChain'|'getOutcome'|'listDiscoveries'>,
    provenance:Pick<ItemProvenanceStore,'verifyAuditChain'|'getEvent'|'getAsset'|'listAncestorAssetIds'>,
    settlements:FencingSettlementMetricSource,verifyTrade:VerifiedTradeReceiptVerifier,
    actorAgentIdInput:string,receiptIdsInput:readonly string[],theftEventIdsInput:readonly string[],
    settlementIdsInput:readonly string[]):VerifiedCrimeEconomicProjection{
    const actorAgentId=typeof actorAgentIdInput==='string'&&ID.test(actorAgentIdInput)?actorAgentIdInput:(()=>{throw new Error('actorAgentId is invalid')})();
    const receiptIds=ids(receiptIdsInput,'Receipt cohort'),theftEventIds=ids(theftEventIdsInput,'Theft event cohort',true),
        settlementIds=ids(settlementIdsInput,'Settlement cohort',true);
    const assertAudits=()=>{if(!thieving.verifyAuditChain()||!provenance.verifyAuditChain()||!settlements.verifyAuditChain())
        throw new Error('Crime economic source audit chain is invalid')};assertAudits();
    const receipts=new Map(receiptIds.map(receiptId=>{const receipt=thieving.getOutcome(receiptId);
        if(!receipt)throw new Error(`Thieving receipt ${receiptId} does not exist`);
        if(receipt.actorAgentId!==actorAgentId)throw new Error('Receipt cohort contains another actor');return[receiptId,structuredClone(receipt)] as const}));
    const events=theftEventIds.map(eventId=>{const event=provenance.getEvent(eventId),receipt=event?receipts.get(event.sourceRecordId):null;
        if(!event||event.kind!=='stolen'||event.sourceDomain!=='thieving-procedures'||!receipt
            ||event.sourceEvidenceDigest!==receipt.receiptDigest||event.holderAfter.kind!=='agent'
            ||event.holderAfter.id!==actorAgentId)throw new Error('Theft event does not match the selected receipt cohort');
        return structuredClone(event)});
    const linkedReceipts=new Set(events.map(event=>event.sourceRecordId));
    const paidDispositionChains:VerifiedCrimeEconomicProjection['paidDispositionChains']=[],unlinkedSettlementIds:string[]=[];
    for(const settlementId of settlementIds){const state=settlements.get(settlementId),request=settlements.getRecordedRequest(settlementId);
        if(!state||state.status!=='committed'||!state.provenanceCommitted||!state.stockCommitted||!state.moneyCommitted||!request
            ||request.settlementId!==settlementId||!DIGEST.test(state.requestDigest)||request.trade.sellerAgentId!==actorAgentId
            ||!verifyTrade(request.trade))throw new Error('Settlement is not a verified completed actor payment');
        const soldAssetId=request.trade.assetId;if(soldAssetId===null||request.trade.provenanceDigest===null){unlinkedSettlementIds.push(settlementId);continue}
        const sold=provenance.getAsset(soldAssetId);if(!sold||sold.provenanceRootDigest!==request.trade.provenanceDigest
            ||sold.itemId!==request.trade.itemId||sold.quantity!==request.trade.quantity){unlinkedSettlementIds.push(settlementId);continue}
        const ancestors=provenance.listAncestorAssetIds(soldAssetId),candidateIds=new Set([soldAssetId,...ancestors]);
        const sources=events.filter(event=>event.assetId!==null&&candidateIds.has(event.assetId)).map(event=>event.eventId).sort();
        if(sources.length===0){unlinkedSettlementIds.push(settlementId);continue}
        paidDispositionChains.push({settlementId,tradeReceiptId:request.trade.receiptId,soldAssetId,
            sourceTheftEventIds:sources,transformationAncestorAssetIds:ancestors,coinsReceivedGp:request.trade.coinsPaid})}
    assertAudits();
    const discoveries=receiptIds.map(receiptId=>thieving.listDiscoveries(receiptId));
    return{scope:'selected-thieving-provenance-and-settlement-cohort',actorAgentId,sourceReceiptIds:receiptIds,
        selectedTheftEventIds:theftEventIds,selectedSettlementIds:settlementIds,coverage:{selectedReceipts:receiptIds.length,
            receiptsWithVerifiedTheftLoss:linkedReceipts.size,verifiedTheftEvents:events.length,
            receiptsWithObservedDiscovery:discoveries.filter(values=>values.length>0).length,
            verifiedPaidDispositionChains:paidDispositionChains.length,unlinkedSettlementIds},observed:{
            outcomesWithDiscovery:discoveries.filter(values=>values.length>0).length,
            outcomesWithIdentification:discoveries.filter(values=>values.some(value=>value.actorIdentification!=='none')).length},
        verifiedVictimLosses:events.map(event=>({theftEventId:event.eventId,receiptId:event.sourceRecordId,itemId:event.itemId,
            quantity:event.quantity,titleOwner:event.titleAfter,monetaryDamageGp:null})),
        verifiedGrossIncomeGp:paidDispositionChains.reduce((sum,value)=>sum+value.coinsReceivedGp,0),paidDispositionChains,
        unavailable:{netIncome:'no-verified-cost-basis',monetaryHarm:'no-verified-victim-valuation-or-realized-replacement-cost'}}
}

export interface ProspectiveDiscoveryRiskEstimate{kind:'prospective-estimate';method:'selected-cohort-observed-discovery-rate';
    actorAgentId:string;sourceReceiptIds:string[];sampleSize:number;observedDiscoveries:number;estimatedBasisPoints:number;
    representsOccurredEvent:false;limitations:['selected-cohort-not-population','historical-observation-not-causal-risk-model']}
/** Explicitly labelled estimate; it does not create a discovery, finding, sanction or wanted score. */
export function estimateProspectiveDiscoveryRisk(thieving:Pick<ThievingProcedureStore,'verifyAuditChain'|'getOutcome'|'listDiscoveries'>,
    actorAgentIdInput:string,receiptIdsInput:readonly string[]):ProspectiveDiscoveryRiskEstimate{
    const actorAgentId=typeof actorAgentIdInput==='string'&&ID.test(actorAgentIdInput)?actorAgentIdInput:(()=>{throw new Error('actorAgentId is invalid')})();
    const receiptIds=ids(receiptIdsInput,'Receipt cohort');if(!thieving.verifyAuditChain())throw new Error('Thieving audit chain is invalid');
    let observedDiscoveries=0;for(const receiptId of receiptIds){const receipt=thieving.getOutcome(receiptId);
        if(!receipt||receipt.actorAgentId!==actorAgentId)throw new Error('Receipt cohort is missing or belongs to another actor');
        if(thieving.listDiscoveries(receiptId).length>0)observedDiscoveries++}
    if(!thieving.verifyAuditChain())throw new Error('Thieving audit chain changed during estimate');
    return{kind:'prospective-estimate',method:'selected-cohort-observed-discovery-rate',actorAgentId,sourceReceiptIds:receiptIds,
        sampleSize:receiptIds.length,observedDiscoveries,estimatedBasisPoints:Math.round(observedDiscoveries*10_000/receiptIds.length),
        representsOccurredEvent:false,limitations:['selected-cohort-not-population','historical-observation-not-causal-risk-model']}}
