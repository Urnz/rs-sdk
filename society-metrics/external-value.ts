import type {Database} from 'bun:sqlite';
import {readNativeTradeLedger,ZERO,type NativeTrade} from '../external-trade/source.js';
import {readExternalValueMarket,readExternalValueTreasury,externalValueRegistryDigest,disabledExternalMarket,externalMarketSourceDigest,isInternalTreasuryCommerce,type ExternalValueCursor,type ExternalValueHead} from '../external-trade/value-coverage.js';
import {NativeLifecyclePolicyStore} from '../population-lifecycle/native-policy.js';
import {NativeMortalityCoverageStore,mortalityRosterDigest,type MortalityActor} from '../population-lifecycle/native-coverage.js';
import {readNativeCommerce} from '../server/engine/src/mods/NativeCommerceStore.js';
import {readStableOutcomeStore,type NativeFounderBaseline} from './population-outcomes.js';
import {readNativeAdministrativeValue} from './administrative-value.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeOutcomeOptions} from './native-outcomes.js';

/** Full native value boundary: closed legacy shops, player trades, GE and backed treasury receipts. Raw production lineage remains its own gate. */
export function readNativeExternalValue(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,baseline:NativeFounderBaseline,founders:MortalityActor[],
    observedAdmin?:ReturnType<typeof readNativeAdministrativeValue>){
    const genesisAt=baseline.genesisAppliedAtSimulationTime,gaps=new Set<string>(),violations:Array<{source:string;eventId:string;atSimulationTime:string;reason:string}>=[];
    const attempt=<T>(name:string,run:()=>T):T|null=>{try{return run();}catch{gaps.add(`${name}-unavailable`);return null;}};
    const marketSelection=attempt('market-selection',()=>new NativeLifecyclePolicyStore(db).read().entries.filter(e=>e.sample.position.simulationTime>=genesisAt
        &&e.sample.position.simulationTime<=scope.toSimulationTime).at(-1)?.sample.externalValueCursor);
    const trade=attempt('player-trade',()=>{if(!options.tradePath)throw Error('Trade source not selected');return readStableOutcomeStore(options,options.tradePath,()=>({entries:readNativeTradeLedger(options.tradePath!)}));}),
        market=attempt('market',()=>{if(marketSelection?.marketEnabled===false)return disabledExternalMarket();
            if(!options.externalValue?.marketPath)throw Error('Actual GE source not selected');return readStableOutcomeStore(options,options.externalValue.marketPath,readExternalValueMarket);}),treasury=attempt('treasury',()=>{
            if(!options.externalValue?.treasuryPath)throw Error('Treasury source not selected');return readStableOutcomeStore(options,options.externalValue.treasuryPath,readExternalValueTreasury);}),
        candidateAdmin=observedAdmin??attempt('administrative-value',()=>readNativeAdministrativeValue(db,scope,options,baseline,founders)),
        admin=candidateAdmin&&candidateAdmin.worldId===options.worldId&&digest(candidateAdmin.scope)===digest(scope)
            &&candidateAdmin.genesisResultId===baseline.genesisResultId&&candidateAdmin.genesisResultDigest===baseline.genesisResultDigest
            &&candidateAdmin.fromSimulationTime===genesisAt&&candidateAdmin.toSimulationTime===scope.toSimulationTime?candidateAdmin:null;
    if(!admin?.completeAdministrativeValueCoverage)gaps.add('reviewed-immutable-producer-window');
    for(const v of admin?.violations??[]){if(v.source==='engine.debugproc')gaps.add('unquantified-privileged-value');
        else violations.push({source:v.source,eventId:v.eventId,atSimulationTime:v.atSimulationTime,reason:'native-post-genesis-import-or-fallback-value'});}
    const policy=attempt('policy',()=>new NativeLifecyclePolicyStore(db).read()),passes=attempt('mortality',()=>new NativeMortalityCoverageStore(db).read());
    const frames=policy?.entries.filter(e=>e.sample.position.simulationTime>=genesisAt&&e.sample.position.simulationTime<=scope.toSimulationTime)??[];
    const native=frames.filter(({sample:e})=>{const p=e.position,m=passes?.entries[e.mortalityHead.sequence-1];return e.externalValueCursor?.registryDigest===externalValueRegistryDigest
        &&e.worldId===options.worldId&&p.clockId===scope.clockId&&p.profileDigest===scope.clockProfileDigest&&m?.digest===e.mortalityHead.digest
        &&digest(m.sample.clock)===digest(p)&&mortalityRosterDigest(m.sample.actors)===mortalityRosterDigest(founders)
        &&Date.parse(e.wallTime)-Date.parse(p.wallTime)<=(passes?.selection.maximumWallGapMs??0);});
    if(!native.length||native.length!==frames.length)gaps.add('native-external-cursor');
    const prefix=(head:ExternalValueHead,rows:Array<{sequence:number;hash:string}>)=>head.sequence===0?head.hash===ZERO:rows[head.sequence-1]?.hash===head.hash,
        tradeRows=trade?.entries.map(t=>({sequence:t.sequence,hash:t.headHash}))??[];
    let prior:ExternalValueCursor|undefined;
    for(const {sample:e} of native){const c=e.externalValueCursor!;
        if(c.shopMode!=='closed-society')gaps.add('legacy-shop-or-restock-not-excluded');
        if(c.marketEnabled!==marketSelection?.marketEnabled||c.marketSourceDigest!==(c.marketEnabled&&options.externalValue?.marketPath?
            externalMarketSourceDigest(options.workspace,options.externalValue.marketPath):digest('native-grand-exchange-disabled'))
            ||!options.tradePath||c.tradeSourceDigest!==externalMarketSourceDigest(options.workspace,options.tradePath)
            ||!options.externalValue?.treasuryPath||c.treasurySourceDigest!==externalMarketSourceDigest(options.workspace,options.externalValue.treasuryPath))gaps.add('external-channel-source-identity');
        if(!trade||!prefix(c.trades,tradeRows)||!market||!prefix(c.market,market.trades)||!treasury||!prefix(c.treasury,treasury.entries))gaps.add('external-source-prefix');
        if(prior&&(['trades','market','treasury'] as const).some(k=>c[k].sequence<prior![k].sequence))gaps.add('external-source-prefix-regression');prior=c;}
    const first=native[0]?.sample,last=native.at(-1)?.sample,opening=first?.externalValueCursor,closing=last?.externalValueCursor;
    if(!first||first.stage!=='after-terminal-guard'||first.position.simulationTime!==genesisAt||!last||last.stage!=='end-of-tick'||last.position.simulationTime!==scope.toSimulationTime)gaps.add('external-window-boundaries');
    // Prospective fresh channels. Existing history is never erased, backfilled or silently treated as a zero opening.
    if(!opening||opening.trades.sequence!==0||opening.market.sequence!==0||opening.marketOfferCount!==0||opening.treasury.sequence!==0)gaps.add('nonempty-or-unbound-external-opening');
    if(!closing||!trade||closing.tradeStateDigest!==digest(trade.entries)||!market||closing.marketStateDigest!==market.stateDigest
        ||!treasury||closing.treasuryStateDigest!==treasury.stateDigest)gaps.add('unsealed-external-state-or-tail');
    const people=new Map(founders.map(a=>[a.username,a])),byTradeId=new Map(trade?.entries.map(t=>[t.event.eventId,t]));
    const nativeEnds=native.filter(e=>e.sample.stage==='end-of-tick').sort((a,b)=>a.sample.wallTime.localeCompare(b.sample.wallTime));
    const endAt=(wallTime:string)=>{let lo=0,hi=nativeEnds.length;while(lo<hi){const mid=(lo+hi)>>>1;if(nativeEnds[mid]!.sample.wallTime<wallTime)lo=mid+1;else hi=mid;}
        const end=nativeEnds[lo]?.sample;return end&&end.position.wallTime<=wallTime?end:null;};
    const scoped=(wallTime:string)=>!!first&&!!last&&wallTime>=first.position.wallTime&&wallTime<=last.wallTime;
    const ticks=new Map<number,typeof native>();for(const e of native){const key=e.sample.position.engineTick!,group=ticks.get(key)??[];group.push(e);ticks.set(key,group);}
    const tradeSeal=(t:NativeTrade)=>(ticks.get(t.event.tick)??[]).find(e=>e.sample.position.wallTime<=t.event.committedAt
        &&e.sample.wallTime>=t.event.committedAt&&e.sample.externalValueCursor!.trades.sequence>=t.sequence&&prefix(e.sample.externalValueCursor!.trades,tradeRows))?.sample;
    const fail=(source:string,eventId:string,atSimulationTime:string,reason:string)=>violations.push({source,eventId,atSimulationTime,reason});
    for(const t of trade?.entries??[]){if(!scoped(t.event.committedAt))continue;const seal=tradeSeal(t);
        if(!seal){gaps.add('trade-time-or-native-seal');continue;}
        const e=t.event,from=people.has(e.fromUsername),to=people.has(e.toUsername),incoming=from&&!to?e.toItems:to&&!from?e.fromItems:[];
        if(incoming.length)fail('player-trade',e.eventId,seal.position.simulationTime,'native-value-import-from-outside-original-cohort');
        if(incoming.some(i=>i.id===undefined))gaps.add('unidentified-imported-item');}
    for(const t of market?.trades??[]){const time=new Date(t.row.time).toISOString();if(!scoped(time))continue;const end=endAt(time),c=end?.externalValueCursor;
        if(!end||!c||c.market.sequence<t.sequence||!prefix(c.market,market!.trades)){gaps.add('market-time-or-native-seal');continue;}
        if(people.has(t.buyer)!==people.has(t.seller))fail('grand-exchange',String(t.row.id),end.position.simulationTime,'native-market-value-from-outside-original-cohort');}
    let commerce:ReturnType<typeof readNativeCommerce>|null=null;
    for(const t of treasury?.entries??[]){const r=t.row;if(!scoped(r.created_at))continue;const end=endAt(r.created_at),c=end?.externalValueCursor;
        if(!end||!c||c.treasury.sequence<t.sequence||!prefix(c.treasury,treasury!.entries)){gaps.add('treasury-time-or-native-seal');continue;}
        const related=typeof r.source_ref==='string'&&r.source_ref.startsWith('trade:')?byTradeId.get(r.source_ref.slice(6)):undefined;
        if(!related||!tradeSeal(related)){gaps.add('treasury-credit-origin-unproven');continue;}
        const a=people.get(related.event.fromUsername),b=people.get(related.event.toUsername);
        if(!a||!b){fail('treasury-credit',r.settlement_id,end.position.simulationTime,'native-treasury-income-from-outside-original-cohort');continue;}
        if(!commerce)commerce=attempt('native-commerce',()=>readNativeCommerce(db));
        const receipt=commerce?.find(p=>p.phase==='completed'&&p.trade?.eventId===related.event.eventId);
        if(!isInternalTreasuryCommerce(r,receipt,scope,options.worldId,founders))gaps.add('native-internal-commerce-backing-unproven');}
    const body={protocol:'native-external-value-assessment-v1',scope,worldId:options.worldId,fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,
        genesisResultId:baseline.genesisResultId,genesisResultDigest:baseline.genesisResultDigest,registryDigest:externalValueRegistryDigest,
        sourceHeads:closing?{trades:closing.trades,market:closing.market,treasury:closing.treasury}:null,
        sourceDigests:{trades:trade?.sourceSnapshotDigest??null,market:market?.stateDigest??null,treasury:treasury?.sourceSnapshotDigest??null,administrative:admin?.digest??null},
        completeExternalValueCoverage:gaps.size===0,gaps:[...gaps].sort(),violations,verdict:violations.length?'fail' as const:gaps.size?'inconclusive' as const:'pass' as const,
        meaning:'Closed legacy shop/restock dispatch and fresh, sealed native player-trade/GE/treasury channels under reviewed immutable producers; internal redistribution requires native backing. Production ancestry and hostile-host coverage are separate.'};
    return{...body,digest:digest(body)};
}
