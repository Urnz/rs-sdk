import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BusinessAssetStore } from '../../business-assets/index.js';
import { decideBusinessStock,loadDefaultBusinessStockPolicyCatalog,type StockMovementEvidence } from '../../business-stock-policy/index.js';
import { BusinessWorkStore } from '../../business-work/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { decideSaleChannel,loadSaleChannelPolicyCatalog,type SaleChannelDecision } from '../../sale-channel-policy/index.js';
import { AgentOperatedShopLifecycle,type CommittedMoneyEvidence } from '../index.js';

const directories:string[]=[];afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});
const at='2026-09-20T10:00:00.000Z',later='2026-09-20T10:30:00.000Z';
const trusted=()=>true;
function setup(){const root=mkdtempSync(join(tmpdir(),'agent-shop-'));directories.push(root);
    const businessPath=join(root,'business.sqlite'),treasuryPath=join(root,'treasury.sqlite');
    const manager=new BusinessManagerStore(businessPath);manager.createGenesis('lumbridge-store-business',{businessId:'lumbridge-general-store',
        name:'Lumbridge General Store',summary:'Finite agent-operated shop.',ownerAgentId:'lumbridge-shopkeeper-owner',
        propertyId:'lumbridge-general-store'},at);manager.creditGenesisInventory('hammer-opening-stock','lumbridge-general-store',2347,5,at);
    manager.hire('lumbridge-general-store',{workerAgentId:'lumbridge-shop-clerk',roleDefinitionId:'business.shop-clerk.v1',
        title:'Shop clerk',wageGp:20,requiredSkill:{id:'trade.lumbridge.give-item',version:'1.0.0'}},at,
    '11111111-1111-4111-8111-111111111111');manager.close();
    const treasury=new InstitutionTreasuryStore(treasuryPath);treasury.creditGenesis('business','lumbridge-general-store',
        'lumbridge-store-capital',1000,at);treasury.close();
    return{root,businessPath,treasuryPath,lifecycle:new AgentOperatedShopLifecycle(join(root,'lifecycle.sqlite'),businessPath,treasuryPath)}}
function stockEvidence(direction:'sale'|'procurement',quantity:number):StockMovementEvidence{return{kind:'verified-skill',
    evidenceId:`hammer-${direction}-${quantity}`,status:'completed',businessId:'lumbridge-general-store',itemId:2347,quantity,
    unitPriceGp:direction==='sale'?5:10,direction,skill:direction==='sale'?{id:'trade.lumbridge.give-item',version:'1.0.0'}:
        {id:'shopping.lumbridge.buy-hammers',version:'1.0.0'},occurredAt:at}}
function money(settlementId:string,amountGp:number,sourceRef:string,reservationId:string|null=null):CommittedMoneyEvidence{
    return{settlementId,reservationId,amountGp,sourceRef,status:'committed',occurredAt:at}}
function acquisition(evidenceId:string,quantity:number,recognized=false):SaleChannelDecision{const catalog=loadSaleChannelPolicyCatalog(
    join(import.meta.dir,'..','..','config','sale-channel-policies.json')),offer={offerId:evidenceId,channel:'business-shop' as const,
        sellerAgentId:'supplier',acquirer:{kind:'business' as const,id:'lumbridge-general-store'},itemId:2347,quantity,
        assetId:null,provenanceDigest:null};return decideSaleChannel(catalog,offer,recognized?[{evidenceId:`inspection-${evidenceId}`,
            offerId:evidenceId,inspector:offer.acquirer,method:'document-check',finding:'recognized-ineligible',
            sourceRecordId:`report-${evidenceId}`,sourceEvidenceDigest:'a'.repeat(64),occurredAt:at}]:[],()=>true)}

describe('agent-operated finite shop lifecycle',()=>{
    test('runs sale, reorder, procurement, storage, verified work, wage and profit without minting runtime stock',()=>{
        const {businessPath,treasuryPath,lifecycle}=setup(),catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
        try{const saleDecision=decideBusinessStock(policy,catalog,5),saleInput={operationId:'cycle.sale-1',kind:'sale' as const,
            policyId:policy.policyId,decision:saleDecision,stockEvidence:stockEvidence('sale',3),stockSettlementId:'cycle.sale-stock-1',
            moneyEvidence:money('22222222-2222-4222-8222-222222222222',15,'player-escrow.sale-1'),acquisitionDecision:null};
        expect(lifecycle.settleStock(saleInput,trusted,trusted,at)).toMatchObject({status:'committed',amountGp:15});
        expect(lifecycle.settleStock(saleInput,trusted,trusted,at)).toMatchObject({status:'committed',amountGp:15});
        const afterSale=lifecycle.snapshot('lumbridge-general-store');expect(afterSale.inventory).toContainEqual({itemId:2347,count:2});
        expect(afterSale.treasury.balanceGp).toBe(1015);expect(afterSale.reorderDecisions[0]?.procurement)
            .toEqual({quantity:6,maxUnitPriceGp:10});

        const treasury=new InstitutionTreasuryStore(treasuryPath);treasury.reserve('business','lumbridge-general-store',
            'shop.procurement-1',60,at);treasury.close();const reorder=afterSale.reorderDecisions[0]!;
        lifecycle.settleStock({operationId:'cycle.procurement-1',kind:'procurement',policyId:policy.policyId,decision:reorder,
            stockEvidence:stockEvidence('procurement',6),stockSettlementId:'cycle.procurement-stock-1',
            moneyEvidence:money('33333333-3333-4333-8333-333333333333',60,'supplier-reward.procurement-1','shop.procurement-1'),
            acquisitionDecision:acquisition('hammer-procurement-6',6)},
        trusted,trusted,at);

        const assets=new BusinessAssetStore(businessPath);assets.createStorage({storageId:'lumbridge-general-store.stockroom',
            businessId:'lumbridge-general-store',actorAgentId:'lumbridge-shopkeeper-owner',name:'Stockroom',
            propertyId:'lumbridge-general-store',capacityUnits:100},at);
        assets.move({operationId:'cycle.store-1',businessId:'lumbridge-general-store',actorAgentId:'lumbridge-shopkeeper-owner',
            itemId:2347,count:6,sourceStorageId:null,targetStorageId:'lumbridge-general-store.stockroom'},at);
        assets.move({operationId:'cycle.shelf-1',businessId:'lumbridge-general-store',actorAgentId:'lumbridge-shopkeeper-owner',
            itemId:2347,count:6,sourceStorageId:'lumbridge-general-store.stockroom',targetStorageId:null},at);
        expect(assets.listMovements('lumbridge-general-store')).toHaveLength(2);assets.close();

        const work=new BusinessWorkStore(businessPath);work.grantEntitlement({entitlementId:'lumbridge-counter-access',
            businessId:'lumbridge-general-store',propertyId:'lumbridge-general-store',facilityCapability:'retail.counter',
            validFrom:at,validUntil:null},at);work.createWorkOrder('cycle.work-1','lumbridge-general-store.shop-clerk.v1',
            '11111111-1111-4111-8111-111111111111',at,later,at);work.start('cycle.work-1',at);work.complete('cycle.work-1',{
                evidenceId:'cycle-work-proof-1',workOrderId:'cycle.work-1',businessId:'lumbridge-general-store',
                workerAgentId:'lumbridge-shop-clerk',skill:{id:'trade.lumbridge.give-item',version:'1.0.0'},status:'completed',
                startedAt:at,completedAt:later},trusted);work.close();
        const wageTreasury=new InstitutionTreasuryStore(treasuryPath);wageTreasury.reserve('business','lumbridge-general-store',
            'shop.wage-1',20,at);wageTreasury.close();lifecycle.settleWage({operationId:'cycle.wage-1',businessId:'lumbridge-general-store',
                workOrderId:'cycle.work-1',moneyEvidence:money('44444444-4444-4444-8444-444444444444',20,
                    'player-reward.wage-1','shop.wage-1')},trusted,later);

        const final=lifecycle.snapshot('lumbridge-general-store');expect(final.inventory).toContainEqual({itemId:2347,count:8});
        expect(final.treasury).toMatchObject({balanceGp:935,reservedGp:0,availableGp:935});
        expect(final).toMatchObject({grossRevenueGp:15,procurementCostGp:60,wageCostGp:20,operatingProfitGp:-65,
            reorderDecisions:[]});expect(final.operations.map(value=>value.kind)).toEqual(['procurement','sale','wage']);
        const verifiedWork=new BusinessWorkStore(businessPath);expect(verifiedWork.get('cycle.work-1'))
            .toMatchObject({status:'completed',wageStatus:'paid',wageSettlementId:'44444444-4444-4444-8444-444444444444'});
        verifiedWork.close()}finally{lifecycle.close()}
    });

    test('stops before mutation on untrusted money evidence and preserves a recoverable failed step',()=>{
        const {businessPath,lifecycle}=setup(),catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
        try{const decision=decideBusinessStock(policy,catalog,5),input={operationId:'cycle.rejected-sale',kind:'sale' as const,
            policyId:policy.policyId,decision,stockEvidence:stockEvidence('sale',1),stockSettlementId:'cycle.rejected-stock',
            moneyEvidence:money('55555555-5555-4555-8555-555555555555',5,'player-escrow.rejected'),acquisitionDecision:null};
        expect(()=>lifecycle.settleStock(input,trusted,()=>false,at)).toThrow('not trusted');
        const manager=new BusinessManagerStore(businessPath);expect(manager.listInventory('lumbridge-general-store'))
            .toContainEqual(expect.objectContaining({itemId:2347,count:5}));manager.close();expect(lifecycle.list('lumbridge-general-store')).toEqual([])
        }finally{lifecycle.close()}
    });

    test('rejects merchant-recognized procurement before stock or treasury mutation',()=>{
        const {businessPath,lifecycle}=setup(),catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
        try{const manager=new BusinessManagerStore(businessPath),before=manager.listInventory('lumbridge-general-store');manager.close();
            const decision=decideBusinessStock(policy,catalog,1),evidence=stockEvidence('procurement',7);
            expect(()=>lifecycle.settleStock({operationId:'cycle.stolen-procurement',kind:'procurement',policyId:policy.policyId,
                decision,stockEvidence:evidence,stockSettlementId:'cycle.stolen-stock',moneyEvidence:money(
                    '66666666-6666-4666-8666-666666666666',70,'supplier-reward.stolen','shop.stolen'),
                acquisitionDecision:acquisition(evidence.evidenceId,7,true)},trusted,trusted,at)).toThrow('not eligible');
            const reopened=new BusinessManagerStore(businessPath);expect(reopened.listInventory('lumbridge-general-store')).toEqual(before);
            reopened.close();expect(lifecycle.get('cycle.stolen-procurement')).toBeNull()
        }finally{lifecycle.close()}
    });
});
