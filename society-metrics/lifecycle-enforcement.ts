import type {Database} from 'bun:sqlite';
import {fileURLToPath} from 'node:url';
import {NativeMortalityCoverageStore,type MortalityActor} from '../population-lifecycle/native-coverage.js';
import {NativeLifecycleWatermarkStore} from '../population-lifecycle/native-watermarks.js';
import {NativeLifecycleAttemptStore} from '../population-lifecycle/native-attempts.js';
import {NativeLifecyclePolicyStore} from '../population-lifecycle/native-policy.js';
import {lifecycleRouteManifest} from '../population-lifecycle/native-policy-manifest.js';
import {readNativeMortalityCoverage} from './mortality-coverage.js';
import {readNativeLifecycleAttempts,nativeLifecycleAuthorityVerifier} from './lifecycle-attempts.js';
import {readNativeLifecycleWatermarks} from './lifecycle-watermarks.js';
import {readNativeWorldPolicy} from './world-policy.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeOutcomeOptions} from './native-outcomes.js';

type Observed={mortality?:ReturnType<typeof readNativeMortalityCoverage>;attempts?:ReturnType<typeof readNativeLifecycleAttempts>;
    watermarks?:ReturnType<typeof readNativeLifecycleWatermarks>;policy?:ReturnType<typeof readNativeWorldPolicy>};
// Positive enforcement applies to this reviewed implementation, not arbitrary code supplied with matching journals.
const reviewedManifest=(()=>{try{return lifecycleRouteManifest(fileURLToPath(new URL('../',import.meta.url)));}catch{return null;}})();

/** Join the existing native authorities. Tick census alone, an empty death audit or parser success cannot certify this gate. */
export function readNativeLifecycleEnforcement(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[],observed:Observed={}){
    const gaps=new Set<string>(),violations:Array<{actorId:string;atSimulationTime:string;reason:string;evidenceId:string}>=[];
    const read=<T>(name:string,run:()=>T):T|null=>{try{return run();}catch{gaps.add(`${name}-unavailable`);return null;}};
    const mortality=observed.mortality??read('mortality',()=>readNativeMortalityCoverage(db,scope,options,genesisAt,founders)),
        attempts=observed.attempts??read('attempts',()=>readNativeLifecycleAttempts(db,scope,options,genesisAt,founders)),
        watermarks=observed.watermarks??read('census',()=>readNativeLifecycleWatermarks(db,scope,options,genesisAt,founders)),
        policy=observed.policy??read('world-policy',()=>readNativeWorldPolicy(db,scope,options,genesisAt,founders));
    if(!mortality?.completeMortalityTickCoverage)gaps.add('mortality-window');
    if(!watermarks?.completePostGuardCensusCoverage||!watermarks.completeRecordedAttemptWindow)gaps.add('census-attempt-window');
    if(!policy?.completeWorldPolicyCoverage||policy.verdict!=='pass')gaps.add('unchanged-reviewed-runtime');
    for(const v of attempts?.violations??[])violations.push({actorId:v.actorId,atSimulationTime:v.atSimulationTime,reason:v.reason,evidenceId:v.attemptId});
    for(const v of watermarks?.violations??[])violations.push({actorId:v.actorId,atSimulationTime:v.atSimulationTime,reason:v.reason,evidenceId:`census:${v.sampleSequence}`});
    const pin=read('policy-pin',()=>new NativeLifecyclePolicyStore(db).selection());
    if(!reviewedManifest||digest(pin?.selection.manifest)!==digest(reviewedManifest))gaps.add('reviewed-lifecycle-build');
    const census=read('census-chain',()=>new NativeLifecycleWatermarkStore(db).read()),
        journal=read('attempt-chain',()=>new NativeLifecycleAttemptStore(db).read()),
        passes=read('mortality-chain',()=>new NativeMortalityCoverageStore(db).read()),
        authority=read('health-authority',()=>nativeLifecycleAuthorityVerifier(options,scope,genesisAt,founders,passes?.selection.maximumWallGapMs??0));
    const frames=census?.entries.filter(e=>e.sample.clock.simulationTime>=genesisAt&&e.sample.clock.simulationTime<=scope.toSimulationTime)??[],
        first=frames[0]?.sample,last=frames.at(-1)?.sample,opening=passes?.selection.openingHealthHeads;
    const byUsername=new Map(founders.map(a=>[a.username,a])),deaths=new Map(authority?.health.deaths.map(d=>[d.agentId,d]));
    const fail=(actorId:string,atSimulationTime:string,reason:string,evidenceId:string)=>violations.push({actorId,atSimulationTime,reason,evidenceId});
    const endByTick=new Map(frames.filter(e=>e.sample.stage==='end-of-tick').map(e=>[e.sample.clock.engineTick,e.sample]));
    const nativeAvatars=new Map<number,Set<string>>(),admissions=new Map<string,string[]>(),damageById=new Map(authority?.health.damage.map(d=>[d.eventId,d])),
        framesByTick=new Map<number,typeof frames>();
    for(const {sample:e} of frames){
        const seen=nativeAvatars.get(e.clock.engineTick!)??new Set<string>();
        for(const v of e.avatars)if(v.vitals.healthAudited===true)seen.add(v.username);nativeAvatars.set(e.clock.engineTick!,seen);
        for(const actor of e.actors){const a=actor.authority,proof=authority?.verify({...actor,wallTime:e.wallTime});
            if(!a||!proof||digest(a.clock)!==digest(e.clock)){gaps.add('original-health-authority');continue;}
            if(a.deathEventId!==(proof.death?.eventId??null)||a.restricted!==!!proof.death)gaps.add('terminal-latch-authority');
            for(const avatar of e.avatars.filter(v=>v.username===actor.username)){
                if(avatar.vitals.healthAudited!==true)gaps.add('native-hp-write-route');
                if(!avatar.vitals.finite)gaps.add('finite-avatar-latch');
                if((avatar.vitals.terminal||avatar.vitals.hitpoints===0)&&!proof.death)gaps.add('terminal-avatar-without-native-death');
                if(proof.death&&e.stage==='end-of-tick'&&!avatar.vitals.terminal)
                    fail(proof.actorId,e.clock.simulationTime,'native-death-without-permanent-avatar-latch',`death:${proof.death.eventId}`);
            }
        }
    }
    for(const frame of frames){const tick=frame.sample.clock.engineTick!,group=framesByTick.get(tick)??[];group.push(frame);framesByTick.set(tick,group);}
    for(const {sequence,event:e} of journal?.entries??[]){const a=e.authority;if(!a||a.clock.simulationTime<genesisAt||a.clock.simulationTime>scope.toSimulationTime)continue;
        const end=endByTick.get(a.clock.engineTick),pass=end?passes?.entries[end.mortalityHead.sequence-1]?.sample:null;
        if(!pass||(['damage','death'] as const).some(d=>a.healthHeads[d].sequence<pass.healthHeads[d].sequence))gaps.add('attempt-health-before-native-pass');
        for(const {sample:frame} of framesByTick.get(a.clock.engineTick!)??[]){const heads=frame.actors[0]?.authority?.healthHeads;if(!heads)continue;
            if((['damage','death'] as const).some(d=>sequence<=frame.attemptHead.sequence?a.healthHeads[d].sequence>heads[d].sequence:a.healthHeads[d].sequence<heads[d].sequence))
                gaps.add('attempt-health-census-order');}
    }
    // Both sides of every observed attempt must belong to the sealed native tick and carry the actual latch authority.
    for(const pair of journal?.attempts.values()??[]){const events=[pair.begin,...pair.result?[pair.result]:[]];
        if(!events.some(e=>e.authority&&e.authority.clock.simulationTime>=genesisAt&&e.authority.clock.simulationTime<=scope.toSimulationTime))continue;
        for(const e of events){const a=e.authority,end=a?endByTick.get(a.clock.engineTick):null,proof=authority?.verify(e);
            if(!a||!end||e.sessionId!==end.sessionId||e.wallTime>end.wallTime||a.clock.simulationTime>end.clock.simulationTime
                ||a.healthHeads.damage.sequence>(end.actors[0]?.authority?.healthHeads.damage.sequence??-1)
                ||a.healthHeads.death.sequence>(end.actors[0]?.authority?.healthHeads.death.sequence??-1))gaps.add('attempt-native-tick-seal');
            if(!proof||a?.deathEventId!==(proof.death?.eventId??null)||a?.restricted!==!!proof.death)gaps.add('attempt-terminal-authority');
            if(e.outcome==='source-unavailable')gaps.add('attempt-guard-source-failure');
            if(e.phase==='result'&&['passed','admitted','reconnected'].includes(e.outcome??'')&&e.vitals?.healthAudited!==true)gaps.add('admission-native-hp-route');
            if(e.kind==='world-admission'&&e.outcome==='admitted'&&e.vitals?.healthAudited===true&&a){
                const key=`${a.clock.engineTick}:${e.username}`,times=admissions.get(key)??[];times.push(e.wallTime);admissions.set(key,times);}
        }
    }
    if(!first||!last||!opening||!authority)gaps.add('health-window-boundaries');
    else{
        const closing=last.actors[0]?.authority?.healthHeads;
        if(!closing||last.actors.some(a=>digest(a.authority?.healthHeads)!==digest(closing)))gaps.add('health-closing-seal');
        for(const d of authority.health.damage){const actor=byUsername.get(d.username);if(!actor)continue;
            const end=endByTick.get(d.engineTick),inside=d.sequence>opening.damage.sequence&&d.sequence<=(closing?.damage.sequence??-1);
            if(!inside){if(d.occurredAt>=first.clock.wallTime&&d.occurredAt<=last.wallTime)gaps.add('unsealed-original-hp-event');continue;}
            const pass=end?passes?.entries[end.mortalityHead.sequence-1]?.sample:null;
            if(!end||!pass||d.occurredAt<pass.clock.wallTime||d.occurredAt>end.wallTime
                ||d.sequence>(end.actors[0]?.authority?.healthHeads.damage.sequence??-1))gaps.add('hp-event-native-tick');
            if(!nativeAvatars.get(d.engineTick)?.has(d.username)&&!admissions.get(`${d.engineTick}:${d.username}`)?.some(t=>t<=d.occurredAt))gaps.add('hp-event-without-native-avatar');
            const death=deaths.get(actor.actorId),cause=death?.cause,lethal=cause?.kind==='engine-hp-zero'
                ?damageById.get(cause.damageEventId):null;
            if(d.hpAfter===0&&(!death||death.cause.kind!=='engine-hp-zero'||death.cause.damageEventId!==d.eventId))gaps.add('lethal-hp-without-native-death');
            const endActor=end?.actors.find(a=>a.username===actor.username),proof=end&&endActor?authority.verify({...endActor,wallTime:end.wallTime}):null;
            if(death&&end&&proof?.death&&digest(endActor?.authority?.clock)===digest(end.clock)&&((lethal&&d.sequence>lethal.sequence)||(!lethal&&end.actors.some(a=>a.username===actor.username
                &&Number(a.authority?.healthHeads.death.sequence)>=death.sequence)&&d.occurredAt>death.recordedAt)))
                fail(actor.actorId,end.clock.simulationTime,'native-hp-change-after-permanent-death',d.eventId);
        }
        for(const actor of founders){const death=deaths.get(actor.actorId);if(!death)continue;
            if(death.atSimulationTime>scope.toSimulationTime)continue;
            if(death.sequence<=(opening.death.sequence)||death.atSimulationTime<genesisAt)gaps.add('founder-terminal-before-opening');
            if(death.sequence>(closing?.death.sequence??-1))gaps.add('unsealed-original-death');
        }
    }
    const body={protocol:'native-finite-lifecycle-assessment-v1',scope,worldId:options.worldId,fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,
        founderDigest:digest(founders),mortalityHead:mortality?.sourceHead??null,attemptHead:attempts?.sourceHead??null,censusHead:watermarks?.sourceHead??null,
        healthSnapshotDigest:authority?.health.sourceSnapshotDigest??null,worldPolicyDigest:policy?.digest??null,
        completeNativeHealthCoverage:gaps.size===0,completeLifecycleEnforcement:gaps.size===0,gaps:[...gaps].sort(),violations,
        verdict:violations.length?'fail' as const:gaps.size?'inconclusive' as const:'pass' as const,
        meaning:'Original finite cohort, sealed every-tick mortality/HP/death prefixes, audited online HP routes and permanent death latches under the reviewed immutable runtime. Not a positive living/survival lower bound or hostile-host attestation.'};
    return{...body,digest:digest(body)};
}
