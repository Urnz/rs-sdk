import { describe, expect, test } from 'bun:test';

import type { FencingSettlementRecord, FencingSettlementRequest } from '../../fencing-market/index.js';
import type { ItemProvenanceAsset, ItemProvenanceEvent } from '../../item-provenance/index.js';
import type { ThievingDiscoveryObservation, ThievingOutcomeReceipt } from '../../thieving-procedures/index.js';
import { estimateProspectiveDiscoveryRisk, projectVerifiedCrimeEconomics } from '../verified-economics.js';

const receipt:ThievingOutcomeReceipt={receiptId:'receipt-1',evidenceId:'engine-1',procedureId:'container.theft',
    procedureVersion:'1.0.0',procedureKind:'container-theft',actorAgentId:'thief',playerUsername:'thief',
    target:{kind:'loc',typeId:1,instanceIndex:null,name:'Crate',x:1,z:1,level:0},result:'succeeded',effect:'item-transfer',
    transferredItems:[{itemId:377,itemName:'Raw lobster',quantity:2}],thievingXpDelta:5,startedAtEngineTick:1,
    endedAtEngineTick:2,sourceEventId:'engine-event-1',sourceEvidenceDigest:'a'.repeat(64),
    occurredAt:'2030-01-01T10:00:00.000Z',receiptDigest:'b'.repeat(64),recordedAt:'2030-01-01T10:00:01.000Z'};
const theft:ItemProvenanceEvent={eventId:'theft-event-1',evidenceId:'theft-proof-1',kind:'stolen',
    assetId:'raw-lobster-lot',itemId:377,quantity:2,titleBefore:{kind:'agent',id:'victim'},titleAfter:{kind:'agent',id:'victim'},
    holderBefore:{kind:'agent',id:'victim'},holderAfter:{kind:'agent',id:'thief'},sourceDomain:'thieving-procedures',
    sourceRecordId:'receipt-1',sourceStateVersion:1,sourceEvidenceDigest:'b'.repeat(64),occurredAt:receipt.occurredAt,
    eventDigest:'c'.repeat(64),recordedAt:receipt.recordedAt};
const cooked:ItemProvenanceAsset={assetId:'cooked-lobster-lot',tier:'provenance-lot',stateMode:'batch',itemId:379,
    quantity:2,titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'buyer'},provenanceRootDigest:'d'.repeat(64),
    theftHistoryCount:1,lifecycleStatus:'active',consumedByTransformationId:null,createdAt:'2030-01-01T10:05:00.000Z',
    updatedAt:'2030-01-01T10:10:00.000Z',revision:2};
const trade={receiptId:'trade-receipt-1',buyerAgentId:'buyer',sellerAgentId:'thief',itemId:379,quantity:2,coinsPaid:120,
    assetId:'cooked-lobster-lot',assetRevision:1,provenanceDigest:'d'.repeat(64),status:'committed' as const,partial:false as const,
    sourceEvidenceDigest:'e'.repeat(64),occurredAt:'2030-01-01T10:10:00.000Z'};
const request:FencingSettlementRequest={settlementId:'settlement-1',reservationId:null,storageId:null,
    candidate:{candidateId:'buyer',kind:'agent',operatorAgentId:'buyer',lifecycleStatus:'active',availableGp:1000,
        storageAvailableUnits:10,capabilities:[],relationships:[],sourceEvidenceDigest:'f'.repeat(64)},
    opportunity:{opportunityId:'opportunity-1',sellerAgentId:'thief',itemId:379,quantity:2,assetId:'cooked-lobster-lot',
        provenanceDigest:'d'.repeat(64),storageUnits:2,acquisitionCostGp:120,expectedResaleGp:200,estimatedRiskCostGp:10,
        requiredCapabilities:[],sourceEvidenceDigest:'1'.repeat(64)},decision:{candidateId:'buyer',candidateKind:'agent',
        operatorAgentId:'buyer',opportunityId:'opportunity-1',participate:true,reason:'eligible-profitable',expectedProfitGp:70,
        committedCapitalGp:120,sourceDigests:['f'.repeat(64),'1'.repeat(64)],policyDigest:'2'.repeat(64),decisionDigest:'3'.repeat(64)},trade};
const settlement:FencingSettlementRecord={settlementId:'settlement-1',candidateId:'buyer',opportunityId:'opportunity-1',
    tradeReceiptId:'trade-receipt-1',requestDigest:'4'.repeat(64),provenanceCommitted:true,stockCommitted:true,
    moneyCommitted:true,status:'committed',lastError:null,createdAt:'2030-01-01T10:10:00.000Z',updatedAt:'2030-01-01T10:10:01.000Z'};
const observation:ThievingDiscoveryObservation={observationId:'observation-1',evidenceId:'observation-proof-1',
    outcomeReceiptId:'receipt-1',source:'owner-loss-report',observerAgentId:'victim',actorIdentification:'inferred',
    suspectAgentId:'thief',facts:['Loss confirmed.'],sourceEvidenceDigest:'5'.repeat(64),occurredAt:'2030-01-01T10:01:00.000Z',
    observationDigest:'6'.repeat(64),recordedAt:'2030-01-01T10:01:01.000Z'};
function sources(){return{thieving:{verifyAuditChain:()=>true,getOutcome:(id:string)=>id==='receipt-1'?structuredClone(receipt):null,
        listDiscoveries:(id:string)=>id==='receipt-1'?[structuredClone(observation)]:[]},provenance:{verifyAuditChain:()=>true,
        getEvent:(id:string)=>id==='theft-event-1'?structuredClone(theft):null,
        getAsset:(id:string)=>id==='cooked-lobster-lot'?structuredClone(cooked):null,
        listAncestorAssetIds:(id:string)=>id==='cooked-lobster-lot'?['raw-lobster-lot']:[]},
    settlements:{verifyAuditChain:()=>true,get:(id:string)=>id==='settlement-1'?structuredClone(settlement):null,
        getRecordedRequest:(id:string)=>id==='settlement-1'?structuredClone(request):null}}}

describe('verified crime economic and risk metrics',()=>{
    test('joins theft through transformed ancestry to confirmed payment without inventing monetary harm',()=>{const s=sources();
        const result=projectVerifiedCrimeEconomics(s.thieving,s.provenance,s.settlements,value=>value.sourceEvidenceDigest==='e'.repeat(64),
            'thief',['receipt-1'],['theft-event-1'],['settlement-1']);
        expect(result.verifiedGrossIncomeGp).toBe(120);expect(result.verifiedVictimLosses).toEqual([
            expect.objectContaining({theftEventId:'theft-event-1',itemId:377,quantity:2,monetaryDamageGp:null})]);
        expect(result.paidDispositionChains[0]).toMatchObject({soldAssetId:'cooked-lobster-lot',
            sourceTheftEventIds:['theft-event-1'],transformationAncestorAssetIds:['raw-lobster-lot'],coinsReceivedGp:120});
        expect(result.coverage).toMatchObject({selectedReceipts:1,receiptsWithVerifiedTheftLoss:1,
            receiptsWithObservedDiscovery:1,verifiedPaidDispositionChains:1});
        expect(result).not.toHaveProperty('wanted');expect(result.unavailable.monetaryHarm).toContain('no-verified-victim-valuation')});
    test('does not count an unrelated but valid settlement as criminal income',()=>{const s=sources();
        s.provenance.listAncestorAssetIds=()=>[];s.provenance.getAsset=()=>({...cooked,assetId:'other-asset'});
        request.trade.assetId='other-asset';request.trade.provenanceDigest=cooked.provenanceRootDigest;
        const result=projectVerifiedCrimeEconomics(s.thieving,s.provenance,s.settlements,()=>true,'thief',['receipt-1'],
            ['theft-event-1'],['settlement-1']);expect(result.verifiedGrossIncomeGp).toBe(0);
        expect(result.coverage.unlinkedSettlementIds).toEqual(['settlement-1']);request.trade.assetId='cooked-lobster-lot'});
    test('fails closed when payment or any source audit is untrusted',()=>{const s=sources();expect(()=>projectVerifiedCrimeEconomics(
        s.thieving,s.provenance,s.settlements,()=>false,'thief',['receipt-1'],['theft-event-1'],['settlement-1']))
        .toThrow('not a verified completed actor payment');s.settlements.verifyAuditChain=()=>false;
        expect(()=>projectVerifiedCrimeEconomics(s.thieving,s.provenance,s.settlements,()=>true,'thief',['receipt-1'],[],[]))
            .toThrow('audit chain')});
    test('labels future risk as an estimate, not an occurred event or wanted score',()=>{const s=sources();
        expect(estimateProspectiveDiscoveryRisk(s.thieving,'thief',['receipt-1'])).toEqual({kind:'prospective-estimate',
            method:'selected-cohort-observed-discovery-rate',actorAgentId:'thief',sourceReceiptIds:['receipt-1'],sampleSize:1,
            observedDiscoveries:1,estimatedBasisPoints:10_000,representsOccurredEvent:false,
            limitations:['selected-cohort-not-population','historical-observation-not-causal-risk-model']})});
});
