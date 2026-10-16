import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentOperatedShopLifecycle } from '../agent-operated-shop/index.js';
import { AgentStateStore } from '../agent-state/store.js';
import { BusinessAssetStore } from '../business-assets/index.js';
import { decideBusinessStock,loadDefaultBusinessStockPolicyCatalog,type StockMovementEvidence } from '../business-stock-policy/index.js';
import { BusinessWorkStore } from '../business-work/index.js';
import { BusinessManagerStore } from '../server/gateway/admin/business-manager.js';
import { requestEnginePlayerEscrow } from '../server/gateway/admin/player-escrow.js';
import { requestEnginePlayerReward } from '../server/gateway/admin/player-rewards.js';
import { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import { agentStateDbPath,businessManagerDbPath,institutionTreasuryDbPath,repoRoot } from '../server/gateway/admin/paths.js';

const stage=process.argv.find(value=>value.startsWith('--'))?.slice(2);
if(!stage||!['bootstrap','sale','procurement','wage','report'].includes(stage))throw new Error('Unknown live accounting stage');
const liveDir=join(repoRoot,'.local','economy','agent-shop-live'),manifestPath=join(liveDir,'manifest.json');
const lifecyclePath=join(repoRoot,'.local','economy','agent-shop-lifecycle.sqlite');
mkdirSync(liveDir,{recursive:true});
const catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
const lifecycle=()=>new AgentOperatedShopLifecycle(lifecyclePath,businessManagerDbPath,institutionTreasuryDbPath,catalog);
const now=()=>new Date().toISOString();
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receipt=(name:string)=>JSON.parse(readFileSync(join(liveDir,`${name}.json`),'utf8')) as Record<string,any>;
const exactTrade=(left:Record<string,any>,right:Record<string,any>,giveId:number,giveCount:number,receiveId:number,receiveCount:number)=>{
    const a=left.result?.served?.trades?.[0]??left.result?.traded,b=right.result?.served?.trades?.[0]??right.result?.traded;
    const count=(items:any[]|undefined,itemId:number)=>items?.filter(item=>item.id===itemId)
        .reduce((sum,item)=>sum+Number(item.count),0)??0;
    if(!a?.success||!b?.success||count(a.gave,giveId)!==giveCount||count(a.received,receiveId)!==receiveCount
        ||count(b.gave,receiveId)!==receiveCount||count(b.received,giveId)!==giveCount)throw new Error('Live trade receipts do not reconcile')
};
const stockEvidence=(direction:'sale'|'procurement',quantity:number,evidenceId:string,occurredAt:string):StockMovementEvidence=>({
    kind:'verified-skill',evidenceId,status:'completed',businessId:'lumbridge-general-store',itemId:2347,quantity,
    unitPriceGp:direction==='sale'?5:10,direction,skill:direction==='sale'?{id:'trade.lumbridge.give-item',version:'1.0.0'}:
        {id:'shopping.lumbridge.buy-hammers',version:'1.0.0'},occurredAt});

if(stage==='bootstrap'){
    if(existsSync(manifestPath))throw new Error('Live shop pilot was already bootstrapped');
    const agents=new AgentStateStore(agentStateDbPath);try{
        if(!agents.getIdentity('lumbridge-general-store-mind'))agents.createIdentity({agentId:'lumbridge-general-store-mind',
            playerUsername:null,displayName:'Lumbridge General Store',background:'Institution agent for finite retail policy.',
            personalityTraits:['prudent','service-oriented'],controlProfile:{role:'institution',subjectKind:'business',
                subjectId:'lumbridge-general-store',decisionIntervalMs:300_000,maxDecisionsPerDay:48,
                dailyLlmBudgetMicros:500_000,dailyOperationalBudgetGp:200}})
    }finally{agents.close()}
    const start=now(),end=new Date(Date.parse(start)+30*60_000).toISOString();
    const manager=new BusinessManagerStore(businessManagerDbPath);try{manager.createGenesis('lumbridge-general-store-business-v1',{
        businessId:'lumbridge-general-store',name:'Lumbridge General Store',summary:'Finite agent-operated live pilot.',
        ownerAgentId:'ferrye14',propertyId:'lumbridge-general-store'},start);
        manager.creditGenesisInventory('lumbridge-general-store-hammer-v1','lumbridge-general-store',2347,5,start);
        const business=manager.get('lumbridge-general-store')!;if(!business.employments.some(value=>value.employmentId===
            '77777777-7777-4777-8777-777777777777'))manager.hire('lumbridge-general-store',{workerAgentId:'vrtrader1',
                roleDefinitionId:'business.shop-clerk.v1',title:'Live pilot shop clerk',wageGp:20,
                requiredSkill:{id:'trade.lumbridge.give-item',version:'1.0.0'}},start,
            '77777777-7777-4777-8777-777777777777')
    }finally{manager.close()}
    const treasury=new InstitutionTreasuryStore(institutionTreasuryDbPath);try{treasury.creditGenesis('business',
        'lumbridge-general-store','lumbridge-general-store-business-v1:capital',1000,start)}finally{treasury.close()}
    const assets=new BusinessAssetStore(businessManagerDbPath);try{if(!assets.listStorages('lumbridge-general-store').some(value=>
            value.storageId==='lumbridge-general-store.stockroom'))assets.createStorage({storageId:'lumbridge-general-store.stockroom',
            businessId:'lumbridge-general-store',actorAgentId:'ferrye14',name:'General Store stockroom',
            propertyId:'lumbridge-general-store',capacityUnits:100},start)}finally{assets.close()}
    const work=new BusinessWorkStore(businessManagerDbPath);try{work.grantEntitlement({entitlementId:'lumbridge-general-store-counter-live',
        businessId:'lumbridge-general-store',propertyId:'lumbridge-general-store',facilityCapability:'retail.counter',validFrom:start,
        validUntil:end},start);work.createWorkOrder('lumbridge-live-shift-1','lumbridge-general-store.shop-clerk.v1',
        '77777777-7777-4777-8777-777777777777',start,end,start);work.start('lumbridge-live-shift-1',start)}finally{work.close()}
    writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,startedAt:start,scheduledEnd:end},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({stage,status:'ready',startedAt:start,scheduledEnd:end},null,2))
}

if(stage==='sale'){
    const seller=receipt('seller'),buyer=receipt('buyer');exactTrade(seller,buyer,2347,3,995,15);
    const escrowId='88888888-8888-4888-8888-888888888888';const held=await requestEnginePlayerEscrow({escrowId,
        operation:'hold',username:'VRTrader1',assets:{gp:15,items:[]}});if(held.escrow?.status!=='held')throw new Error('Sale GP was not held');
    const consumed=await requestEnginePlayerEscrow({escrowId,operation:'consume',username:'VRTrader1'});
    if(consumed.escrow?.status!=='committed'||consumed.escrow.payeeUsername!==null)throw new Error('Sale GP was not consumed');
    const decision=decideBusinessStock(policy,catalog,5),store=lifecycle();try{const settled=store.settleStock({operationId:'live.sale-1',
        kind:'sale',policyId:policy.policyId,decision,stockEvidence:stockEvidence('sale',3,'live-sale-trade-1',seller.completedAt),
        stockSettlementId:'live.sale-stock-1',moneyEvidence:{settlementId:escrowId,reservationId:null,amountGp:15,
            sourceRef:`player-escrow:${escrowId}`,status:'committed',occurredAt:seller.completedAt}},()=>true,
        evidence=>evidence.settlementId===escrowId&&consumed.escrow?.status==='committed',now());
        console.log(JSON.stringify({stage,settled,reorder:store.snapshot('lumbridge-general-store').reorderDecisions},null,2))}finally{store.close()}
}

if(stage==='procurement'){
    const supplier=receipt('supplier'),receiver=receipt('stock-receiver');exactTrade(supplier,receiver,2347,6,995,0);
    const store=lifecycle(),before=store.snapshot('lumbridge-general-store'),decision=before.reorderDecisions[0];
    if(!decision?.procurement||decision.procurement.quantity!==6){store.close();throw new Error('Exact live reorder decision is missing')}
    const treasury=new InstitutionTreasuryStore(institutionTreasuryDbPath);try{treasury.reserve('business','lumbridge-general-store',
        'shop.live-procurement-1',60,now())}finally{treasury.close()}
    const settlementId='99999999-9999-4999-8999-999999999999',reward=await requestEnginePlayerReward('VRWorker1',60,settlementId);
    if(!reward.ok||reward.reward?.status!=='committed')throw new Error('Supplier reward was not committed');
    try{const settled=store.settleStock({operationId:'live.procurement-1',kind:'procurement',policyId:policy.policyId,decision,
        stockEvidence:stockEvidence('procurement',6,'live-procurement-trade-1',supplier.completedAt),
        stockSettlementId:'live.procurement-stock-1',moneyEvidence:{settlementId,reservationId:'shop.live-procurement-1',
            amountGp:60,sourceRef:'player-reward:live-procurement-1',status:'committed',occurredAt:supplier.completedAt}},()=>true,
        evidence=>evidence.settlementId===reward.settlementId&&reward.amount===evidence.amountGp,now());
        const assets=new BusinessAssetStore(businessManagerDbPath);try{assets.move({operationId:'live.stockroom-1',businessId:'lumbridge-general-store',
            actorAgentId:'ferrye14',itemId:2347,count:6,sourceStorageId:null,
            targetStorageId:'lumbridge-general-store.stockroom'},now());assets.move({operationId:'live.shelf-1',businessId:'lumbridge-general-store',
            actorAgentId:'ferrye14',itemId:2347,count:6,sourceStorageId:'lumbridge-general-store.stockroom',
            targetStorageId:null},now())}finally{assets.close()}
        console.log(JSON.stringify({stage,settled,snapshot:store.snapshot('lumbridge-general-store')},null,2))}finally{store.close()}
}

if(stage==='wage'){
    const shift=receipt('work-shift-2'),startedAt=String(shift.result?.startedAt),completedAt=String(shift.result?.completedAt);
    const startPosition=shift.result?.startPosition,endPosition=shift.result?.endPosition;
    if(!Number.isFinite(Date.parse(startedAt))||!Number.isFinite(Date.parse(completedAt))
        ||Date.parse(completedAt)-Date.parse(startedAt)<60_000||startPosition?.x<3205||startPosition?.x>3218
        ||startPosition?.z<3238||startPosition?.z>3255||endPosition?.x<3205||endPosition?.x>3218
        ||endPosition?.z<3238||endPosition?.z>3255)throw new Error('Live shop shift receipt is invalid');
    const scheduledEnd=new Date(Date.parse(startedAt)+10*60_000).toISOString();
    const work=new BusinessWorkStore(businessManagerDbPath);try{const abandoned=work.get('lumbridge-live-shift-1');
        if(abandoned?.status==='running')work.expire(abandoned.workOrderId,now());
        work.grantEntitlement({entitlementId:'lumbridge-general-store-counter-live-2',businessId:'lumbridge-general-store',
            propertyId:'lumbridge-general-store',facilityCapability:'retail.counter',validFrom:startedAt,validUntil:scheduledEnd},startedAt);
        work.createWorkOrder('lumbridge-live-shift-2','lumbridge-general-store.shop-clerk.v1',
            '77777777-7777-4777-8777-777777777777',startedAt,scheduledEnd,startedAt);
        work.start('lumbridge-live-shift-2',startedAt);work.complete('lumbridge-live-shift-2',{evidenceId:'live-shop-work-2',
            workOrderId:'lumbridge-live-shift-2',businessId:'lumbridge-general-store',workerAgentId:'vrtrader1',
            skill:{id:'trade.lumbridge.give-item',version:'1.0.0'},status:'completed',startedAt,completedAt},()=>true)}finally{work.close()}
    const treasury=new InstitutionTreasuryStore(institutionTreasuryDbPath);try{treasury.reserve('business','lumbridge-general-store',
        'shop.live-wage-1',20,completedAt)}finally{treasury.close()}
    const settlementId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reward=await requestEnginePlayerReward('VRTrader1',20,settlementId);
    if(!reward.ok||reward.reward?.status!=='committed')throw new Error('Worker wage reward was not committed');
    const store=lifecycle();try{const settled=store.settleWage({operationId:'live.wage-1',businessId:'lumbridge-general-store',
        workOrderId:'lumbridge-live-shift-2',moneyEvidence:{settlementId,reservationId:'shop.live-wage-1',amountGp:20,
            sourceRef:'player-reward:live-wage-1',status:'committed',occurredAt:completedAt}},
        evidence=>evidence.settlementId===reward.settlementId&&reward.amount===evidence.amountGp,completedAt);
        console.log(JSON.stringify({stage,settled,snapshot:store.snapshot('lumbridge-general-store')},null,2))}finally{store.close()}
}

if(stage==='report'){
    const agents=new AgentStateStore(agentStateDbPath),manager=new BusinessManagerStore(businessManagerDbPath),
        work=new BusinessWorkStore(businessManagerDbPath),assets=new BusinessAssetStore(businessManagerDbPath),store=lifecycle();
    try{const snapshot=store.snapshot('lumbridge-general-store'),report={schemaVersion:1,generatedAt:now(),
        ownerAgent:agents.getIdentity('ferrye14')?.agentId,institutionProfile:agents.getControlProfile('lumbridge-general-store-mind'),
        business:manager.get('lumbridge-general-store'),workOrder:work.get('lumbridge-live-shift-2'),
        expiredWorkOrder:work.get('lumbridge-live-shift-1'),
        storageMovements:assets.listMovements('lumbridge-general-store'),snapshot};
        const passed=report.ownerAgent==='ferrye14'&&report.institutionProfile?.subjectId==='lumbridge-general-store'
            &&report.workOrder?.wageStatus==='paid'&&snapshot.inventory.some(value=>value.itemId===2347&&value.count===8)
            &&snapshot.treasury.balanceGp===935&&snapshot.operatingProfitGp===-65&&snapshot.reorderDecisions.length===0
            &&snapshot.operations.length===3&&report.storageMovements.length===2;if(!passed)throw new Error('Live shop acceptance report failed');
        const output={...report,passed,evidenceDigest:digest(report)};writeFileSync(join(liveDir,'acceptance-report.json'),
            JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(output,null,2))
    }finally{agents.close();manager.close();work.close();assets.close();store.close()}
}
