import{createHash}from'node:crypto';import type{AgentStateStore}from'../agent-state/store.js';
import type{UnderworldClaim,UnderworldClaimSourceRef,UnderworldClaimStore,UnderworldClaimVerifier}from'../agent-state/underworld-claims.js';
import{assertAcceptedBusinessAcquisition,assertAcceptedPlayerTrade}from'../sale-channel-policy/policy.js';
import type{SaleChannelDecision,SaleChannelPolicyCatalog}from'../sale-channel-policy/types.js';
import type{EngineTradeEvidenceSource}from'./engine-trade-source.js';import type{FencingSettlementCoordinator}from'./settlement.js';
import{projectFencingMarket}from'./policy.js';
import type{AttestedObserverUnderworldContext}from'../agent-state/underworld-context.js';
import type{FencingCandidateSnapshot,FencingMarketPolicy,FencingMarketProjection,FencingOpportunity,
    FencingSettlementRecord,FencingSettlementRequest}from'./types.js';
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
export interface FencingSettlementEvidenceSource{verifyAuditChain():boolean;get(id:string):FencingSettlementRecord|null;
    getRecordedRequest(id:string):Readonly<FencingSettlementRequest>|null}
/** Observer-bound verifier: only the seller learns the exact, still-active buyer from a committed fencing trade. */
export class EngineFencingClaimVerifier implements UnderworldClaimVerifier{
    constructor(private readonly observerAgentId:string,private readonly settlements:FencingSettlementEvidenceSource,
        private readonly trades:EngineTradeEvidenceSource,private readonly agents:Pick<AgentStateStore,'getIdentity'>,
        private readonly candidateActive:(agentId:string)=>boolean,private readonly lifetimeMs=30*24*60*60*1000,
        private readonly now:()=>string=()=>new Date().toISOString()){}
    verifyClaim(ref:Readonly<UnderworldClaimSourceRef>){const source=this.source(ref);if(!source||!this.candidateActive(source.request.candidate.operatorAgentId))return null;
        const from=source.request.trade.occurredAt,validUntil=new Date(Date.parse(from)+this.lifetimeMs).toISOString();return{
            observerAgentId:this.observerAgentId,actorKey:source.request.candidate.operatorAgentId,
            role:'possible-fence-counterparty' as const,validFrom:from,validUntil,
            sourceDigest:hash({settlementId:ref.id,requestDigest:source.record.requestDigest,tradeDigest:source.request.trade.sourceEvidenceDigest})}}
    verifyRevocation(ref:Readonly<UnderworldClaimSourceRef>,claim:Readonly<UnderworldClaim>){const source=this.source(ref);
        if(!source||claim.observerAgentId!==this.observerAgentId||claim.actorKey!==source.request.candidate.operatorAgentId
            ||this.candidateActive(source.request.candidate.operatorAgentId))return null;return{claimId:claim.claimId,
            sourceDigest:hash({claimId:claim.claimId,settlementId:ref.id,status:'inactive'}),occurredAt:this.now()}}
    private source(ref:Readonly<UnderworldClaimSourceRef>){if(ref.kind!=='observed-counterparty-action'||ref.revision!==1
            ||!this.settlements.verifyAuditChain())return null;const record=this.settlements.get(ref.id),request=this.settlements.getRecordedRequest(ref.id);
        if(!record||record.status!=='committed'||!request||request.trade.sellerAgentId!==this.observerAgentId
            ||!this.trades.createFencingTradeVerifier(this.agents)(request.trade))return null;return{record,request}}
}
export function executeLiveFencingSettlement(input:{request:FencingSettlementRequest;saleDecision:SaleChannelDecision;
    salePolicy:SaleChannelPolicyCatalog;coordinator:FencingSettlementCoordinator;trades:EngineTradeEvidenceSource;
    agents:Pick<AgentStateStore,'getIdentity'>},now?:string):FencingSettlementRecord{
    const {request, saleDecision, salePolicy}=input,common={offerId:saleDecision.offer.offerId,itemId:request.trade.itemId,
        quantity:request.trade.quantity,policyDigest:salePolicy.digest};
    if(saleDecision.offer.sellerAgentId!==request.trade.sellerAgentId||saleDecision.offer.assetId!==request.trade.assetId
        ||saleDecision.offer.provenanceDigest!==request.trade.provenanceDigest)
        throw new Error('Sale channel decision does not match the fencing trade');
    if(request.candidate.kind==='business')assertAcceptedBusinessAcquisition(saleDecision,{...common,
        businessId:request.candidate.candidateId});else assertAcceptedPlayerTrade(saleDecision,{...common,
        buyerAgentId:request.trade.buyerAgentId,sellerAgentId:request.trade.sellerAgentId,assetId:request.trade.assetId,
        provenanceDigest:request.trade.provenanceDigest});
    return input.coordinator.settle(request,input.trades.createFencingTradeVerifier(input.agents),now)
}
/** Seller-side discovery boundary: only candidates backed by this observer's active, direct contact claims reach policy. */
export function projectKnownFencingMarket(policy:FencingMarketPolicy,candidates:FencingCandidateSnapshot[],
    opportunity:FencingOpportunity,context:AttestedObserverUnderworldContext):FencingMarketProjection{
    if(context.observerAgentId!==opportunity.sellerAgentId)throw new Error('Fencing context belongs to another observer');
    const known=new Set(context.contacts.filter(contact=>contact.possibleFenceClaimIds.length>0).map(contact=>contact.actorKey));
    return projectFencingMarket(policy,candidates.filter(candidate=>known.has(candidate.operatorAgentId)),opportunity)
}
export function rememberFencingCounterparty(input:{agents:AgentStateStore;claims:UnderworldClaimStore;
    verifier:EngineFencingClaimVerifier;settlementId:string;observerAgentId:string;counterpartyAgentId:string;
    occurredAt:string}):void{const ref={kind:'observed-counterparty-action' as const,id:input.settlementId,revision:1};
    const key=createHash('sha256').update(input.settlementId).digest('hex').slice(0,24),episodeId=`fencing.trade.${key}`;
    const episode=input.agents.createEpisode(input.observerAgentId,{episodeId,kind:'interaction',summary:'Completed a verified direct trade.',
        details:`Engine trade evidence for ${input.settlementId}.`,importance:60,actors:[input.counterpartyAgentId],tags:['trade','fencing-contact'],
        source:'system',trust:'trusted',externalKey:`fencing-trade:${input.settlementId}`,occurredAt:input.occurredAt,expiresAt:null},input.occurredAt);
    const identity=input.agents.getIdentity(input.counterpartyAgentId),current=input.agents.getRelationship(input.observerAgentId,input.counterpartyAgentId);
    if(!current?.evidenceEpisodeIds.includes(episode.episodeId))input.agents.setRelationship(input.observerAgentId,current?.revision??null,{
        actorKey:input.counterpartyAgentId,displayName:identity?.displayName??input.counterpartyAgentId,trust:current?.trust??20,
        affinity:current?.affinity??0,familiarity:Math.min(100,(current?.familiarity??0)+10),agentOwesGp:current?.agentOwesGp??0,
        actorOwesGp:current?.actorOwesGp??0,notes:current?.notes??'',tags:[...new Set([...(current?.tags??[]),'trade-contact'])],
        evidenceEpisodeIds:[...new Set([...(current?.evidenceEpisodeIds??[]),episode.episodeId])],lastInteractionAt:input.occurredAt},input.occurredAt);
    input.agents.createKnowledge(input.observerAgentId,{knowledgeId:`fencing.contact.${key}`,kind:'economic',subject:input.counterpartyAgentId,
        predicate:'possible-fence-counterparty',object:input.counterpartyAgentId,summary:'A verified completed trade supports a possible partner claim.',
        confidence:70,tags:['fencing-contact'],evidenceEpisodeIds:[episode.episodeId],source:'system',externalKey:`fencing-claim:${input.settlementId}`,
        validFrom:input.occurredAt,validUntil:new Date(Date.parse(input.occurredAt)+30*24*60*60*1000).toISOString()},input.occurredAt);
    input.claims.attest(`attest.${key}`,`claim.${key}`,ref,input.verifier,input.occurredAt)
}
