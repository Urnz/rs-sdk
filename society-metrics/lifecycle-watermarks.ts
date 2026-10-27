import type { Database } from 'bun:sqlite';
import { NativeLifecycleWatermarkStore } from '../population-lifecycle/native-watermarks.js';
import { NativeLifecycleAttemptStore } from '../population-lifecycle/native-attempts.js';
import { NativeMortalityCoverageStore,mortalityRosterDigest,type MortalityActor } from '../population-lifecycle/native-coverage.js';
import { nativeLifecycleAuthorityVerifier,readNativeLifecycleAttempts } from './lifecycle-attempts.js';
import { readNativeMortalityCoverage } from './mortality-coverage.js';
import { outcomeCheck as check } from './outcome-work.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { EvaluationScope } from './evaluation.js';
import type { NativeOutcomeOptions } from './native-outcomes.js';

/** Paired World slot snapshots and anchored attempt cursors. This is not continuous HP or complete route enforcement. */
export function readNativeLifecycleWatermarks(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[]){
    if(!NativeLifecycleWatermarkStore.present(db))throw Object.assign(Error('Lifecycle watermarks not selected'),{code:'ENOENT'});
    const source=new NativeLifecycleWatermarkStore(db).read(),s=source.mortality;
    check(s.worldId===options.worldId&&s.clockId===scope.clockId&&s.clockProfileDigest===scope.clockProfileDigest&&s.fromSimulationTime===genesisAt
        &&mortalityRosterDigest(s.actors)===mortalityRosterDigest(founders),'Lifecycle watermark original scope differs');
    const {health,verify}=nativeLifecycleAuthorityVerifier(options,scope,genesisAt,founders,s.maximumWallGapMs),gaps=new Set<string>();
    const deaths=new Map(health.deaths.map(d=>[d.agentId,d]));
    const prefix=(h:{sequence:number;digest:string|null},entries:Array<{sequence:number;digest:string}>)=>
        h.sequence===0?h.digest===null:entries[h.sequence-1]?.sequence===h.sequence&&entries[h.sequence-1]?.digest===h.digest;
    let mortality:ReturnType<NativeMortalityCoverageStore['read']>|null=null,attempts:ReturnType<NativeLifecycleAttemptStore['read']>|null=null;
    try{mortality=new NativeMortalityCoverageStore(db).read();if(!readNativeMortalityCoverage(db,scope,options,genesisAt,founders).completeMortalityTickCoverage)gaps.add('mortality-pass-coverage');}
    catch{gaps.add('mortality-source-unavailable');}
    try{attempts=new NativeLifecycleAttemptStore(db).read();}catch{gaps.add('attempt-source-unavailable');}
    const opening=source.selection.openingAttemptCursor;
    if(!attempts||!prefix(opening.head,attempts.entries)||opening.faultCount!==0||attempts.faults!==0)gaps.add('attempt-source-prefix-or-fault');
    if(source.faults)gaps.add('watermark-write-fault');
    if(s.toSimulationTime<scope.toSimulationTime)gaps.add('selection-window');
    const selected=source.entries.filter(e=>e.sample.clock.simulationTime>=genesisAt&&e.sample.clock.simulationTime<=scope.toSimulationTime),
        violations:Array<{sampleSequence:number;actorId:string;kind:string;atSimulationTime:string;reason:string;deathEventId:string|null}>=[];
    let prior:typeof selected[number]|undefined,priorCursor=opening.head;
    const actorHeads=new Map<string,{damage:number;death:number}>();
    for(const entry of selected){const e=entry.sample,c=e.clock,matchingClock=c.clockId===scope.clockId&&c.profileDigest===scope.clockProfileDigest;
        if(!matchingClock||Date.parse(e.wallTime)-Date.parse(c.wallTime)>s.maximumWallGapMs)gaps.add('clock-authority');
        const m=mortality?.entries[e.mortalityHead.sequence-1];
        if(!m||m.digest!==e.mortalityHead.digest||m.sample.clock.engineTick!==c.engineTick||m.sample.clock.clockId!==c.clockId
            ||m.sample.clock.profileDigest!==c.profileDigest||m.sample.clock.revision>c.revision||m.sample.clock.simulationTime>c.simulationTime
            ||m.sample.clock.wallTime>c.wallTime)gaps.add('mortality-watermark-prefix');
        if(!attempts||!prefix(e.attemptHead,attempts.entries)||e.attemptHead.sequence<priorCursor.sequence||e.attemptFaultCount!==0)gaps.add('attempt-watermark-prefix-or-fault');
        if(e.actors.length!==founders.length||e.actors.some(a=>!founders.some(f=>f.username===a.username)))gaps.add('census-roster');
        for(const a of e.actors){const proof=verify({...a,wallTime:e.wallTime}),authority=a.authority;
            if(!proof||!authority||digest(authority.clock)!==digest(c)){gaps.add('census-actor-authority');continue;}
            const death=deaths.get(proof.actorId);
            // Equal timestamps cannot order intratick damage. The anchored head identifies which side of it was observed.
            if(death&&death.atSimulationTime<c.simulationTime&&death.recordedAt<e.wallTime&&!proof.death)gaps.add('census-health-prefix-before-due-death');
            if(m&&(['damage','death'] as const).some(d=>authority.healthHeads[d].sequence<m.sample.healthHeads[d].sequence))gaps.add('census-health-prefix-before-mortality');
            const priorHeads=actorHeads.get(a.username);
            if(priorHeads&&(['damage','death'] as const).some(d=>authority.healthHeads[d].sequence<priorHeads[d]))gaps.add('census-health-prefix-regression');
            actorHeads.set(a.username,{damage:authority.healthHeads.damage.sequence,death:authority.healthHeads.death.sequence});
            const avatars=e.avatars.filter(v=>v.username===a.username);
            if(e.stage!=='after-terminal-guard'||!matchingClock)continue;
            const reason=avatars.length>1?'duplicate-original-avatar':avatars.some(v=>!v.vitals.finite)?'original-avatar-finite-flag-missing'
                :avatars.length&&(proof.death||avatars.some(v=>v.vitals.terminal||v.vitals.hitpoints===0))?'terminal-avatar-remained-after-guard':null;
            if(reason)violations.push({sampleSequence:entry.sequence,actorId:proof.actorId,kind:'post-guard-census',atSimulationTime:c.simulationTime,reason,deathEventId:proof.death?.eventId??null});
        }
        if(!prior){if(e.stage!=='after-terminal-guard'||c.simulationTime!==genesisAt)gaps.add('window-opening');}
        else{const p=prior.sample,dc=Date.parse(c.simulationTime)-Date.parse(p.clock.simulationTime),dw=Date.parse(c.wallTime)-Date.parse(p.clock.wallTime);
            const sameTick=p.stage==='after-terminal-guard';
            if(e.sessionId!==p.sessionId||e.stage===(p.stage)||c.engineTick!==Number(p.clock.engineTick)+(sameTick?0:1)
                ||c.revision<p.clock.revision||dc<0||dc>s.maximumSimulationGapMs||dw<0||(!sameTick&&dw===0)||dw>s.maximumWallGapMs
                ||e.wallTime<p.wallTime||Date.parse(e.wallTime)-Date.parse(p.wallTime)>s.maximumWallGapMs
                ||(sameTick&&digest(e.mortalityHead)!==digest(p.mortalityHead)))gaps.add('tick-stage-session-clock-gap');
        }
        prior=entry;priorCursor=e.attemptHead;
    }
    if(!prior||prior.sample.stage!=='end-of-tick'||prior.sample.clock.simulationTime!==scope.toSimulationTime)gaps.add('window-closing');
    if(attempts&&selected.length){
        const last=selected.at(-1)!.sample,observed=readNativeLifecycleAttempts(db,scope,options,genesisAt,founders),statuses=new Map(observed.attempts.map(a=>[a.attemptId,a.status]));
        const sequences=new Map<string,number[]>();for(const e of attempts.entries){const list=sequences.get(e.event.attemptId)??[];list.push(e.sequence);sequences.set(e.event.attemptId,list);}
        for(const pair of attempts.attempts.values()){
            const events=[pair.begin,...pair.result?[pair.result]:[]],inWindow=events.some(e=>e.authority&&e.authority.clock.simulationTime>=genesisAt&&e.authority.clock.simulationTime<=scope.toSimulationTime),
                entries=sequences.get(pair.begin.attemptId)!,between=entries.some(sequence=>sequence>opening.head.sequence&&sequence<=last.attemptHead.sequence);
            if(!inWindow&&!between)continue;
            if(pair.begin.authority&&pair.result?.authority&&(['damage','death'] as const).some(d=>
                pair.result!.authority!.healthHeads[d].sequence<pair.begin.authority!.healthHeads[d].sequence))gaps.add('attempt-health-prefix-regression');
            if(!pair.result||statuses.get(pair.begin.attemptId)!=='observed'||events.some(e=>e.sessionId!==last.sessionId)
                ||entries.some(sequence=>sequence<=opening.head.sequence||sequence>last.attemptHead.sequence))gaps.add('unsealed-or-unproven-attempt');
        }
        // A null-authority or out-of-window event appended after the closing seal cannot silently disappear.
        if(attempts.head.sequence!==last.attemptHead.sequence)gaps.add('attempt-tail-after-window');
    }
    const body={protocol:'native-lifecycle-watermarks-v1',scope,worldId:options.worldId,selectionDigest:digest(source.selection),sourceHead:source.head,
        healthSnapshotDigest:health.sourceSnapshotDigest,sampleCount:selected.length,faultCount:source.faults,gaps:[...gaps].sort(),violations,
        completePostGuardCensusCoverage:gaps.size===0,completeRecordedAttemptWindow:gaps.size===0,completeLifecycleEnforcement:false,
        verdict:violations.length?'fail':'inconclusive',meaning:'Paired per-tick actual World slots and attempt head/fault witnesses. No continuous HP, complete route/build history, survival or full integrity PASS.'};
    return{...body,digest:digest(body)};
}
