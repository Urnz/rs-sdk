import { digest, time } from '../external-trade/policy.js';
import {validateXpStateSnapshot,type XpStateSnapshot} from './xp-state.js';
import type {XpExecutionReport} from './xp-execution.js';
import { check } from '../external-trade/source.js';
import { multiAgentExperimentDefinition, type MultiAgentExperimentInput, type MultiAgentExperimentRun } from '../server/gateway/admin/multi-agent-experiments.js';
import { validateLongExperimentPlan, longPlanDigest, waveId, type LongExperimentPlan } from './plan.js';
import { LongExperimentStore, type LongEvent, type LongState, type WaveClaim } from './store.js';
import type { LongExperimentBinding } from './source.js';
import type { BoundSimulationEventStamp, SimulationClockObservation } from '../simulation-clock/types.js';

export interface LongExperimentDependencies {
    binding(plan:LongExperimentPlan):LongExperimentBinding;
    preflight(input:MultiAgentExperimentInput):Promise<{initialStateDigest:string;environmentDigest:string;parameterProfileDigest:string;xpInitialState?:XpStateSnapshot}>;
    environmentDigest():Promise<string>;
    getWave(id:string):MultiAgentExperimentRun|null;
    startWave(claim:WaveClaim,definition:LongState['definition']):Promise<unknown>;
    observe():SimulationClockObservation;
    bind(sourceId:string,event:LongEvent):BoundSimulationEventStamp;
    verifyStamp(stamp:BoundSimulationEventStamp):void;
    verifyStamps?(stamps:BoundSimulationEventStamp[]):void;
    getWaves?(ids:string[]):Map<string,MultiAgentExperimentRun|null>;
    verifyXpExecution?(report:XpExecutionReport):void;
    verifyXpExecutions?(reports:XpExecutionReport[]):void;
    wallNow():string;
}
function input(plan:LongExperimentPlan,binding:LongExperimentBinding,index:number):MultiAgentExperimentInput {
    return {label:`${plan.label} #${index+1}`,summary:plan.summary,seed:binding.genesis.seed,agentIds:binding.founders.map(row=>row.agentId),
        parameterProfileId:plan.parameterProfileId,parameterProfileVersion:plan.parameterProfileVersion};
}
function stamped(id:string,sequence:number,event:LongEvent,deps:LongExperimentDependencies):LongEvent {
    const stamp=deps.bind(`${id}:${sequence}`,event);return {...event,wallTime:stamp.wallTime,stamp};
}
export async function prepareLongExperiment(raw:LongExperimentPlan,deps:LongExperimentDependencies){
    const plan=validateLongExperimentPlan(raw),binding=deps.binding(plan),preview=await deps.preflight(input(plan,binding,0));
    check(binding.integrityResolved && preview.parameterProfileDigest===plan.parameterProfileDigest,'Phase 12/native profile or integrity gate differs');
    if(preview.xpInitialState)validateXpStateSnapshot(preview.xpInitialState,binding.founders.map(founder=>founder.playerUsername));
    return {plan:{...plan,expectedConditionDigest:binding.conditionDigest,expectedInitialStateDigest:preview.initialStateDigest},binding,preview};
}
export async function startLongExperiment(raw:LongExperimentPlan,store:LongExperimentStore,deps:LongExperimentDependencies){
    const plan=validateLongExperimentPlan(raw),existing=store.get(plan.sessionId);
    if(existing){check(longPlanDigest(existing.definition.plan)===longPlanDigest(plan),'Long experiment id already bound');return existing;}
    const prepared=await prepareLongExperiment(plan,deps);
    check(prepared.binding.conditionDigest===plan.expectedConditionDigest && prepared.preview.initialStateDigest===plan.expectedInitialStateDigest,
        'Long experiment starting conditions differ; restore the baseline before repeating');
    const observation=deps.observe();check(observation.status==='running' && observation.clockId===prepared.binding.genesis.simulationClock.clockId
        && observation.profileDigest===prepared.binding.genesis.simulationClock.profileDigest,'Long experiment requires existing running world clock');
    const definition={plan,binding:prepared.binding,initialStateDigest:prepared.preview.initialStateDigest,environmentDigest:prepared.preview.environmentDigest,
        ...(prepared.preview.xpInitialState?{xpInitialState:prepared.preview.xpInitialState}:{})};
    const event=stamped(plan.sessionId,1,{kind:'started',definitionDigest:digest(definition),wallTime:observation.wallTime,stamp:null},deps);
    check(event.stamp!.status==='running','World clock paused during start');
    return store.create(definition,event);
}
export function longExperimentCoverage(state:LongState){
    const plan=state.definition.plan,start=Date.parse(state.started.simulationTime),evaluationStart=start+plan.warmupSimulationMilliseconds;
    return Array.from({length:plan.evaluationSimulationMilliseconds/plan.bucketSimulationMilliseconds},(_,index)=>{
        const from=evaluationStart+index*plan.bucketSimulationMilliseconds,to=from+plan.bucketSimulationMilliseconds;
        const waves=state.settled.filter(row=>row.event.receipt?.status==='completed' && Date.parse(row.claim.stamp.simulationTime)>=from
            && Date.parse(row.event.stamp!.simulationTime)<=to);
        return {index,fromSimulationTime:new Date(from).toISOString(),toSimulationTime:new Date(to).toISOString(),
            fullyContainedWaveIds:waves.map(row=>row.claim.experimentId),observedCompleteCohortWave:waves.length>0};
    });
}
export function verifyLongExperimentBacking(state:LongState,deps:LongExperimentDependencies){
    const stamps=state.history.flatMap(event=>event.stamp?[event.stamp]:[]);
    if(deps.verifyStamps)deps.verifyStamps(stamps);else for(const stamp of stamps)deps.verifyStamp(stamp);
    const ids=state.settled.map(row=>row.claim.experimentId);
    const waves=deps.getWaves?.(ids)??new Map(ids.map(id=>[id,deps.getWave(id)]));
    const executions:XpExecutionReport[]=[];
    for(const row of state.settled){const native=waves.get(row.claim.experimentId);check(native && digest(native)===row.event.receipt!.digest,'Native Phase 12 settlement backing differs');
        if(native.xpExecution)executions.push(native.xpExecution);}
    if(executions.length){if(deps.verifyXpExecutions)deps.verifyXpExecutions(executions);
        else{check(deps.verifyXpExecution,'Native XP execution backing verifier unavailable');for(const report of executions)deps.verifyXpExecution(report);}}
    return waves;
}
export async function stepLongExperiment(id:string,store:LongExperimentStore,deps:LongExperimentDependencies){
    const state=store.get(id);check(state,'Long experiment does not exist');
    verifyLongExperimentBacking(state,deps);
    if(state.status!=='running')return state;
    try{
        const plan=state.definition.plan,binding=deps.binding(plan);
        check(binding.conditionDigest===state.definition.binding.conditionDigest && binding.sourcePathsDigest===state.definition.binding.sourcePathsDigest,'Pinned genesis/population/attribute/policy/source binding changed');
        check(await deps.environmentDigest()===state.definition.environmentDigest,'Active engine policy changed');
        const wave=state.active?deps.getWave(state.active.experimentId):null,observation=deps.observe();
        check(observation.clockId===binding.genesis.simulationClock.clockId && observation.profileDigest===binding.genesis.simulationClock.profileDigest,'Clock binding changed');
        const elapsed=Date.parse(observation.simulationTime)-Date.parse(state.started.simulationTime),
            gap=Date.parse(observation.simulationTime)-Date.parse(state.lastStamp.simulationTime),
            wallElapsed=Date.parse(observation.wallTime)-Date.parse(state.started.wallTime);
        check(elapsed>=0 && gap>=0 && wallElapsed>=0 && gap<=plan.maximumGapSimulationMilliseconds,'Observation gap or clock rollback; no synthetic catch-up');
        check(wallElapsed<=plan.maximumWallMilliseconds,'Finite wall deadline exceeded');
        const append=(event:Omit<LongEvent,'wallTime'|'stamp'|'definitionDigest'>)=>{
            const bound=stamped(id,state.sequence+1,{...event,definitionDigest:state.definitionDigest,wallTime:observation.wallTime,stamp:null},deps);
            check(Date.parse(bound.stamp!.simulationTime)-Date.parse(state.lastStamp.simulationTime)<=plan.maximumGapSimulationMilliseconds,'Observation gap during commit');
            if(event.kind==='claimed')check(bound.stamp!.status==='running' && Date.parse(bound.stamp!.simulationTime)<Date.parse(state.started.simulationTime)
                +plan.warmupSimulationMilliseconds+plan.evaluationSimulationMilliseconds,'Wave claim crossed the deadline or native clock paused');
            return store.append(id,state.sequence,bound);
        };
        if(!binding.integrityResolved)return gap>=Math.min(plan.cadenceSimulationMilliseconds,plan.maximumGapSimulationMilliseconds)/4
            ?append({kind:'observed',unresolvedIntegrity:true}):state;
        if(state.active){
            check(Date.parse(observation.wallTime)-Date.parse(state.active.stamp.wallTime)<=plan.maximumWaveWallMilliseconds,'Unresolved wave exceeded wall deadline; existing jobs are not relaunched');
            if(wave && wave.status!=='running'){
                const expected=multiAgentExperimentDefinition(state.active.input);
                check(wave.definitionDigest===expected.digest && wave.seed===binding.genesis.seed && wave.environmentDigest===state.definition.environmentDigest
                    && wave.parameterProfileDigest===plan.parameterProfileDigest && wave.status==='completed' && wave.finishedAt && wave.metrics,
                    'Native Phase 12 wave failed or binding changed');
                if(state.active.index===0 && state.definition.xpInitialState)check(wave.xpInitialState?.cohortDigest===state.definition.xpInitialState.cohortDigest,'First wave XP baseline differs');
                check(digest([...wave.participants].map(row=>({agentId:row.agentId,playerUsername:row.avatarPlayerUsername})).sort((a,b)=>a.agentId.localeCompare(b.agentId)))
                    ===digest(binding.founders.map(({agentId,playerUsername})=>({agentId,playerUsername}))), 'Wave founder cohort differs');
                check(Date.parse(time(wave.startedAt))>=Date.parse(state.active.stamp.wallTime)
                    && Date.parse(time(wave.finishedAt))>=Date.parse(wave.startedAt)
                    && Date.parse(wave.finishedAt)<=Date.parse(observation.wallTime),'Wave timestamps escape observation envelope');
                const terminalRunIds=wave.participants.map(row=>{
                    check(row.status==='completed' && row.runId && row.skillRun?.status==='completed' && row.skillRun.runId===row.runId
                        && row.skillRun.username===row.avatarPlayerUsername
                        && Date.parse(time(row.skillRun.startedAt))>=Date.parse(wave.startedAt)
                        && Date.parse(time(row.skillRun.finishedAt))>=Date.parse(row.skillRun.startedAt)
                        && Date.parse(row.skillRun.finishedAt)<=Date.parse(wave.finishedAt!),'Wave lacks successful native terminal skill evidence');return row.runId;
                });
                check(new Set(terminalRunIds).size===terminalRunIds.length && !state.settled.some(row=>row.event.receipt!.terminalRunIds.some(id=>terminalRunIds.includes(id))), 'Duplicate terminal skill backing');
                return append({kind:'settled',receipt:{experimentId:wave.experimentId,digest:digest(wave),status:wave.status,startedAt:wave.startedAt,finishedAt:wave.finishedAt,terminalRunIds}});
            }
            if(!wave && observation.status==='running')await deps.startWave(state.active,state.definition);
        }else if(elapsed>=plan.warmupSimulationMilliseconds+plan.evaluationSimulationMilliseconds){
            check(longExperimentCoverage(state).every(row=>row.observedCompleteCohortWave),'Evaluation bucket lacks a contained successful cohort wave');
            return append({kind:'completed'});
        }else if(observation.status==='running'){
            const lastClaim=state.history.filter(event=>event.kind==='claimed').at(-1);
            if(!lastClaim || Date.parse(observation.simulationTime)-Date.parse(lastClaim.stamp!.simulationTime)>=plan.cadenceSimulationMilliseconds){
                check(state.nextWave<10000,'Finite wave limit exceeded');
                const claim={index:state.nextWave,experimentId:waveId(id,longPlanDigest(plan),state.nextWave),input:input(plan,binding,state.nextWave),
                    ...(state.nextWave===0?{expectedInitialStateDigest:plan.expectedInitialStateDigest}:{})};
                const claimed=append({kind:'claimed',wave:claim});
                await deps.startWave(claim,state.definition);return claimed;
            }
        }
        if(gap>=Math.min(plan.cadenceSimulationMilliseconds,plan.maximumGapSimulationMilliseconds)/4)return append({kind:'observed'});
        return state;
    }catch(error){
        const latest=store.get(id)!;
        // A competing controller or a committed claim keeps its side-effect identity. Never replace it on an ambiguous response.
        if(latest.sequence!==state.sequence)throw error;
        return store.append(id,state.sequence,{kind:'failed',definitionDigest:state.definitionDigest,stamp:null,wallTime:deps.wallNow(),error:error instanceof Error?error.message:'Long experiment failed'});
    }
}
export function stopLongExperiment(id:string,store:LongExperimentStore,deps:LongExperimentDependencies,reason:string){
    check(reason.trim().length>0 && reason.length<=1000,'Explicit stop reason required');const state=store.get(id);check(state,'Long experiment missing');
    if(state.status!=='running')return state;
    return store.append(id,state.sequence,{kind:'stopped',definitionDigest:state.definitionDigest,stamp:null,wallTime:deps.wallNow(),error:reason});
}
export function reportLongExperiment(state:LongState){
    const artifact={schemaVersion:1,artifactKind:'controlled-long-experiment',definition:state.definition,definitionDigest:state.definitionDigest,
        status:state.status,sequence:state.sequence,headHash:state.headHash,started:state.started,lastObservation:state.lastStamp,
        activeWave:state.active,settledWaves:state.settled,buckets:longExperimentCoverage(state),history:state.history,
        economicAssessment:'unassessed',provesSelfSufficiency:false,completeEconomyCoverage:false,engineRandomStreamSeeded:false,
        attributeEnforcement:'not-attested-by-phase12',measurement:'bounded-execution-protocol-and-observation-envelopes'};
    return {...artifact,digest:digest(artifact)};
}
