import type { Database } from 'bun:sqlite';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import { PolicyMutationStore,type PolicyMutationEvent } from '../population-lifecycle/policy-mutations.js';
import { policyMutationProducers } from '../population-lifecycle/policy-environment.js';
import { NativeLifecyclePolicyStore } from '../population-lifecycle/native-policy.js';
import { NativeMortalityCoverageStore,mortalityRosterDigest,type MortalityActor } from '../population-lifecycle/native-coverage.js';
import { readNativeLifecyclePolicy } from './lifecycle-policy.js';
import { readStableOutcomeStore } from './population-outcomes.js';
import { outcomeCheck as check } from './outcome-work.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { NativeOutcomeOptions } from './native-outcomes.js';
import type { EvaluationScope } from './evaluation.js';

/** Configuration mutations and normal signal acceptances have different meanings. A sampled closed cursor bounds the historical window. */
export function readNativePolicyMutations(checkpoint:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[]){
    if(!options.policyMutationsPath)throw Object.assign(Error('Policy mutation source not selected'),{code:'ENOENT'});
    const source=readStableOutcomeStore(options,options.policyMutationsPath,db=>new PolicyMutationStore(db).read()),s=source.selection,
        policy=new NativeLifecyclePolicyStore(checkpoint).read(),original=policy.mortality;
    check(s.worldId===options.worldId&&s.clockId===scope.clockId&&s.clockProfileDigest===scope.clockProfileDigest&&s.fromSimulationTime===genesisAt
        &&s.toSimulationTime>=scope.toSimulationTime&&s.policySelectionDigest===nativeToolDigest(policy.selection)&&original.worldId===s.worldId
        &&original.clockId===s.clockId&&original.clockProfileDigest===s.clockProfileDigest&&original.fromSimulationTime===genesisAt
        &&s.maximumWallGapMs===original.maximumWallGapMs&&mortalityRosterDigest(original.actors)===mortalityRosterDigest(founders),'Policy mutation original scope differs');
    for(const producer of policyMutationProducers){const pin=s.environment.files.find(f=>f.path===producer.path&&f.role==='source'),code=policy.selection.manifest.sources.find(f=>f.path===producer.path);
        check(pin&&code&&pin.sha256===code.sha256&&pin.size===code.bytes,'Mutation producer source pin differs');}
    const gaps=new Set<string>(),attempts:Array<{attemptId:string;producer:string;outcome:string|null;status:'observed'|'unproven';effect:'configuration'|'signal'}>=[],
        violations:Array<{attemptId:string;producer:string;atSimulationTime:string;reason:string}>=[];
    try{if(!readNativeLifecyclePolicy(checkpoint,scope,options,genesisAt,founders).completePinnedPolicyObservations)gaps.add('policy-frame-coverage');}catch{gaps.add('policy-frame-source');}
    let passes:ReturnType<NativeMortalityCoverageStore['read']>|null=null;try{passes=new NativeMortalityCoverageStore(checkpoint).read();}catch{gaps.add('native-position-source');}
    const frames=policy.entries.filter(({sample:e})=>{const c=e.position,m=passes?.entries[e.mortalityHead.sequence-1];return e.worldId===s.worldId&&c.clockId===s.clockId
        &&c.profileDigest===s.clockProfileDigest&&c.simulationTime>=genesisAt&&c.simulationTime<=scope.toSimulationTime&&m?.digest===e.mortalityHead.digest
        &&digest(m.sample.clock)===digest(c)&&mortalityRosterDigest(m.sample.actors)===mortalityRosterDigest(founders)
        &&Date.parse(e.wallTime)-Date.parse(c.wallTime)<=s.maximumWallGapMs;});
    const prefix=(h:{sequence:number;digest:string|null})=>h.sequence===0?h.digest===null:source.entries[h.sequence-1]?.digest===h.digest;
    let priorSequence=-1;for(const {sample:e} of frames){const c=e.mutationCursor;if(!c||c.selectionDigest!==source.selectionDigest||!prefix(c.head)||c.head.sequence<priorSequence)gaps.add('mutation-cursor-prefix');
        else priorSequence=c.head.sequence;if(c?.faultCount)gaps.add('mutation-observer-fault');}
    if(source.faultCount)gaps.add('mutation-observer-fault');
    const anchors=frames.filter(e=>e.sample.mutationCursor?.selectionDigest===source.selectionDigest&&prefix(e.sample.mutationCursor.head)),
        first=anchors[0]?.sample,last=anchors.at(-1)?.sample,opening=first?.mutationCursor,closing=last?.mutationCursor,
        bounded=!!(first&&last&&opening&&closing&&opening.head.sequence<=closing.head.sequence&&first.wallTime<=last.wallTime),
        completeWindow=bounded&&first?.stage==='after-terminal-guard'&&first.position.simulationTime===genesisAt
            &&last?.stage==='end-of-tick'&&last.position.simulationTime===scope.toSimulationTime;
    if(!completeWindow)gaps.add('mutation-window-boundaries');
    const sequences=new Map<string,number[]>();for(const e of source.entries){const list=sequences.get(e.event.attemptId)??[];list.push(e.sequence);sequences.set(e.event.attemptId,list);}
    const bound=(e:PolicyMutationEvent)=>{const c=e.clock;return !!(c&&e.worldId===s.worldId&&c.clockId===s.clockId&&c.profileDigest===s.clockProfileDigest
        &&c.simulationTime>=genesisAt&&c.simulationTime<=scope.toSimulationTime&&e.wallTime>=c.wallTime&&Date.parse(e.wallTime)-Date.parse(c.wallTime)<=s.maximumWallGapMs);};
    for(const [attemptId,pair] of source.attempts){const seq=sequences.get(attemptId)!,effect=policyMutationProducers.find(p=>p.id===pair.begin.producer)!.effect,
        between=bounded&&seq.some(n=>n>opening!.head.sequence&&n<=closing!.head.sequence);
        if(!between)continue;
        const result=pair.result,known=!!(result&&bound(pair.begin)&&bound(result)&&pair.begin.wallTime>=first!.wallTime&&result.wallTime<=last!.wallTime
            &&result.clock!.simulationTime>=pair.begin.clock!.simulationTime&&result.clock!.revision>=pair.begin.clock!.revision
            &&seq.every(n=>n>opening!.head.sequence&&n<=closing!.head.sequence));
        attempts.push({attemptId,producer:pair.begin.producer,outcome:result?.outcome??null,status:known?'observed':'unproven',effect});
        if(!known){gaps.add('unfinished-or-unbound-mutation');continue;}
        if(effect==='configuration'&&result!.outcome==='applied'){
            if(!pair.begin.beforeDigest||!result!.afterDigest)gaps.add('mutation-state-digest-unavailable');
            else if(pair.begin.beforeDigest!==result!.afterDigest)violations.push({attemptId,producer:pair.begin.producer,atSimulationTime:result!.clock!.simulationTime,reason:'post-genesis-world-policy-mutated'});
        }
    }
    const body={protocol:'native-policy-mutation-observations-v1',scope,worldId:options.worldId,selectionDigest:source.selectionDigest,sourceHead:source.head,
        sourceSnapshotDigest:source.sourceSnapshotDigest,environmentPinDigest:digest(s.environment),environmentFileCount:s.environment.files.length,
        observedProducers:policyMutationProducers.map(p=>p.id),faultCount:source.faultCount,attempts,violations,gaps:[...gaps].sort(),
        completeRecordedMutationWindow:gaps.size===0,completeWorldPolicyEnforcement:false,verdict:violations.length?'fail':'inconclusive',
        meaning:'Pinned archive file universe and closed native cursor window for the declared gateway/engine producers. Normal signal acceptance is not a configuration mutation. Unregistered/external file writers and full loaded dependency/environment history remain unproven.'};
    return{...body,digest:digest(body)};
}
