import { expect,test } from 'bun:test';
import { copyFileSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { BankingLedgerStore } from '../../server/gateway/admin/banking-ledger.js';
import { BankingLoanStore } from '../../server/gateway/admin/banking-loans.js';
import { EconomicContractStore } from '../../server/gateway/admin/economic-contracts.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { createSaveData } from '../../sdk/test/utils/save-generator.js';
import { fixture,start,at } from './native-boundary-fixture.js';
import { captureNativeFinanceBoundary,readNativeFinanceBoundary,financeWageProofs,type FinanceBoundaryPaths,type NativeFinanceOptions } from '../finance-sources.js';
import { reportNativeFinance,businessCashflows } from '../native-finance.js';
import type { BusinessWorkBinding } from '../../business-work/binding.js';
import { reportSocietyEvaluation } from '../evaluation-report.js';
import { evaluateSocietyObservations } from '../evaluation.js';
import { handleAdminRequest } from '../../server/gateway/admin/routes.js';
import type { BotSupervisor } from '../../server/gateway/admin/supervisor.js';
import type { InstitutionSettlementRecord } from '../../server/gateway/admin/institution-settlement-orchestrator.js';
function setup(){
    const f=fixture();f.assets();
    const manager=new BusinessManagerStore(f.options.businessPath);manager.create({businessId:'forge',ownerAgentId:'ada',name:'Forge',summary:'Native finance fixture.'},start);manager.close();
    const treasury=new InstitutionTreasuryStore(f.options.treasuryPath);treasury.setBalance('business','forge',1,200,start);treasury.close();
    const bankPath=join(f.root,'bank.sqlite'),contractPath=join(f.root,'contracts.sqlite'),tradePath=join(f.root,'server/engine/data/mods/trade-evidence.sqlite');
    const bank=new BankingLedgerStore(bankPath);bank.createBank('local-bank','bank-treasury',2000,0);bank.openAccount('local-bank','forge-deposit','business','forge');bank.close();
    const loan=new BankingLoanStore(bankPath);loan.close();const contracts=new EconomicContractStore(contractPath);contracts.close();
    const trade=(itemId=377,gp=5,units=2,hours=0)=>{
        const ledger=new TradeEvidenceStore(tradePath,event=>{f.clock.bindEvent({clockId:'world',domain:'engine-trade',sourceId:event.eventId,
            sourceDigest:event.eventDigest,wallTime:event.committedAt,engineTick:event.tick});});
        try{return ledger.record({tick:Math.round(hours*6000),fromUsername:'ada',toUsername:'bea',fromItems:[{id:itemId,name:'Goods',count:units}],
            toItems:gp?[{id:995,name:'Coins',count:gp}]:[],fromValue:gp,toValue:gp,committedAt:at(hours)});}finally{ledger.close();}
    };
    const freeze=(name:string)=>{const paths:FinanceBoundaryPaths=f.freeze(name),dir=dirname(paths.clockPath);
        for(const [key,path,filename] of [['bankingPath',bankPath,'bank.sqlite'],['contractsPath',contractPath,'contracts.sqlite'],['tradePath',tradePath,'trades.sqlite']] as const){
            const db=new OwnedDatabase(path);try{db.run('PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close(true);}
            paths[key]=join(dir,filename);copyFileSync(path,paths[key]!);
        }return{id:name,paths};};
    const boundaries=(missing=false,endBusinessCash=150,duringWindow?:()=>void)=>{
        trade();if(!missing)trade(379,20,2);else trade(379,0,2);f.advance(0);f.clock.pause('world',f.clock.get('world')!.revision,start);
        const opening=freeze('finance-opening');f.clock.resume('world',f.clock.get('world')!.revision,start);f.advance(1);
        trade(377,10,2,1);if(!missing)trade(379,20,2,1);duringWindow?.();
        f.db.run('UPDATE accounts SET save=? WHERE owner=?',[createSaveData({coins:40,bank:[{id:379,count:2}]}),'ada']);
        f.db.run('UPDATE accounts SET save=? WHERE owner=?',[createSaveData({coins:160,bank:[{id:379,count:2}]}),'bea']);
        const t=new InstitutionTreasuryStore(f.options.treasuryPath);t.setBalance('business','forge',t.get('business','forge')!.revision,endBusinessCash,at(1));t.close();
        f.clock.pause('world',f.clock.get('world')!.revision,at(1));const closing=freeze('finance-closing');
        const options:NativeFinanceOptions={native:f.options,opening,closing,basket:[{itemId:377,fixedWeight:1},{itemId:379,fixedWeight:1}],maxPriceAgeSimulationMs:3600000};
        return options;
    };
    return{...f,trade,freeze,boundaries,bankPath,contractPath};
}
const record=(f:ReturnType<typeof setup>,options:NativeFinanceOptions)=>{
    captureNativeFinanceBoundary(f.scope,options,'opening');captureNativeFinanceBoundary(f.scope,options,'closing');
    return reportNativeFinance(f.scope,options);
};
test('SI-C04 native immutable boundaries feed GP-only Gini/mobility, rational fixed basket and visible Business losses',()=>{
    const f=setup(),options=f.boundaries(),report=record(f,options);
    expect(report.status).toBe('observed-boundaries');expect(report.cashChange).toMatchObject({openingGp:'600',closingGp:'550',deltaGp:'-50'});
    expect(report.business!.rows[0]).toMatchObject({cashDeltaGp:'-50',unclassifiedCashDeltaGp:'-50',completeCashflowCoverage:false});
    expect(report.observations.mobility!.find(p=>p.actorAgentId==='ada')).toEqual({actorAgentId:'ada',openingWealthGp:100,closingWealthGp:40});
    const calculated=evaluateSocietyObservations(f.scope,report.observations);
    expect(calculated.objectives.find(o=>o.id==='wealth-distribution')!.metrics[0]!.basisPoints).toBe('2250');
    expect(calculated.objectives.find(o=>o.id==='price-stability')!.metrics[0]!.basisPoints).toBe('5000');
    expect(report.priceBasket.items[0]!.opening).toMatchObject({gp:5,units:2});
    const before=Object.entries(options.closing.paths).map(([key,path])=>[key,createHash('sha256').update(readFileSync(path!)).digest('hex')]);
    expect(reportNativeFinance(f.scope,options).digest).toBe(report.digest);expect(captureNativeFinanceBoundary(f.scope,options,'opening').id).toBe(options.opening.id);
    expect(Object.entries(options.closing.paths).map(([key,path])=>[key,createHash('sha256').update(readFileSync(path!)).digest('hex')])).toEqual(before);
    const integrated=reportSocietyEvaluation(f.scope,{configDirectory:join(f.root,'config'),nativeFinance:options,
        dependencies:{enginePath:options.closing.paths.tradePath!,productionPath:options.closing.paths.businessPath,
            clockPath:options.closing.paths.clockPath,agentPath:join(f.root,'missing-agents.sqlite')}});
    expect(integrated.calculation.objectives.find(o=>o.id==='wealth-distribution')!.status).toBe('observed');
    console.log('SI-C04_ACCEPTANCE',JSON.stringify({scope:f.scope,opening:report.opening,closing:report.closing,cashChange:report.cashChange,
        prices:report.priceBasket,business:report.business,calculation:calculated,digest:report.digest}));
});
test('SI-C04 missing basket item stays inconclusive; no gift/quantity pooling or after-boundary price substitution',()=>{
    const f=setup(),options=f.boundaries(true),report=record(f,options);
    expect(report.priceBasket.status).toBe('inconclusive');expect(report.observations.prices).toBeUndefined();expect(report.observations.wealth).toHaveLength(4);
    expect(report.priceBasket.items[1]!.opening).toBeNull();
});
test('SI-C04 source mutation, clock drift, unknown observation or attempted rebinding cannot become historical success',()=>{
    const f=setup(),options=f.boundaries();record(f,options);
    const path=options.closing.paths.checkpointPath,db=new OwnedDatabase(path);
    try{db.run('UPDATE accounts SET save=? WHERE owner=?',[createSaveData({coins:999}),'ada']);}finally{db.close(true);}
    expect(reportNativeFinance(f.scope,options).closing.status).toBe('invalid');expect(reportNativeFinance(f.scope,options).observations.wealth).toBeUndefined();
    expect(()=>captureNativeFinanceBoundary(f.scope,options,'closing')).toThrow('identity conflict');
    expect(reportNativeFinance({...f.scope,clockProfileDigest:'f'.repeat(64)},options).status).toBe('inconclusive');
    expect(reportNativeFinance(f.scope,{...options,opening:{...options.opening,id:'missing-observation'}}).opening.status).toBe('unavailable');
});
test('SI-C04 deposits, loans and conditional contract obligations are explicit and never added again to physical GP',()=>{
    const f=setup(),receipt=(kind:string,gp:number):InstitutionSettlementRecord=>({domain:'banking',eventId:randomUUID(),eventKind:kind,sourceRef:'bank-proof',
        payerKind:'business',payerActorId:kind==='deposit-cleared'?'forge':'bank-treasury',payeeKind:'business',payeeActorId:kind==='deposit-cleared'?'bank-treasury':'forge',
        amountGp:gp,eventDigest:'a'.repeat(64),verifiedAt:start,settlementId:randomUUID(),reservationId:randomUUID(),status:'committed',createdAt:start,updatedAt:start});
    const bank=new BankingLedgerStore(f.bankPath);try{bank.postSettlement('forge-deposit','deposit',receipt('deposit-cleared',1000),start);}finally{bank.close();}
    const loan=new BankingLoanStore(f.bankPath);try{loan.create({loanId:'forge-loan',bankId:'local-bank',bankTreasuryActorId:'bank-treasury',
        borrowerKind:'business',borrowerActorId:'forge',principalGp:50,annualInterestBps:0,termDays:30},start);loan.disburse('forge-loan',receipt('loan-disbursed',50));}finally{loan.close();}
    const contracts=new EconomicContractStore(f.contractPath);try{
        const offer=contracts.create({creatorAgentId:'ada',counterpartyAgentId:'bea',kind:'trade',title:'Native obligation',summary:'Conditional GP against copper.',
            creatorProvides:{gp:5,items:[],service:null},counterpartyProvides:{gp:0,items:[{id:436,name:'Copper ore',count:1}],service:null},expiresAt:at(2)},start);
        contracts.accept(offer.offerId,'bea',offer.revision,start);
    }finally{contracts.close();}
    const options=f.boundaries(),report=record(f,options);expect(report.cashChange!.openingGp).toBe('600');
    if(report.opening.status!=='available')throw new Error('Missing native boundary');
    expect(report.opening.claims!.depositClaims![0]!.amountGp).toBe('1000');expect(report.opening.claims!.loanDebts![0]!.principalGp).toBe('50');
    expect(report.opening.claims!.contractObligations!.find(c=>c.debtor==='ada')!.remainingConditionalGp).toBe('5');expect(report.opening.claims!.netWorthGp).toBeNull();
});
test('SI-C04 an actual internal treasury transfer has zero aggregate cash effect and is not Business revenue',()=>{
    const f=setup(),manager=new BusinessManagerStore(f.options.businessPath);
    manager.create({businessId:'other-forge',ownerAgentId:'bea',name:'Other forge',summary:'Internal transfer recipient.'},start);manager.close();
    const openingTreasury=new InstitutionTreasuryStore(f.options.treasuryPath);openingTreasury.ensure('business','other-forge',start);openingTreasury.close();
    const options=f.boundaries(false,160,()=>{const t=new InstitutionTreasuryStore(f.options.treasuryPath);try{
        const reservationId=randomUUID(),settlementId=randomUUID();t.reserve('business','forge',reservationId,40,at(1));
        t.bindSettlement(reservationId,settlementId,at(1));
        t.transferReserved(reservationId,settlementId,'business','other-forge',at(1));
    }finally{t.close();}
        const manager=new BusinessManagerStore(f.options.businessPath);try{
            manager.update('other-forge',1,{name:'Other forge',summary:'Recorded closing fixture.',status:'closed'},at(1));
            manager.create({businessId:'new-forge',ownerAgentId:'cora',name:'New forge',summary:'Observed founding fixture.'},at(1));
        }finally{manager.close();}
    }),report=record(f,options);
    expect(report.cashChange).toMatchObject({openingGp:'600',closingGp:'600',deltaGp:'0'});
    expect(report.business!.rows.find(b=>b.businessId==='forge')!.cashDeltaGp).toBe('-40');
    expect(report.business!.rows.find(b=>b.businessId==='other-forge')!.cashDeltaGp).toBe('40');
    expect(report.business!.rows.every(b=>b.observedRevenueGp==='0')).toBeTrue();expect(report.business!.treasuryTransfers).toHaveLength(1);
    expect(report.business!.rows.find(b=>b.businessId==='other-forge')!.lifecycle).toEqual({transition:'observed-active-to-closed',causeCode:'not-recorded-by-native-source'});
    expect(report.business!.rows.find(b=>b.businessId==='new-forge')!.lifecycle.transition).toBe('observed-founded');
});
test('SI-C04 fixed basket policy cannot be selected retrospectively, and missing debt channels remain unknown',()=>{
    const f=setup(),options=f.boundaries();delete options.closing.paths.bankingPath;const report=record(f,options);
    if(report.closing.status!=='available')throw new Error('Missing cash boundary');
    expect(report.closing.claims!.depositClaims).toBeNull();expect(report.closing.claims!.loanDebts).toBeNull();
    expect(reportNativeFinance(f.scope,{...options,basket:[{itemId:377,fixedWeight:1}]}).status).toBe('inconclusive');
});
test('SI-C04 two frozen endpoints place a reconciled wage in its interval without fabricating an exact payment timestamp',()=>{
    const id=randomUUID(),binding={schemaVersion:1,workOrderId:'wage-work',requesterAgentId:'ada',username:'bea',request:{requestId:randomUUID(),assigneeAgentId:'bea',
        skill:{id:'food.cook',version:'1.0.0'},parameters:{},objective:'A completed shift.',rewardGp:50},target:{kind:'cook',kitchenRunId:'kitchen',batchId:'batch'},
        settlementId:id,runId:randomUUID()} as BusinessWorkBinding;
    const work=[{binding,order:{business_id:'forge',wage_status:'paid',wage_settlement_id:id,wage_gp:50}}];
    const rewards=[{settlement_id:id,username:'bea',amount:50,status:'committed',coins_before:100,coins_after:150}],
        reservations=[{settlement_id:id,actor_kind:'business',actor_id:'forge',status:'committed',amount_gp:50}];
    expect(()=>financeWageProofs(work,rewards,[])).toThrow('closed financial boundary');
    expect(()=>financeWageProofs(work,[{...rewards[0],coins_after:149}],reservations)).toThrow('closed financial boundary');
    const proofs=financeWageProofs(work,rewards,reservations);expect(proofs.payments[0]!.amountGp).toBe('50');
    const f=setup(),options=f.boundaries();record(f,options);
    const opening=readNativeFinanceBoundary(f.scope,options,'opening').snapshot,closing=readNativeFinanceBoundary(f.scope,options,'closing').snapshot;
    opening.wages={status:'available',payments:[]};closing.wages=proofs;
    const row=businessCashflows(opening,closing,f.scope).rows.find(b=>b.businessId==='forge')!;
    expect(row.observedWageGp).toBe('50');expect(row.unclassifiedCashDeltaGp).toBe('0');expect(row.flows[0]!.simulationTime).toBeNull();
    expect(row.flows[0]!.placement).toMatchObject({from:start,to:at(1),basis:'absent-at-opening-and-reconciled-paid-at-closing'});
    expect(businessCashflows(closing,closing,f.scope).rows.find(b=>b.businessId==='forge')!.observedWageGp).toBe('0');
});
test('SI-C04 report never captures/backfills absent observations; backend GET ignores caller source paths and requires auth',async()=>{
    const f=setup(),options=f.boundaries(),before=readdirSync(join(f.root,'.local'));
    expect(reportNativeFinance(f.scope,options).status).toBe('inconclusive');expect(readdirSync(join(f.root,'.local'))).toEqual(before);
    const report=record(f,options),query=new URLSearchParams({from:start,to:at(1),clockId:'world',clockProfileDigest:f.scope.clockProfileDigest,
        checkpointPath:'C:/untrusted.sqlite',observations:'{"cash":999}'});for(const actor of f.scope.actorAgentIds)query.append('actor',actor);
    const url=new URL(`http://localhost/api/admin/society/finance?${query}`),context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor,nativeFinanceOptions:options};
    expect((await handleAdminRequest(new Request(url),url,context))!.status).toBe(401);
    const response=(await handleAdminRequest(new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),url,context))!;
    expect(response.status).toBe(200);expect((await response.json()).digest).toBe(report.digest);
});
