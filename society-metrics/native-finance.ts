import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { commerceIds } from '../agent-operated-shop/native-commerce.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { financeCapture,financeCheck,financeInteger as amount,readNativeFinanceBoundary,type NativeFinanceOptions } from './finance-sources.js';
import { validateEvaluationScope,type EvaluationScope,type SocietyObservations } from './evaluation.js';
type Snapshot=ReturnType<typeof readNativeFinanceBoundary>['snapshot'];
const sum=(values:readonly (string|number)[])=>values.reduce<bigint>((n,value)=>n+BigInt(value),0n);
const safe=(value:bigint)=>{financeCheck(value>=0n&&value<=BigInt(Number.MAX_SAFE_INTEGER),'Financial metric exceeds exact numeric range');return Number(value);};
const businessCash=(s:Snapshot,id:string)=>sum(s.wealth.assets.filter(a=>a.itemId===995&&(a.location==='institution-treasury'&&a.owner===`business:${id}`
    ||a.location==='business-inventory'&&a.owner===id)).map(a=>a.count));
function positions(s:Snapshot){
    const personal=s.cohort.map(actor=>({...actor,cashGp:String(sum(s.wealth.assets.filter(a=>a.itemId===995&&a.owner===actor.username
        &&['player-inventory','player-equipment','player-bank','native-escrow'].includes(a.location)).map(a=>a.count)))}));
    const businesses=s.business.rows.map(row=>{financeCheck(typeof row.business_id==='string'&&typeof row.owner_agent_id==='string','Invalid native Business identity');
        const cash=businessCash(s,row.business_id);
        return{businessId:row.business_id as string,ownerAgentId:row.owner_agent_id as string,propertyId:row.property_id as string|null,
            status:row.status as string,cashGp:String(cash),reservedGp:String(amount(s.treasury.accounts.find(a=>a.actor_kind==='business'&&a.actor_id===row.business_id)?.reserved_gp??0))};});
    return{personal,businesses,totalRecordedCashGp:String(sum(s.wealth.assets.filter(a=>a.itemId===995).map(a=>a.count))),
        nonCashAssets:s.wealth.assets.filter(a=>a.itemId!==995),cashLocations:s.wealth.assets.filter(a=>a.itemId===995),
        accounting:'Physical/custodial GP once per location; treasury reservations included in balance. Business equity, deposits, loans and contracts are not additional cash.'};
}
function claims(s:Snapshot){
    const bank=s.bank.status==='available'?s.bank.value:null;
    const deposits=bank?.accounts.map(a=>({sourceId:a.accountId,creditor:`${a.ownerKind}:${a.ownerActorId}`,debtor:`bank:${a.bankId}`,amountGp:String(amount(a.balanceGp)),kind:'deposit-claim'}))??null;
    const loans=bank?.loans?.filter(l=>l.status!=='approved'&&l.status!=='repaid').map(l=>{
        financeCheck(bank.disbursements?.some(d=>d.loan_id===l.loan_id),'Outstanding loan has no native disbursement source');
        return{sourceId:String(l.loan_id),creditor:`business:${l.bank_treasury_actor_id}`,debtor:`${l.borrower_kind}:${l.borrower_actor_id}`,
            principalGp:String(amount(l.principal_outstanding_gp)),interestGp:String(amount(l.interest_outstanding_gp)),status:String(l.status),kind:'loan-debt'};})??null;
    const contracts=s.contracts.status==='available'?s.contracts.value.contracts.filter(c=>['active','estate-held','cancelling','defaulting','defaulted'].includes(c.resolution)).flatMap(c=>{
        const evidence=s.contracts.status==='available'?s.contracts.value.evidence.filter(e=>e.contract_id===c.contract_id):[];
        return(['a','b'] as const).map(party=>{const term=JSON.parse(party==='a'?c.party_a_provides_json:c.party_b_provides_json),promised=amount(term.gp);
            const matched=sum(evidence.filter(e=>e.party===party).map(e=>amount(e.matched_gp)));
            return{sourceId:`${c.contract_id}:${party}`,debtor:party==='a'?c.party_a_agent_id:c.party_b_agent_id,creditor:party==='a'?c.party_b_agent_id:c.party_a_agent_id,
                promisedGp:String(promised),recordedMatchedGp:String(matched),remainingConditionalGp:String(BigInt(promised)>matched?BigInt(promised)-matched:0n),
                status:c.resolution,kind:'conditional-contract-obligation'};});}):null;
    return{depositClaims:deposits,loanDebts:loans,contractObligations:contracts,bankSource:s.bank.status,contractSource:s.contracts.status,
        netWorthGp:null,reason:'Claims/liabilities remain separate from physical GP; conditional contracts and noncash assets have no invented net valuation.'};
}
function priceAt(s:Snapshot,itemId:number,maxAge:number,scope:EvaluationScope){
    if(s.trades.status!=='available')return null;
    const values=s.trades.value.filter(t=>t.stamp&&t.stamp.profileDigest===scope.clockProfileDigest&&t.stamp.clockId===scope.clockId
        &&Date.parse(t.stamp.simulationTime)<=Date.parse(s.simulationTime)&&Date.parse(s.simulationTime)-Date.parse(t.stamp.simulationTime)<=maxAge)
        .map(t=>{for(const [goods,money] of [[t.event.fromItems,t.event.toItems],[t.event.toItems,t.event.fromItems]] as const){
            if(goods.length===1&&goods[0]!.id===itemId&&money.length===1&&money[0]!.id===995)
                return{eventId:t.event.eventId,sequence:t.sequence,digest:t.event.eventDigest,simulationTime:t.stamp!.simulationTime,
                    gp:amount(money[0]!.count),units:amount(goods[0]!.count)};
        }return null;}).filter((v):v is NonNullable<typeof v>=>!!v&&v.gp>0&&v.units>0);
    values.sort((a,b)=>Date.parse(a.simulationTime)-Date.parse(b.simulationTime)||a.sequence-b.sequence);return values.at(-1)??null;
}
export function businessCashflows(open:Snapshot,close:Snapshot,scope:EvaluationScope){
    const nativeFlows:Array<{id:string;businessId:string;category:'revenue'|'input'|'wage';direction:'in'|'out';amountGp:string;simulationTime:string|null;
        placement?:{from:string;to:string;basis:string};proof:string[]}> = [];
    const issues:string[]=[];
    if(close.trades.status==='available')for(const row of close.commerce.filter(r=>r.phase==='completed')){
        const i=row.binding.intent;if(open.commerce.some(r=>r.binding.intent.operationId===i.operationId&&r.phase==='completed'))continue;
        const trade=close.trades.value.find(t=>t.event.eventId===row.trade?.eventId);
        if(!trade?.stamp||trade.stamp.clockId!==scope.clockId||trade.stamp.profileDigest!==scope.clockProfileDigest
            ||foodDigest(trade.event)!==foodDigest(row.trade)){issues.push(`unplaced-or-invalid-commerce:${i.operationId}`);continue;}
        if(trade.stamp.simulationTime<=scope.fromSimulationTime||trade.stamp.simulationTime>scope.toSimulationTime)continue;
        const ids=commerceIds(i.operationId),gp=amount(i.quantity*i.unitPriceGp);
        const paid=i.kind==='sale'?close.treasury.externalCredits?.find(c=>c.settlement_id===ids.tradeId&&c.actor_kind==='business'
            &&c.actor_id===i.businessId&&c.amount_gp===gp&&c.source_ref===`trade:${ids.tradeId}`)
            :close.treasury.reservations.find(c=>c.reservation_id===ids.reservationId&&c.status==='committed'&&c.actor_kind==='business'
                &&c.actor_id===i.businessId&&c.amount_gp===gp&&c.settlement_id===ids.tradeId);
        if(!paid){issues.push(`business-cash-settlement-missing:${i.operationId}`);continue;}
        nativeFlows.push({id:i.operationId,businessId:i.businessId,category:i.kind==='sale'?'revenue':'input',direction:i.kind==='sale'?'in':'out',
            amountGp:String(gp),simulationTime:trade.stamp.simulationTime,proof:[trade.event.eventId,ids.tradeId,row.digest]});
    }
    const usedSettlements=new Set(nativeFlows.map(f=>f.proof[1]));
    for(const wage of close.wages?.payments??[]){if(open.wages?.payments.some(p=>p.settlementId===wage.settlementId))continue;
        financeCheck(!usedSettlements.has(wage.settlementId),'Same Business settlement classified twice');usedSettlements.add(wage.settlementId);
        nativeFlows.push({id:wage.settlementId,businessId:wage.businessId,category:'wage',direction:'out',amountGp:wage.amountGp,simulationTime:null,
            placement:{from:scope.fromSimulationTime,to:scope.toSimulationTime,basis:'absent-at-opening-and-reconciled-paid-at-closing'},proof:[wage.digest,wage.settlementId]});}
    const start=positions(open),end=positions(close),ids=[...new Set([...start.businesses,...end.businesses].map(b=>b.businessId))].sort();
    return{rows:ids.map(id=>{const a=start.businesses.find(b=>b.businessId===id),b=end.businesses.find(b=>b.businessId===id);
        const flows=nativeFlows.filter(f=>f.businessId===id),income=sum(flows.filter(f=>f.direction==='in').map(f=>f.amountGp)),expense=sum(flows.filter(f=>f.direction==='out').map(f=>f.amountGp));
        const delta=businessCash(close,id)-businessCash(open,id);
        const unplacedWages=(close.business.work??[]).filter(w=>w.order?.business_id===id).map(w=>{
            const native=close.wageAndRent.rewards?.find(r=>r.settlement_id===w.binding.settlementId);
            const debit=close.treasury.reservations.find(r=>r.settlement_id===w.binding.settlementId&&r.actor_id===id&&r.actor_kind==='business');
            return{workOrderId:w.binding.workOrderId,settlementId:w.binding.settlementId,amountGp:String(w.binding.request.rewardGp),
                reconciled:native?.status==='committed'&&debit?.status==='committed'&&native.amount===debit.amount_gp
                    &&native.amount===w.binding.request.rewardGp&&native.username===w.binding.username,
                simulationTime:null,status:'no-exact-payment-timestamp',intervalIncluded:flows.some(f=>f.category==='wage'&&f.id===w.binding.settlementId)};});
        return{businessId:id,opening:a??null,closing:b??null,cashDeltaGp:String(delta),observedRevenueGp:close.trades.status==='available'?String(income):null,
            observedInputGp:close.trades.status==='available'?String(sum(flows.filter(f=>f.category==='input').map(f=>f.amountGp))):null,
            observedWageGp:close.wages?.status==='available'?String(sum(flows.filter(f=>f.category==='wage').map(f=>f.amountGp))):null,
            unclassifiedCashDeltaGp:String(delta-income+expense),flows,wagePaymentTimeDiagnostics:unplacedWages,
            categories:{revenue:close.trades.status==='available'?'observed-native-commerce-subset':'unavailable-native-trade-time-source',
                input:close.trades.status==='available'?'observed-native-commerce-subset':'unavailable-native-trade-time-source',
                wage:close.wages?.status==='available'?'observed-closed-boundary-native-payment-transitions':'unavailable-native-wage-channel',
                rent:'unavailable-business-settlement; player rent is not Business cash',capital:'unavailable-GP-cost; physical investment is not expenditure'},
            lifecycle:{transition:!a?'observed-founded':!b?'missing-closing-business-source':a.status!==b.status?`observed-${a.status}-to-${b.status}`:'unchanged',
                causeCode:'not-recorded-by-native-source'},completeCashflowCoverage:false};}),issues,
        capitalObservations:close.business.capital,treasuryTransfers:close.treasury.transfers,playerRentObservations:close.wageAndRent.rent,
        attribution:'Only matching native trade + Business treasury settlement is Business revenue/input. Unknown/unplaced changes remain residuals, not zero profit.'};
}
export function reportNativeFinance(query:EvaluationScope,options:NativeFinanceOptions){
    const scope=validateEvaluationScope(query);
    financeCheck(options.basket.length>0&&options.basket.length<=128&&new Set(options.basket.map(b=>b.itemId)).size===options.basket.length,'Invalid fixed finance basket');
    for(const row of options.basket)financeCheck(amount(row.itemId)<=65535&&row.itemId!==995&&amount(row.fixedWeight)>0,'Invalid fixed basket item/weight');
    financeCheck(amount(options.maxPriceAgeSimulationMs)>0,'Invalid native price freshness limit');
    const opening=financeCapture(()=>readNativeFinanceBoundary(scope,options,'opening')),closing=financeCapture(()=>readNativeFinanceBoundary(scope,options,'closing'));
    const observations:SocietyObservations={},issues:string[]=[];let paired=false;
    if(opening.status==='available'&&closing.status==='available'){
        const a=opening.value.snapshot,b=closing.value.snapshot;
        if(digest(a.cohort)!==digest(b.cohort))issues.push('Opening/closing actor lifecycle cohort differs');
        else if(a.wages.payments.some(p=>!b.wages.payments.some(end=>end.settlementId===p.settlementId&&end.digest===p.digest)))issues.push('Opening native wage payment disappeared or changed');
        else if(a.business.rows.some(row=>!b.business.rows.some(end=>end.business_id===row.business_id)))issues.push('Closing Business source omits an opening company; no inferred closure');
        else if(a.trades.status==='available'&&b.trades.status==='available'&&a.trades.value.some((t,index)=>b.trades.status!=='available'||b.trades.value[index]?.headHash!==t.headHash))issues.push('Closing trade source is not the opening prefix');
        else paired=true;
    }
    const start=opening.status==='available'?positions(opening.value.snapshot):null,end=closing.status==='available'?positions(closing.value.snapshot):null;
    if(paired&&start&&end){observations.mobility=start.personal.map(a=>({actorAgentId:a.actorAgentId,openingWealthGp:safe(BigInt(a.cashGp)),
        closingWealthGp:safe(BigInt(end.personal.find(b=>b.actorAgentId===a.actorAgentId)!.cashGp))}));
        observations.wealth=end.personal.map(a=>({actorAgentId:a.actorAgentId,wealthGp:safe(BigInt(a.cashGp))}));}
    const prices=options.basket.map(row=>({...row,opening:opening.status==='available'?priceAt(opening.value.snapshot,row.itemId,options.maxPriceAgeSimulationMs,scope):null,
        closing:closing.status==='available'?priceAt(closing.value.snapshot,row.itemId,options.maxPriceAgeSimulationMs,scope):null}));
    if(paired&&prices.every(p=>p.opening&&p.closing))observations.prices=prices.map(p=>({itemId:p.itemId,openingPriceGp:{gp:p.opening!.gp,units:p.opening!.units},
        closingPriceGp:{gp:p.closing!.gp,units:p.closing!.units},fixedWeight:p.fixedWeight}));
    const definition={schemaVersion:1,artifactKind:'native-finance-history',scope,status:paired?'observed-boundaries':'inconclusive',
        opening:opening.status==='available'?{status:'available',binding:opening.value.binding,positions:start,claims:claims(opening.value.snapshot)}:opening,
        closing:closing.status==='available'?{status:'available',binding:closing.value.binding,positions:end,claims:claims(closing.value.snapshot)}:closing,
        priceBasket:{status:observations.prices?'observed':'inconclusive',items:prices,maxAgeSimulationMs:options.maxPriceAgeSimulationMs,
            policy:'latest verified cash-for-one-item trade at/before each boundary; no barter, gifts, substitution or future price'},
        business:paired&&opening.status==='available'&&closing.status==='available'?businessCashflows(opening.value.snapshot,closing.value.snapshot,scope):null,
        cashChange:paired&&start&&end?{openingGp:start.totalRecordedCashGp,closingGp:end.totalRecordedCashGp,
            deltaGp:String(BigInt(end.totalRecordedCashGp)-BigInt(start.totalRecordedCashGp)),completeMutationCoverage:false}:null,
        metricScope:'GP-only personal physical/custodial cash Gini and matched-cohort rank mobility; company balances, equity, claims, debt and noncash assets separate',
        observations,issues,totalScore:null,completeEconomicCoverage:false,
        limitations:['Frozen exact paused clock/closed-tick/needs boundaries and stable per-source reads; no cross-DB ACID.',
            'Immutable observation digests bind native snapshot content; current balances never reconstruct missing history.',
            'Cash changes and unclassified Business losses remain visible; residual is not profit or proof of complete mutation coverage.',
            'Missing bank/contract/category/price coverage is unknown, never zero wealth, zero debt or zero cost.']};
    return{...definition,digest:digest(definition)};
}
