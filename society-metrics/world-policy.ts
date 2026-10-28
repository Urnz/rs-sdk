import type {Database} from 'bun:sqlite';
import {WorldPolicyRuntimeStore} from '../population-lifecycle/world-policy-runtime.js';
import {PolicyMutationStore} from '../population-lifecycle/policy-mutations.js';
import {NativeLifecyclePolicyStore} from '../population-lifecycle/native-policy.js';
import {readNativeLifecyclePolicy} from './lifecycle-policy.js';
import {readNativePolicyMutations} from './policy-mutations.js';
import {readStableOutcomeStore} from './population-outcomes.js';
import type {MortalityActor} from '../population-lifecycle/native-coverage.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeOutcomeOptions} from './native-outcomes.js';

/** Original policy gate under an explicitly immutable, pinned application-input contract; not OS/host attestation. */
export function readNativeWorldPolicy(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[],
    observedPolicy?:ReturnType<typeof readNativeLifecyclePolicy>,observedMutations?:ReturnType<typeof readNativePolicyMutations>){
    if(!options.policyMutationsPath)throw Object.assign(Error('World policy runtime not selected'),{code:'ENOENT'});
    const policy=observedPolicy??readNativeLifecyclePolicy(db,scope,options,genesisAt,founders),
        mutations=observedMutations??readNativePolicyMutations(db,scope,options,genesisAt,founders),
        pinned=new NativeLifecyclePolicyStore(db).read();
    const source=readStableOutcomeStore(options,options.policyMutationsPath,db=>{
        if(!WorldPolicyRuntimeStore.present(db))throw Object.assign(Error('World policy runtime contract absent'),{code:'ENOENT'});
        const journal=new PolicyMutationStore(db).read();return{runtime:new WorldPolicyRuntimeStore(db).read(),mutations:journal.selection,journal};
    });
    const gaps=new Set<string>(),violations=[...policy.violations.map(v=>({atSimulationTime:v.atSimulationTime,reason:v.reason})),
        ...mutations.violations.map(v=>({atSimulationTime:v.atSimulationTime,reason:v.reason}))];
    if(!policy.completePinnedPolicyObservations)gaps.add('policy-frame-coverage');if(!mutations.completeRecordedMutationWindow)gaps.add('policy-mutation-coverage');
    const {runtime,mutations:selection}=source,contract=runtime.contract,environment=selection.environment;
    // The environment materialization must include the actual application policy/build pin, not merely a package label.
    if(pinned.selection.manifest.sources.some(f=>!environment.files.some(p=>p.path===f.path&&p.sha256===f.sha256&&p.size===f.bytes))
        ||pinned.selection.opening.files.some(f=>f.sha256!==null&&!environment.files.some(p=>p.path===f.path&&p.sha256===f.sha256&&p.size===f.bytes)))gaps.add('policy-runtime-file-inventory');
    const entries=pinned.entries.filter(e=>e.sample.position.simulationTime>=genesisAt&&e.sample.position.simulationTime<=scope.toSimulationTime),
        first=entries[0]?.sample,last=entries.at(-1)?.sample,opening=first?.mutationCursor?.runtimeHead,closing=last?.mutationCursor?.runtimeHead;
    const prefix=(h:NonNullable<typeof opening>)=>h.sequence===0?h.digest===null:runtime.entries[h.sequence-1]?.digest===h.digest;
    let sequence=-1;
    for(const {sample} of entries){const cursor=sample.mutationCursor;
        if(cursor?.selectionDigest!==mutations.selectionDigest||!cursor.runtimeHead||!prefix(cursor.runtimeHead)||cursor.runtimeHead.sequence<sequence)gaps.add('policy-runtime-cursor');
        else sequence=cursor.runtimeHead.sequence;
    }
    const bounded=!!(first&&last&&opening&&closing&&prefix(opening)&&prefix(closing)&&opening.sequence<=closing.sequence);
    if(!bounded)gaps.add('policy-runtime-boundaries');
    const before=bounded?runtime.entries.filter(e=>e.sequence<=opening!.sequence):[],selected=bounded?runtime.entries.filter(e=>e.sequence>opening!.sequence&&e.sequence<=closing!.sequence):[];
    if(selected.length)gaps.add('policy-runtime-restarted-in-window');
    const sessions=new Map<string,string>();
    for(const role of contract.roles){const witness=before.filter(e=>e.witness.role===role).at(-1)?.witness,c=witness?.clock;
        if(witness)sessions.set(role,witness.sessionId);
        if(!witness||!c||witness.worldId!==options.worldId||c.clockId!==scope.clockId||c.profileDigest!==scope.clockProfileDigest
            ||c.simulationTime>genesisAt||witness.wallTime<c.wallTime||!first||witness.wallTime>first.wallTime
            ||witness.selectionDigest!==mutations.selectionDigest||witness.contractDigest!==hash(contract)||witness.environmentDigest!==hash(environment)
            ||witness.materializedDigest!==hash(environment.files)||witness.inputsDigest!==contract.inputs[role]
            ||witness.bunVersion!==environment.bunVersion||witness.platform!==environment.platform||witness.gaps.length)gaps.add(`policy-runtime-${role}-unverified`);
    }
    if(!sessions.get('engine')||sessions.get('engine')!==first?.sessionId||sessions.get('engine')===sessions.get('gateway'))gaps.add('policy-runtime-process-identity');
    for(const attempt of mutations.attempts){const pair=source.journal.attempts.get(attempt.attemptId),role=['mod-configure','mod-restore','director-configure'].includes(attempt.producer)?'gateway':'engine';
        if(!pair||pair.begin.sessionId!==sessions.get(role)||pair.result?.sessionId!==sessions.get(role))gaps.add('policy-mutation-process-identity');}
    for(const {witness} of selected){const c=witness.clock;
        if(witness.worldId===options.worldId&&c?.clockId===scope.clockId&&c.profileDigest===scope.clockProfileDigest&&c.simulationTime>=genesisAt
            &&c.simulationTime<=scope.toSimulationTime&&witness.selectionDigest===mutations.selectionDigest&&witness.contractDigest===hash(contract)
            &&(witness.gaps.includes('runtime-input-values-different')||witness.gaps.includes('runtime-version-or-platform-different')||witness.gaps.includes('pinned-runtime-inputs-unavailable-or-different')))
            violations.push({atSimulationTime:c.simulationTime,reason:'native-runtime-policy-inputs-changed'});
    }
    const body={protocol:'native-world-policy-assessment-v1',scope,worldId:options.worldId,fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,
        contractDigest:digest(contract),nativeContractDigest:hash(contract),policySelectionDigest:policy.selectionDigest,mutationSelectionDigest:mutations.selectionDigest,
        policyHead:policy.sourceHead,mutationHead:mutations.sourceHead,runtimeHead:closing??null,runtimeSnapshotDigest:source.sourceSnapshotDigest,
        completeWorldPolicyCoverage:gaps.size===0,gaps:[...gaps].sort(),violations,
        verdict:violations.length?'fail' as const:gaps.size?'inconclusive' as const:'pass' as const,
        trust:contract.trust,completeRuntimeDependencyUniverse:false,
        meaning:'Pinned immutable application source/config/packed inputs at actual engine and gateway startup, constant native clock/effective policies and closed declared mutation history. No hostile-host or all-loaded-dependency attestation.'};
    return{...body,digest:digest(body)};
}
