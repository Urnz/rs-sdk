import type {Database} from 'bun:sqlite';
import {fileURLToPath} from 'node:url';
import {SocietyIntegrityStore} from '../society-integrity/store.js';
import {administrativeValueRegistryDigest,integrityCoverageCursor} from '../society-integrity/coverage.js';
import {NativeLifecyclePolicyStore} from '../population-lifecycle/native-policy.js';
import {lifecycleRouteManifest} from '../population-lifecycle/native-policy-manifest.js';
import {readStableOutcomeStore,type NativeFounderBaseline} from './population-outcomes.js';
import {readNativeWorldPolicy} from './world-policy.js';
import type {MortalityActor} from '../population-lifecycle/native-coverage.js';
import {NativeMortalityCoverageStore,mortalityRosterDigest} from '../population-lifecycle/native-coverage.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeOutcomeOptions} from './native-outcomes.js';

const reviewed=(()=>{try{return lifecycleRouteManifest(fileURLToPath(new URL('../',import.meta.url)));}catch{return null;}})();
/** Existing write-ahead audit + actual per-tick native seals + reviewed immutable producer dispatch. Not an uploaded clean-run flag. */
export function readNativeAdministrativeValue(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,baseline:NativeFounderBaseline,founders:MortalityActor[],
    observedPolicy?:ReturnType<typeof readNativeWorldPolicy>){
    if(!options.population)throw Object.assign(Error('Administrative integrity source not selected'),{code:'ENOENT'});
    const genesisAt=baseline.genesisAppliedAtSimulationTime,gaps=new Set<string>(),violations:Array<{eventId:string;source:string;atSimulationTime:string;reason:string}>=[];
    const source=readStableOutcomeStore(options,options.population.integrityPath,db=>{
        const store=new SocietyIntegrityStore(options.population!.integrityPath,true);
        try{return{snapshot:store.coverageSnapshot(baseline.genesisResultId),entries:db.query('SELECT sequence,hash,run_id,event_id,payload,status FROM integrity_event ORDER BY sequence').all() as
            Array<{sequence:number;hash:string;run_id:string;event_id:string;payload:string;status:string}>};}finally{store.close();}
    }),{snapshot,entries}=source,current=integrityCoverageCursor(snapshot),run=snapshot.report.run;
    if(run.runId!==baseline.genesisResultId||run.resultDigest!==baseline.genesisResultDigest||run.genesisAppliedAtSimulationTime!==genesisAt
        ||run.result.simulationClock.clockId!==scope.clockId||run.result.simulationClock.profileDigest!==scope.clockProfileDigest)throw Error('Administrative value original run differs');
    if(snapshot.activeRunIds.join(',')!==run.runId||run.status!=='observing')gaps.add('original-active-run');
    const payloads=new Map(entries.filter(e=>e.run_id===run.runId).map(e=>[e.event_id,{...e,value:JSON.parse(e.payload)}]));
    const bootstrap=entries.find(e=>e.run_id===run.runId&&e.event_id==='bootstrap-complete');
    if(!bootstrap)gaps.add('bootstrap-not-complete');
    let frames:ReturnType<NativeLifecyclePolicyStore['read']>['entries']=[],policy:ReturnType<typeof readNativeWorldPolicy>|null=null,
        passes:ReturnType<NativeMortalityCoverageStore['read']>|null=null;
    try{const pinned=new NativeLifecyclePolicyStore(db).read();
        if(!reviewed||digest(pinned.selection.manifest)!==digest(reviewed))gaps.add('reviewed-value-producers');
        frames=pinned.entries.filter(e=>e.sample.position.simulationTime>=genesisAt&&e.sample.position.simulationTime<=scope.toSimulationTime);
        passes=new NativeMortalityCoverageStore(db).read();
    }catch{gaps.add('native-value-frames-unavailable');}
    try{policy=observedPolicy??readNativeWorldPolicy(db,scope,options,genesisAt,founders);}catch{gaps.add('world-policy-unavailable');}
    if(!policy?.completeWorldPolicyCoverage||policy.verdict!=='pass')gaps.add('immutable-producer-window');
    const prefix=(h:{sequence:number;hash:string})=>h.sequence===0?h.hash==='0'.repeat(64):entries[h.sequence-1]?.hash===h.hash;
    const seals=frames.filter(({sample:e})=>{const c=e.administrativeValueCursor,p=e.position,m=passes?.entries[e.mortalityHead.sequence-1];
        return c&&c.runId===run.runId&&c.resultDigest===run.resultDigest&&c.clockId===scope.clockId&&c.clockProfileDigest===scope.clockProfileDigest
            &&c.genesisAppliedAtSimulationTime===genesisAt&&c.registryDigest===administrativeValueRegistryDigest&&c.runStatus==='observing'&&prefix(c.head)
            &&e.worldId===options.worldId&&p.clockId===scope.clockId&&p.profileDigest===scope.clockProfileDigest&&p.status==='running'
            &&m?.digest===e.mortalityHead.digest&&digest(m.sample.clock)===digest(p)&&mortalityRosterDigest(m.sample.actors)===mortalityRosterDigest(founders)
            &&Date.parse(e.wallTime)-Date.parse(p.wallTime)<=(passes?.selection.maximumWallGapMs??0);
    });
    if(seals.length!==frames.length||!frames.length)gaps.add('native-value-cursor');
    let sequence=-1;
    for(const {sample:e} of seals){const c=e.administrativeValueCursor!;
        if(c.head.sequence<sequence||c.head.sequence<(bootstrap?.sequence??Infinity))gaps.add('native-value-prefix-order');sequence=c.head.sequence;}
    const first=seals[0]?.sample,last=seals.at(-1)?.sample,closing=last?.administrativeValueCursor;
    const provenSeal=seals.reduce<typeof first>((best,e)=>!best||e.sample.administrativeValueCursor!.head.sequence>=best.administrativeValueCursor!.head.sequence?e.sample:best,undefined);
    if(!first||first.stage!=='after-terminal-guard'||first.position.simulationTime!==genesisAt||!last||last.stage!=='end-of-tick'||last.position.simulationTime!==scope.toSimulationTime)gaps.add('native-value-boundaries');
    if(!closing||digest(closing)!==digest(current))gaps.add('unsealed-value-state-or-tail');
    for(const e of snapshot.report.events){
        if(e.kind==='coverage-gap'||e.status==='pending')gaps.add('pending-or-legacy-value-history');
        if(e.kind!=='runtime-injection')continue;
        const stamp=e.stamp,mutation=e.mutation;
        if(!stamp||!mutation||stamp.clockId!==scope.clockId||stamp.profileDigest!==scope.clockProfileDigest
            ||stamp.simulationTime<genesisAt||stamp.simulationTime>scope.toSimulationTime){gaps.add('unbound-value-event');continue;}
        const resolution=payloads.get(`resolved:${e.eventId}`),seal=resolution&&provenSeal&&provenSeal.administrativeValueCursor!.head.sequence>=resolution.sequence
            &&provenSeal.wallTime>=stamp.wallTime&&provenSeal.position.simulationTime>=stamp.simulationTime;
        if(!seal){gaps.add('value-result-not-natively-sealed');continue;}
        if(e.status==='committed')violations.push({eventId:e.eventId,source:mutation.source,atSimulationTime:stamp.simulationTime,reason:'native-post-genesis-administrative-or-fallback-value'});
        else if(e.status==='no-effect'&&(mutation.source!=='engine.cheat-value'||resolution?.value.nativeResult!==0))gaps.add('unproven-no-effect');
    }
    // A consumed internal-payment permit is only a redistribution witness when its native coordinator completed the same exact backing.
    const transfers=snapshot.report.events.filter(e=>e.kind==='internal-transfer');
    const permits=new Map((snapshot.permits as Array<{operation_id:string;mutation_digest:string;consumed:number}>).map(p=>[p.operation_id,p]));
    let reservations:Map<string,any>|null=null,treasurySnapshotDigest:string|null=null;
    const paymentEvidence:string[]=[];
    if(transfers.length)try{
        if(!options.administrativeValue?.treasuryPath)throw Error('Treasury backing not selected');
        const treasury=readStableOutcomeStore(options,options.administrativeValue.treasuryPath,db=>({rows:db.query('SELECT * FROM institution_treasury_reservation').all() as any[]}));
        reservations=new Map(treasury.rows.map(r=>[r.reservation_id,r]));treasurySnapshotDigest=treasury.sourceSnapshotDigest;
    }catch{gaps.add('native-payment-backing-unavailable');}
    for(const e of transfers){
        const raw=payloads.get(e.eventId)?.value,resolution=payloads.get(`resolved:${e.eventId}`)?.value,
            permit=e.mutation?permits.get(e.mutation.operationId):undefined;
        if(e.status!=='committed'||!resolution||!permit||permit.consumed!==1||permit.mutation_digest!==digest(e.mutation)
            ||digest(raw?.backing)!==digest(resolution.backing))gaps.add('unclosed-internal-payment');
        const b=raw?.backing,r=reservations?.get(b?.reservationId),mutation=e.mutation;
        let reward:any=null;try{reward=db.query('SELECT * FROM player_action_reward WHERE settlement_id=?').get(b?.settlementId??'');}catch{/* Missing canonical source is not a payment proof. */}
        paymentEvidence.push(digest({backing:b??null,reservation:r??null,reward}));
        if(!b||!mutation||mutation.source!=='engine.player-reward'||mutation.operationId!==`player-reward:${b.settlementId}`||!Number.isSafeInteger(b.amountGp)||b.amountGp<=0
            ||(mutation.payload as any)?.amountGp!==b.amountGp||!r||r.status!=='committed'||r.settlement_id!==b.settlementId||r.amount_gp!==b.amountGp
            ||r.actor_kind!==b.payerKind||r.actor_id!==b.payerId||!reward||reward.status!=='committed'||`player:${reward.username}`!==mutation.actor
            ||reward.amount!==b.amountGp||reward.coins_after-reward.coins_before!==b.amountGp||!last||r.updated_at>last.wallTime||reward.updated_at>last.wallTime)
            gaps.add('native-payment-debit-credit-unproven');
    }
    const body={protocol:'native-administrative-value-assessment-v1',scope,worldId:options.worldId,fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,
        genesisResultId:run.runId,genesisResultDigest:run.resultDigest,registryDigest:administrativeValueRegistryDigest,sourceHead:closing?.head??null,
        stateDigest:current.stateDigest,integritySnapshotDigest:source.sourceSnapshotDigest,worldPolicyDigest:policy?.digest??null,
        paymentBackingDigest:transfers.length?digest({treasurySnapshotDigest,evidence:paymentEvidence}):null,
        completeAdministrativeValueCoverage:gaps.size===0,gaps:[...gaps].sort(),violations,
        verdict:violations.length?'fail' as const:gaps.size?'inconclusive' as const:'pass' as const,
        meaning:'Reviewed native administrative/fallback producers, original post-bootstrap run and closed full-window integrity audit. Native internal-payment coordinator backing is required; external-shop/import and general host coverage are separate.'};
    return{...body,digest:digest(body)};
}
