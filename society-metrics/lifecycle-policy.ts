import type { Database } from 'bun:sqlite';
import { NativeLifecyclePolicyStore } from '../population-lifecycle/native-policy.js';
import { NativeMortalityCoverageStore,mortalityRosterDigest,type MortalityActor } from '../population-lifecycle/native-coverage.js';
import { NativeLifecycleWatermarkStore } from '../population-lifecycle/native-watermarks.js';
import { readNativeLifecycleWatermarks } from './lifecycle-watermarks.js';
import { outcomeCheck as check } from './outcome-work.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { NativeOutcomeOptions } from './native-outcomes.js';
import type { EvaluationScope } from './evaluation.js';

/** Declared source/config and actual cached-policy observations. Missing broader dependencies/hot-reload histories cannot become a full policy PASS. */
export function readNativeLifecyclePolicy(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[]){
    if(!NativeLifecyclePolicyStore.present(db))throw Object.assign(Error('Lifecycle policy pin absent'),{code:'ENOENT'});
    const source=new NativeLifecyclePolicyStore(db).read(),s=source.mortality,pin=source.selection;
    check(s.worldId===options.worldId&&s.clockId===scope.clockId&&s.clockProfileDigest===scope.clockProfileDigest&&s.fromSimulationTime===genesisAt
        &&mortalityRosterDigest(s.actors)===mortalityRosterDigest(founders),'Lifecycle policy original scope differs');
    const gaps=new Set<string>(),violations:Array<{sampleSequence:number;atSimulationTime:string;reason:string}>=[];
    let passes:ReturnType<NativeMortalityCoverageStore['read']>|null=null,watermarks:ReturnType<NativeLifecycleWatermarkStore['read']>|null=null;
    try{passes=new NativeMortalityCoverageStore(db).read();}catch{gaps.add('mortality-source-unavailable');}
    try{watermarks=new NativeLifecycleWatermarkStore(db).read();
        if(!readNativeLifecycleWatermarks(db,scope,options,genesisAt,founders).completePostGuardCensusCoverage)gaps.add('census-window-coverage');}
    catch{gaps.add('census-source-unavailable');}
    if(source.faults)gaps.add('policy-observer-fault');if(s.toSimulationTime<scope.toSimulationTime)gaps.add('selection-window');
    const selected=source.entries.filter(e=>e.sample.position.simulationTime>=genesisAt&&e.sample.position.simulationTime<=scope.toSimulationTime);
    let prior:typeof selected[number]|undefined,segment:string|undefined;
    for(const entry of selected){const e=entry.sample,c=e.position,p=passes?.entries[e.mortalityHead.sequence-1],
        scoped=e.worldId===options.worldId&&c.clockId===scope.clockId&&c.profileDigest===scope.clockProfileDigest,
        bound=scoped&&p?.digest===e.mortalityHead.digest&&digest(p.sample.clock)===digest(c)
            &&mortalityRosterDigest(p.sample.actors)===mortalityRosterDigest(founders)&&Date.parse(e.wallTime)-Date.parse(c.wallTime)<=s.maximumWallGapMs;
        if(!bound)gaps.add('policy-native-position');
        const w=watermarks?.entries[e.watermarkHead.sequence-1];
        if(!w||w.digest!==e.watermarkHead.digest||w.sample.stage!==e.stage||w.sample.sessionId!==e.sessionId
            ||w.sample.clock.engineTick!==c.engineTick||w.sample.clock.clockId!==c.clockId||w.sample.clock.profileDigest!==c.profileDigest)gaps.add('policy-census-prefix');
        if(!prior){if(e.stage!=='after-terminal-guard'||c.simulationTime!==genesisAt)gaps.add('policy-window-opening');}
        else{const a=prior.sample,sameTick=a.stage==='after-terminal-guard',ds=Date.parse(c.simulationTime)-Date.parse(a.position.simulationTime),
            dw=Date.parse(e.wallTime)-Date.parse(a.wallTime);
            if(e.sessionId!==a.sessionId||e.stage===a.stage||c.engineTick!==Number(a.position.engineTick)+(sameTick?0:1)||c.revision<a.position.revision
                ||ds<0||ds>s.maximumSimulationGapMs||dw<0||dw>s.maximumWallGapMs)gaps.add('policy-tick-stage-session-gap');}
        prior=entry;
        if(!e.bootManifest)gaps.add('policy-or-boot-source-unavailable');
        if(!e.snapshot){gaps.add('policy-or-boot-source-unavailable');continue;}
        const snapshot=e.snapshot,clock=snapshot.clock;
        if(clock.lastObservedWallTime>e.wallTime){gaps.add('future-effective-policy-clock');continue;}
        if(!bound)continue;
        const fail=(reason:string)=>violations.push({sampleSequence:entry.sequence,atSimulationTime:c.simulationTime,reason});
        if(e.bootManifest&&digest(e.bootManifest)!==digest(pin.manifest))fail('lifecycle-boot-source-pin-mismatch');
        if(digest(snapshot.sources)!==digest(pin.manifest.sources))fail('declared-lifecycle-source-file-drift');
        if(digest(snapshot.files)!==digest(pin.opening.files))fail('pinned-lifecycle-policy-file-drift');
        if(digest(snapshot.effective)!==digest(pin.opening.effective))fail('effective-lifecycle-world-policy-drift');
        if(clock.clockId!==s.clockId||clock.profileDigest!==s.clockProfileDigest||clock.status!=='running')fail('effective-clock-profile-or-status-changed');
        if(clock.revision!==c.revision)fail('clock-reconfigured-after-native-pass');
        const identity=digest({revision:clock.revision,anchorWallTime:clock.anchorWallTime,anchorSimulationTime:clock.anchorSimulationTime});
        if(segment&&segment!==identity)fail('clock-segment-revision-or-anchor-changed');segment??=identity;
        const elapsed=BigInt(Date.parse(clock.lastObservedWallTime)-Date.parse(clock.anchorWallTime)),rate=clock.profile.rate,
            projected=BigInt(Date.parse(clock.anchorSimulationTime))+elapsed*BigInt(rate.simulationMilliseconds)/BigInt(rate.wallMilliseconds);
        if(clock.status==='running'&&projected!==BigInt(Date.parse(clock.lastSimulationTime)))fail('effective-clock-projection-mismatch');
        if(clock.lastSimulationTime<c.simulationTime)fail('effective-clock-regressed');
    }
    if(!prior||prior.sample.stage!=='end-of-tick'||prior.sample.position.simulationTime!==scope.toSimulationTime)gaps.add('policy-window-closing');
    const body={protocol:'native-lifecycle-policy-continuity-v1',scope,worldId:options.worldId,selectionDigest:digest(pin),sourceHead:source.head,
        manifestDigest:digest(pin.manifest),sampleCount:selected.length,faultCount:source.faults,gaps:[...gaps].sort(),violations,
        completePinnedPolicyObservations:gaps.size===0,completeWorldPolicyEnforcement:false,completeLifecycleEnforcement:false,
        verdict:violations.length?'fail':'inconclusive',meaning:'Import-time declared source identity and per-tick actual clock/cached policies. Broader dependency/packed/environment and intratick hot-reload histories remain unproven; no full world-policy PASS.'};
    return{...body,digest:digest(body)};
}
