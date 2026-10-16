import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BusinessAssetStore } from '../../business-assets/index.js';
import { loadItemLifecycleCatalog,loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { ItemProvenanceStore,loadItemProvenancePolicyCatalog } from '../../item-provenance/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { createFencingSettlementPorts,decideFencingParticipation,FencingSettlementCoordinator,
    loadDefaultFencingMarketPolicy,type FencingCandidateSnapshot,type FencingOpportunity,
    type FencingTradeReceipt } from '../index.js';

const directories:string[]=[];afterEach(()=>directories.splice(0).forEach(value=>rmSync(value,{recursive:true,force:true})));
describe('fencing settlement store adapters',()=>{
    test('moves tracked custody, finite Business stock and reserved treasury exactly once',()=>{const root=mkdtempSync(
            join(tmpdir(),'fencing-adapters-'));directories.push(root);const businessPath=join(root,'business.sqlite'),
            treasuryPath=join(root,'treasury.sqlite'),provenancePath=join(root,'provenance.sqlite'),at='2030-01-01T00:00:00.000Z';
        const manager=new BusinessManagerStore(businessPath);manager.createGenesis('shadow-genesis',{businessId:'shadow-traders',
            name:'Shadow Traders',summary:'Ordinary finite Business.',ownerAgentId:'buyer',propertyId:'shadow-property'},at);manager.close();
        const assets=new BusinessAssetStore(businessPath);assets.createStorage({storageId:'shadow-vault',businessId:'shadow-traders',
            actorAgentId:'buyer',name:'Vault',capacityUnits:10},at);const treasury=new InstitutionTreasuryStore(treasuryPath);
        treasury.creditGenesis('business','shadow-traders','shadow-capital',100,at);treasury.reserve('business','shadow-traders',
            'fencing.offer-1',40,at);const config=join(import.meta.dir,'..','..','config'),lifecycle=loadItemLifecycleCatalog(
                join(config,'item-lifecycle.json')),state=loadItemStatePolicyCatalog(join(config,'item-state-policies.json'),lifecycle),
            provenance=new ItemProvenanceStore(provenancePath,loadItemProvenancePolicyCatalog(
                join(config,'item-provenance-policies.json'),state));provenance.register({eventId:'register-pickaxe',assetId:'pickaxe-1',
                itemId:1265,quantity:1,titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'thief'},evidence:{
                    evidenceId:'existing-theft-proof',sourceDomain:'item-lifecycle',sourceRecordId:'pickaxe-state',sourceStateVersion:1,
                    sourceEvidenceDigest:'e'.repeat(64),occurredAt:at}},()=>true,at);
        const candidate:FencingCandidateSnapshot={candidateId:'shadow-traders',kind:'business',operatorAgentId:'buyer',
            lifecycleStatus:'active',availableGp:60,storageAvailableUnits:10,capabilities:['trade.appraise'],relationships:[
                {counterpartyAgentId:'thief',familiarity:60,trust:30}],sourceEvidenceDigest:'a'.repeat(64)},
            opportunity:FencingOpportunity={opportunityId:'offer-1',sellerAgentId:'thief',itemId:1265,quantity:1,
                assetId:'pickaxe-1',provenanceDigest:'b'.repeat(64),storageUnits:1,acquisitionCostGp:40,expectedResaleGp:80,
                estimatedRiskCostGp:10,requiredCapabilities:['trade.appraise'],sourceEvidenceDigest:'c'.repeat(64)},
            trade:FencingTradeReceipt={receiptId:'trade-1',buyerAgentId:'buyer',sellerAgentId:'thief',itemId:1265,quantity:1,
                coinsPaid:40,assetId:'pickaxe-1',assetRevision:1,provenanceDigest:'b'.repeat(64),status:'committed',partial:false,
                sourceEvidenceDigest:'d'.repeat(64),occurredAt:'2030-01-01T00:01:00.000Z'},policy=loadDefaultFencingMarketPolicy();
        const coordinator=new FencingSettlementCoordinator(join(root,'settlement.sqlite'),policy,createFencingSettlementPorts({
            provenance,businessAssets:assets,treasury,verifyBusinessReceipt:receipt=>receipt.sourceReceiptId==='trade-1'}));
        try{const request={settlementId:'11111111-1111-4111-8111-111111111111',reservationId:'fencing.offer-1',
                storageId:'shadow-vault',candidate,opportunity,decision:decideFencingParticipation(policy,candidate,opportunity),trade};
            expect(coordinator.settle(request,receipt=>receipt.receiptId==='trade-1')).toMatchObject({status:'committed'});
            expect(coordinator.settle(request,receipt=>receipt.receiptId==='trade-1')).toMatchObject({status:'committed'});
            expect(provenance.getAsset('pickaxe-1')).toMatchObject({titleOwner:{id:'victim'},holder:{kind:'business',
                id:'shadow-traders'},theftHistoryCount:0,revision:2});expect(assets.listAssets('shadow-traders','shadow-vault'))
                .toContainEqual(expect.objectContaining({itemId:1265,count:1}));expect(treasury.get('business','shadow-traders'))
                .toMatchObject({balanceGp:60,reservedGp:0});expect(assets.verifyReceiptAuditChain()).toBeTrue();
            expect(provenance.verifyAuditChain()).toBeTrue();expect(coordinator.verifyAuditChain()).toBeTrue()
        }finally{coordinator.close();provenance.close();assets.close();treasury.close()}});
});
