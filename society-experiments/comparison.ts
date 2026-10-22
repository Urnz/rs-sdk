import {digest, object} from '../external-trade/policy.js';
import {check} from '../external-trade/source.js';
import {compareMultiAgentExperiments, validateMultiAgentExperimentEnvironment,verifyRunXpExecution,
    type MultiAgentExperimentRun} from '../server/gateway/admin/multi-agent-experiments.js';
import {longExperimentCoverage, verifyLongExperimentBacking, type LongExperimentDependencies} from './controller.js';
import type {LongState} from './store.js';
import {validateXpStateSnapshot,xpConfigurationDigest} from './xp-state.js';

/** Capabilities describe evidence available today, not completed benchmark treatments. */
export const LONG_COMPARISON_CAPABILITIES = [
    {axis:'attribute-potential', supported:false, reason:'Generated attribute inputs do not attest engine enforcement or potential distribution.'},
    {axis:'diminishing-xp', supported:true, reason:'Native Phase 12 environments attest the switch; optional native snapshots bind empty cohort repetition state before dispatch. Engine RNG remains unattested.'},
    {axis:'facility-advantage', supported:false, reason:'Long-run bindings do not attest an applied facility treatment and its initial state.'},
    {axis:'world-start', supported:false, reason:'The current long-run controller requires finite population bindings; blank-slate and seeded starts lack them.'},
    {axis:'housing-needs', supported:false, reason:'Policy file hashes do not attest an applied housing/needs treatment.'},
    {axis:'mortality', supported:false, reason:'There is no attested mortality-disabled control in the current finite long-run protocol.'}
] as const;
export type LongComparisonAxis = typeof LONG_COMPARISON_CAPABILITIES[number]['axis'];
export interface LongComparisonRequest {
    schemaVersion:1; axis:LongComparisonAxis; controlSessionId:string; treatmentSessionId:string;
}
export function validateLongComparisonRequest(raw:unknown):LongComparisonRequest {
    const value=object(raw,['schemaVersion','axis','controlSessionId','treatmentSessionId']);
    check(value.schemaVersion===1 && LONG_COMPARISON_CAPABILITIES.some(item=>item.axis===value.axis),'Unsupported comparison schema or axis');
    for(const id of [value.controlSessionId,value.treatmentSessionId])
        check(typeof id==='string' && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(id),'Invalid comparison session id');
    check(value.controlSessionId!==value.treatmentSessionId,'Comparison requires distinct sessions');
    return {schemaVersion:1,axis:value.axis,controlSessionId:value.controlSessionId,treatmentSessionId:value.treatmentSessionId};
}

// Only additive wave observations: unique counts, concentrations, stock and price levels are not summed.
const METRICS=['totalCoinsDelta','totalXpDelta','sessionXpDelta','economicEvents','grossIncomeGp',
    'grossSpendingGp','actualGoalsCompleted'] as const;
type Metric = typeof METRICS[number];
type Values = Record<Metric,number>;
type Side = {state:LongState; deps:LongExperimentDependencies};
function add(left:Values,right:Values):Values {
    return Object.fromEntries(METRICS.map(key=>{
        const value=left[key]+right[key];
        check(Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER,'Comparison metric overflow');
        return [key,value];
    })) as Values;
}
function zero():Values {return Object.fromEntries(METRICS.map(key=>[key,0])) as Values;}
function values(wave:MultiAgentExperimentRun):Values {
    check(wave.metrics,'Completed wave metrics missing');
    return Object.fromEntries(METRICS.map(key=>{
        const value=wave.metrics![key];
        check(typeof value==='number' && Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER,
            `Missing or invalid native metric: ${key}`);
        if(!['totalCoinsDelta','totalXpDelta','sessionXpDelta'].includes(key))
            check(Number.isSafeInteger(value) && value>=0,`Invalid native count: ${key}`);
        return [key,value];
    })) as Values;
}
function difference(control:Values,treatment:Values):Values {
    return add(treatment,Object.fromEntries(METRICS.map(key=>[key,-control[key]])) as Values);
}
function protocol(state:LongState){
    const p=state.definition.plan;
    return {warmup:p.warmupSimulationMilliseconds,evaluation:p.evaluationSimulationMilliseconds,bucket:p.bucketSimulationMilliseconds,
        cadence:p.cadenceSimulationMilliseconds,gap:p.maximumGapSimulationMilliseconds,waveWall:p.maximumWaveWallMilliseconds,wall:p.maximumWallMilliseconds};
}
function readSide({state,deps}:Side){
    check(state.status==='completed' && !state.active,'Comparison requires successfully completed long programs');
    // Use the just-verified source objects for this read. A later comparison reads and verifies afresh.
    const native=verifyLongExperimentBacking(state,deps);
    const buckets=longExperimentCoverage(state);
    check(buckets.length>0 && buckets.every(row=>row.observedCompleteCohortWave),'Comparison lacks complete evaluation bucket coverage');
    const waves=new Map<string,MultiAgentExperimentRun>();
    for(const row of state.settled){
        const wave=native.get(row.claim.experimentId);
        check(wave && digest(wave)===row.event.receipt!.digest,'Native comparison backing changed during read');
        check(wave.status==='completed' && wave.environmentDigest===state.definition.environmentDigest
            && wave.parameterProfileDigest===state.definition.plan.parameterProfileDigest,'Comparison wave binding differs');
        check(validateMultiAgentExperimentEnvironment(wave.environment).digest===wave.environmentDigest,'Comparison environment digest differs');
        values(wave);waves.set(wave.experimentId,wave);
    }
    return {state,buckets,waves};
}
function reference(state:LongState){return {sessionId:state.definition.plan.sessionId,definitionDigest:state.definitionDigest,
    sequence:state.sequence,headHash:state.headHash};}

/** Inputs must be native journal states; uploaded report JSON is never accepted by the runtime. */
export function compareLongExperiments(request:LongComparisonRequest,control:Side,treatment:Side){
    const checked=validateLongComparisonRequest(request);
    check(control.state.definition.plan.sessionId===checked.controlSessionId
        && treatment.state.definition.plan.sessionId===checked.treatmentSessionId,'Comparison session binding differs');
    const capability=LONG_COMPARISON_CAPABILITIES.find(item=>item.axis===checked.axis)!;
    const base={schemaVersion:1,artifactKind:'long-experiment-comparison',request:checked,
        control:reference(control.state),treatment:reference(treatment.state),capabilities:LONG_COMPARISON_CAPABILITIES,
        causalEffectEstablished:false,engineRandomStreamSeeded:false,attributeEnforcement:'not-attested-by-phase12',
        economicAssessment:'unassessed',provesSelfSufficiency:false,completeEconomyCoverage:false};
    if(!capability.supported){
        const artifact={...base,status:'unsupported',reason:capability.reason,buckets:null,totals:null};
        return {...artifact,digest:digest(artifact)};
    }
    const c=readSide(control),t=readSide(treatment),cd=c.state.definition,td=t.state.definition;
    check(cd.binding.conditionDigest===td.binding.conditionDigest && cd.initialStateDigest===td.initialStateDigest
        && cd.plan.expectedConditionDigest===cd.binding.conditionDigest && td.plan.expectedConditionDigest===td.binding.conditionDigest
        && cd.plan.expectedInitialStateDigest===cd.initialStateDigest && td.plan.expectedInitialStateDigest===td.initialStateDigest,
    'Comparison requires the same exact genesis, founders, declared attributes, policies and initial avatar/goals');
    check(digest(protocol(c.state))===digest(protocol(t.state)),'Comparison requires the same observation protocol');
    const firstC=c.waves.get(c.state.settled[0]!.claim.experimentId)!,firstT=t.waves.get(t.state.settled[0]!.claim.experimentId)!;
    // Phase 12 verifies exact profile, known bank/avatar/goals and ONLY disabled -> enabled XP switch.
    compareMultiAgentExperiments(firstC,firstT);
    const xpSides=[[c,firstC],[t,firstT]] as const;
    const xpStates=xpSides.map(([side,first])=>{
        if(!first.xpInitialState)return null;
        const state=validateXpStateSnapshot(first.xpInitialState,side.state.definition.binding.founders.map(founder=>founder.playerUsername),
            xpConfigurationDigest(first.environment.mods.find(mod=>mod.id==='economy.diminishing-xp')!.config));
        if(side.state.definition.xpInitialState)check(side.state.definition.xpInitialState.cohortDigest===state.cohortDigest,'Comparison first wave XP baseline differs');
        return state;
    });
    const matchingEmpty=xpStates.every(state=>state?.empty) && xpStates[0]!.cohortDigest===xpStates[1]!.cohortDigest;
    const xpRepetitionState={status:matchingEmpty?'matching-empty-native-snapshots':xpStates.every(state=>state===null)?'legacy-unattested':'not-matching-empty',
        control:xpStates[0],treatment:xpStates[1],attestsExactDispatchState:false};
    const executions=[firstC,firstT].map(run=>{
        if(run.xpExecutionArmed)check(run.xpExecution,'Armed experiment lacks sealed XP execution evidence');
        return run.xpExecution?verifyRunXpExecution(run,run.xpExecution,true):null;
    });
    const exactFirst=matchingEmpty && executions.every(report=>report?.complete);
    const xpCalculationState={status:exactFirst?'matching-empty-first-native-calculations':executions.every(report=>report===null)?'legacy-unattested':'incomplete',
        control:executions[0],treatment:executions[1],attestsExactFirstCalculationState:exactFirst,attestsPlayerStatCommit:false};
    const terminalIds=new Set<string>();
    for(const side of [c,t])for(const row of side.state.settled)for(const id of row.event.receipt!.terminalRunIds){
        check(!terminalIds.has(id),'Comparison reuses terminal skill evidence');terminalIds.add(id);
    }
    const buckets=c.buckets.map((bucket,index)=>{
        const treatmentBucket=t.buckets[index]!;
        const summarize=(side:typeof c,ids:string[])=>ids.reduce((sum,id)=>add(sum,values(side.waves.get(id)!)),zero());
        const cv=summarize(c,bucket.fullyContainedWaveIds),tv=summarize(t,treatmentBucket.fullyContainedWaveIds);
        const balanced=bucket.fullyContainedWaveIds.length===treatmentBucket.fullyContainedWaveIds.length;
        const evidence=(side:typeof c,ids:string[])=>ids.map(id=>{
            const row=side.state.settled.find(item=>item.claim.experimentId===id)!;
            return {experimentId:id,nativeDigest:row.event.receipt!.digest,claim:row.claim.stamp,settlement:row.event.stamp!,
                terminalRunIds:row.event.receipt!.terminalRunIds};
        });
        return {index,fromEvaluationOffsetMilliseconds:index*cd.plan.bucketSimulationMilliseconds,
            toEvaluationOffsetMilliseconds:(index+1)*cd.plan.bucketSimulationMilliseconds,
            control:{fromSimulationTime:bucket.fromSimulationTime,toSimulationTime:bucket.toSimulationTime,
                waveCount:bucket.fullyContainedWaveIds.length,values:cv,evidence:evidence(c,bucket.fullyContainedWaveIds)},
            treatment:{fromSimulationTime:treatmentBucket.fromSimulationTime,toSimulationTime:treatmentBucket.toSimulationTime,
                waveCount:treatmentBucket.fullyContainedWaveIds.length,values:tv,evidence:evidence(t,treatmentBucket.fullyContainedWaveIds)},
            status:balanced?'balanced':'unequal-wave-count',treatmentMinusControl:balanced?difference(cv,tv):null};
    });
    const balanced=buckets.every(bucket=>bucket.status==='balanced');
    const csum=buckets.reduce((sum,bucket)=>add(sum,bucket.control.values),zero()),tsum=buckets.reduce((sum,bucket)=>add(sum,bucket.treatment.values),zero());
    const excluded=(side:typeof c)=>{
        const included=new Set(side.buckets.flatMap(bucket=>bucket.fullyContainedWaveIds));
        return side.state.settled.filter(row=>!included.has(row.claim.experimentId)).map(row=>row.claim.experimentId);
    };
    const artifact={...base,status:balanced?'descriptive-comparison':'inconclusive',xpRepetitionState,xpCalculationState,
        measurement:'sum-of-fully-contained-native-wave-metrics',buckets,
        totals:{control:csum,treatment:tsum,treatmentMinusControl:balanced?difference(csum,tsum):null},
        excludedWaveIds:{control:excluded(c),treatment:excluded(t)},
        limitations:['Observation envelopes are not exact simulation timestamps of economic events.',
            'Wave snapshots include global economy changes; intervals between waves are unmeasured.',
            'Equal wave counts do not prove identical execution timing, workload or causal effects.',
            exactFirst?'Empty repetition state is bound at each player\'s first armed native XP calculation; final Player stat persistence is not attested.'
                :matchingEmpty?'Empty cohort XP state was observed before dispatch; activity between capture and execution is not excluded.'
                :'Matching empty diminishing-XP repetition state is not attested.',
            'Other hidden engine state and engine RNG reset remain unattested.',
            'A single pair provides no replicated treatment effect or statistical significance.']};
    return {...artifact,digest:digest(artifact)};
}
