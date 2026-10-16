import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore,projectAttestedObserverUnderworldContext,UnderworldClaimStore } from '../../agent-state/index.js';
import { BusinessAssetStore } from '../../business-assets/index.js';
import { loadItemLifecycleCatalog,loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { ItemProvenanceStore,loadItemProvenancePolicyCatalog } from '../../item-provenance/index.js';
import { decideSaleChannel,loadDefaultSaleChannelPolicyCatalog } from '../../sale-channel-policy/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { createFencingSettlementPorts,decideFencingParticipation,EngineFencingClaimVerifier,
    EngineTradeEvidenceSource,executeLiveFencingSettlement,FencingSettlementCoordinator,
    loadDefaultFencingMarketPolicy,projectKnownFencingMarket,rememberFencingCounterparty,
    type FencingCandidateSnapshot,type FencingOpportunity,type FencingSettlementRequest } from '../index.js';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const at='2030-01-01T00:00:00.000Z',tradeAt='2030-01-01T00:01:00.000Z',restartAt='2030-01-01T00:02:00.000Z';

function provenanceStore(path:string){const config=join(import.meta.dir,'..','..','config'),lifecycle=loadItemLifecycleCatalog(
        join(config,'item-lifecycle.json')),state=loadItemStatePolicyCatalog(join(config,'item-state-policies.json'),lifecycle);
    return new ItemProvenanceStore(path,loadItemProvenancePolicyCatalog(join(config,'item-provenance-policies.json'),state))}
function identity(store:AgentStateStore,agentId:string){store.createIdentity({agentId,playerUsername:agentId,
    displayName:agentId[0]!.toUpperCase()+agentId.slice(1),background:'Integration test agent.',personalityTraits:['careful']},at)}

describe('live fencing pipeline',()=>{
    test('learns an observer-bound partner from an exact engine-paid Business trade and survives restart and loss',()=>{
        const root=mkdtempSync(join(tmpdir(),'fencing-live-'));roots.push(root);const businessPath=join(root,'business.sqlite'),
            treasuryPath=join(root,'treasury.sqlite'),provenancePath=join(root,'provenance.sqlite'),tradePath=join(root,'trades.sqlite'),
            settlementPath=join(root,'settlements.sqlite'),agentPath=join(root,'agents.sqlite'),claimPath=join(root,'claims.sqlite');
        const manager=new BusinessManagerStore(businessPath);manager.createGenesis('shadow-genesis',{businessId:'shadow-traders',
            name:'Shadow Traders',summary:'Finite player-operated business.',ownerAgentId:'buyer',propertyId:'shadow-property'},at);manager.close();
        const assets=new BusinessAssetStore(businessPath);assets.createStorage({storageId:'shadow-vault',businessId:'shadow-traders',
            actorAgentId:'buyer',name:'Vault',capacityUnits:10},at);const treasury=new InstitutionTreasuryStore(treasuryPath);
        treasury.creditGenesis('business','shadow-traders','shadow-capital',100,at);treasury.reserve('business','shadow-traders',
            'fencing.offer-1',40,at);const provenance=provenanceStore(provenancePath),registered=provenance.register({
                eventId:'register-pickaxe',assetId:'pickaxe-1',itemId:1265,quantity:1,titleOwner:{kind:'agent',id:'victim'},
                holder:{kind:'agent',id:'thief'},evidence:{evidenceId:'existing-theft-proof',sourceDomain:'item-lifecycle',
                    sourceRecordId:'pickaxe-state',sourceStateVersion:1,sourceEvidenceDigest:'e'.repeat(64),occurredAt:at}},()=>true,at);
        const tradeWriter=new TradeEvidenceStore(tradePath),engineTrade=tradeWriter.record({tick:100,fromUsername:'thief',
            toUsername:'buyer',fromItems:[{id:1265,name:'Bronze pickaxe',count:1}],toItems:[{id:995,name:'Coins',count:40}],
            fromValue:20,toValue:40,committedAt:tradeAt},'20000000-0000-4000-8000-000000000001');tradeWriter.close();
        let agents=new AgentStateStore(agentPath);identity(agents,'thief');identity(agents,'buyer');identity(agents,'outsider');
        let claims=new UnderworldClaimStore(claimPath),active=true,source=new EngineTradeEvidenceSource(tradePath);
        const marketPolicy=loadDefaultFencingMarketPolicy(),salePolicy=loadDefaultSaleChannelPolicyCatalog(),
            candidate:FencingCandidateSnapshot={candidateId:'shadow-traders',kind:'business',operatorAgentId:'buyer',
                lifecycleStatus:'active',availableGp:60,storageAvailableUnits:10,capabilities:['trade.appraise'],relationships:[
                    {counterpartyAgentId:'thief',familiarity:60,trust:30}],sourceEvidenceDigest:'a'.repeat(64)},
            opportunity:FencingOpportunity={opportunityId:'offer-1',sellerAgentId:'thief',itemId:1265,quantity:1,
                assetId:'pickaxe-1',provenanceDigest:registered.provenanceRootDigest,storageUnits:1,acquisitionCostGp:40,
                expectedResaleGp:80,estimatedRiskCostGp:10,requiredCapabilities:['trade.appraise'],sourceEvidenceDigest:'c'.repeat(64)},
            trade={receiptId:engineTrade.eventId,buyerAgentId:'buyer',sellerAgentId:'thief',itemId:1265,quantity:1,
                coinsPaid:40,assetId:'pickaxe-1',assetRevision:1,provenanceDigest:registered.provenanceRootDigest,
                status:'committed' as const,partial:false as const,sourceEvidenceDigest:engineTrade.eventDigest,occurredAt:tradeAt},
            request:FencingSettlementRequest={settlementId:'11111111-1111-4111-8111-111111111111',
                reservationId:'fencing.offer-1',storageId:'shadow-vault',candidate,opportunity,
                decision:decideFencingParticipation(marketPolicy,candidate,opportunity),trade},offer={offerId:'shop.offer-1',
                channel:'business-shop' as const,sellerAgentId:'thief',acquirer:{kind:'business' as const,id:'shadow-traders'},
                itemId:1265,quantity:1,assetId:'pickaxe-1',provenanceDigest:registered.provenanceRootDigest},inspection={
                evidenceId:'inspection.offer-1',offerId:'shop.offer-1',inspector:{kind:'business' as const,id:'shadow-traders'},
                method:'local-provenance-record' as const,finding:'no-match' as const,sourceRecordId:'inspection-record-1',
                sourceEvidenceDigest:'f'.repeat(64),occurredAt:tradeAt},saleDecision=decideSaleChannel(salePolicy,offer,[inspection],()=>true);
        let coordinator=new FencingSettlementCoordinator(settlementPath,marketPolicy,createFencingSettlementPorts({provenance,
            businessAssets:assets,treasury,verifyBusinessReceipt:receipt=>source.get(receipt.sourceReceiptId)?.eventDigest
                ===receipt.sourceEvidenceDigest}));
        try{
            expect(projectKnownFencingMarket(marketPolicy,[candidate],opportunity,
                projectAttestedObserverUnderworldContext(agents,claims,new EngineFencingClaimVerifier('thief',coordinator,source,
                    agents,()=>active), 'thief',tradeAt))).toMatchObject({availability:'unavailable',participants:[]});
            expect(executeLiveFencingSettlement({request,saleDecision,salePolicy,coordinator,trades:source,agents},tradeAt))
                .toMatchObject({status:'committed',provenanceCommitted:true,stockCommitted:true,moneyCommitted:true});
            expect(provenance.getAsset('pickaxe-1')).toMatchObject({titleOwner:{id:'victim'},holder:{kind:'business',
                id:'shadow-traders'},revision:2});expect(assets.listAssets('shadow-traders','shadow-vault'))
                .toContainEqual(expect.objectContaining({itemId:1265,count:1}));expect(treasury.get('business','shadow-traders'))
                .toMatchObject({balanceGp:60,reservedGp:0});
            const rejected=decideSaleChannel(salePolicy,offer,[{...inspection,evidenceId:'inspection.rejected',
                finding:'recognized-ineligible'}],()=>true);expect(()=>executeLiveFencingSettlement({request,saleDecision:rejected,
                salePolicy,coordinator,trades:source,agents},tradeAt)).toThrow('Business acquisition is not eligible');
            expect(coordinator.getRecordedRequest(request.settlementId)?.trade.receiptId).toBe(engineTrade.eventId);
            expect(source.createFencingTradeVerifier(agents)({...trade,sourceEvidenceDigest:'0'.repeat(64)})).toBeFalse();
            coordinator.close();source.close();coordinator=new FencingSettlementCoordinator(settlementPath,marketPolicy,
                createFencingSettlementPorts({provenance,businessAssets:assets,treasury,verifyBusinessReceipt:receipt=>
                    source.get(receipt.sourceReceiptId)?.eventDigest===receipt.sourceEvidenceDigest}));source=new EngineTradeEvidenceSource(tradePath);
            expect(executeLiveFencingSettlement({request,saleDecision,salePolicy,coordinator,trades:source,agents},restartAt))
                .toMatchObject({status:'committed'});expect(treasury.get('business','shadow-traders')?.balanceGp).toBe(60);
            const verifier=new EngineFencingClaimVerifier('thief',coordinator,source,agents,()=>active,30*24*60*60*1000,
                ()=>restartAt);rememberFencingCounterparty({agents,claims,verifier,settlementId:request.settlementId,
                    observerAgentId:'thief',counterpartyAgentId:'buyer',occurredAt:tradeAt});
            const learned=projectAttestedObserverUnderworldContext(agents,claims,verifier,'thief',restartAt);
            expect(learned.contacts).toContainEqual(expect.objectContaining({actorKey:'buyer',blockers:[],
                possibleFenceClaimIds:[expect.any(String)]}));expect(projectKnownFencingMarket(marketPolicy,[candidate],opportunity,learned))
                .toMatchObject({availability:'available',participants:[{candidateId:'shadow-traders',participate:true}]});
            expect(projectAttestedObserverUnderworldContext(agents,claims,new EngineFencingClaimVerifier('outsider',coordinator,
                source,agents,()=>active),'outsider',restartAt).contacts).toEqual([]);
            agents.close();claims.close();agents=new AgentStateStore(agentPath);claims=new UnderworldClaimStore(claimPath);
            const restartedVerifier=new EngineFencingClaimVerifier('thief',coordinator,source,agents,()=>active,
                30*24*60*60*1000,()=>restartAt);expect(projectAttestedObserverUnderworldContext(agents,claims,restartedVerifier,
                    'thief',restartAt).contacts[0]).toMatchObject({actorKey:'buyer',blockers:[]});
            active=false;const unavailable=projectKnownFencingMarket(marketPolicy,[candidate],opportunity,
                projectAttestedObserverUnderworldContext(agents,claims,restartedVerifier,'thief',restartAt));
            expect(unavailable).toEqual({opportunityId:'offer-1',availability:'unavailable',participants:[]});
            const claimId=learned.contacts[0]!.possibleFenceClaimIds[0]!;claims.revoke('revoke.inactive-buyer',claimId,
                {kind:'observed-counterparty-action',id:request.settlementId,revision:1},restartedVerifier);
            expect(claims.verifyAuditChain()).toBeTrue();expect(coordinator.verifyAuditChain()).toBeTrue();
            expect(source.verifyAuditChain()).toBeTrue()
        }finally{coordinator.close();source.close();claims.close();agents.close();provenance.close();assets.close();treasury.close()}
    });

    test('direct player trade preserves stolen-asset origin without shop inspection or Business side effects',()=>{
        const root=mkdtempSync(join(tmpdir(),'fencing-player-'));roots.push(root);const businessPath=join(root,'business.sqlite'),
            treasuryPath=join(root,'treasury.sqlite'),provenancePath=join(root,'provenance.sqlite'),tradePath=join(root,'trades.sqlite');
        const manager=new BusinessManagerStore(businessPath);manager.close();const assets=new BusinessAssetStore(businessPath),
            treasury=new InstitutionTreasuryStore(treasuryPath),provenance=provenanceStore(provenancePath),registered=provenance.register({
                eventId:'register-ring',assetId:'ring-1',itemId:1265,quantity:1,titleOwner:{kind:'agent',id:'victim'},
                holder:{kind:'agent',id:'thief'},evidence:{evidenceId:'ring-theft-proof',sourceDomain:'item-lifecycle',
                    sourceRecordId:'ring-state',sourceStateVersion:1,sourceEvidenceDigest:'e'.repeat(64),occurredAt:at}},()=>true,at),
            writer=new TradeEvidenceStore(tradePath),engineTrade=writer.record({tick:101,fromUsername:'thief',toUsername:'buyer',
                fromItems:[{id:1265,name:'Bronze pickaxe',count:1}],toItems:[{id:995,name:'Coins',count:25}],fromValue:20,toValue:25,
                committedAt:tradeAt},'20000000-0000-4000-8000-000000000002');writer.close();
        const agents=new AgentStateStore(join(root,'agents.sqlite'));identity(agents,'thief');identity(agents,'buyer');
        const source=new EngineTradeEvidenceSource(tradePath),policy=loadDefaultFencingMarketPolicy(),salePolicy=loadDefaultSaleChannelPolicyCatalog(),
            candidate:FencingCandidateSnapshot={candidateId:'buyer',kind:'agent',operatorAgentId:'buyer',lifecycleStatus:'active',
                availableGp:25,storageAvailableUnits:1,capabilities:['trade.appraise'],relationships:[{counterpartyAgentId:'thief',
                    familiarity:60,trust:30}],sourceEvidenceDigest:'a'.repeat(64)},opportunity:FencingOpportunity={opportunityId:'ring-offer',
                sellerAgentId:'thief',itemId:1265,quantity:1,assetId:'ring-1',provenanceDigest:registered.provenanceRootDigest,
                storageUnits:1,acquisitionCostGp:25,expectedResaleGp:40,estimatedRiskCostGp:5,requiredCapabilities:['trade.appraise'],
                sourceEvidenceDigest:'c'.repeat(64)},trade={receiptId:engineTrade.eventId,buyerAgentId:'buyer',sellerAgentId:'thief',
                itemId:1265,quantity:1,coinsPaid:25,assetId:'ring-1',assetRevision:1,provenanceDigest:registered.provenanceRootDigest,
                status:'committed' as const,partial:false as const,sourceEvidenceDigest:engineTrade.eventDigest,occurredAt:tradeAt},
            request:FencingSettlementRequest={settlementId:'22222222-2222-4222-8222-222222222222',reservationId:null,storageId:null,
                candidate,opportunity,decision:decideFencingParticipation(policy,candidate,opportunity),trade},saleDecision=decideSaleChannel(
                    salePolicy,{offerId:'player.offer-1',channel:'player-trade',sellerAgentId:'thief',acquirer:{kind:'agent',id:'buyer'},
                        itemId:1265,quantity:1,assetId:'ring-1',provenanceDigest:registered.provenanceRootDigest},[]),coordinator=
                new FencingSettlementCoordinator(join(root,'settlement.sqlite'),policy,createFencingSettlementPorts({provenance,
                    businessAssets:assets,treasury}));
        try{expect(executeLiveFencingSettlement({request,saleDecision,salePolicy,coordinator,trades:source,agents},tradeAt))
                .toMatchObject({status:'committed',provenanceCommitted:true,stockCommitted:true,moneyCommitted:true});
            expect(provenance.getAsset('ring-1')).toMatchObject({titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'buyer'},
                revision:2});expect(assets.verifyReceiptAuditChain()).toBeTrue();expect(treasury.get('business','buyer')).toBeNull()
        }finally{coordinator.close();source.close();agents.close();provenance.close();assets.close();treasury.close()}
    })
});
