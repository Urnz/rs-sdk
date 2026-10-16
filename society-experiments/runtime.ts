import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { digest, time } from '../external-trade/policy.js';
import { check, readDatabase } from '../external-trade/source.js';
import { loadSimulationClockRuntimeConfig } from '../simulation-clock/config.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
import type {BoundSimulationEventStamp} from '../simulation-clock/types.js';
import { MultiAgentExperimentStore, validateMultiAgentExperimentEnvironment } from '../server/gateway/admin/multi-agent-experiments.js';
import { readLongExperimentBinding, type LongExperimentSources } from './source.js';
import { LongExperimentStore, type LongEvent } from './store.js';
import { reportLongExperiment, verifyLongExperimentBacking, type LongExperimentDependencies } from './controller.js';
import {compareLongExperiments,validateLongComparisonRequest,LONG_COMPARISON_CAPABILITIES} from './comparison.js';
import {readXpExecutionSource,readXpExecutionSources} from './xp-execution-source.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export const longExperimentJournalPath=join(root,'.local/admin/long-experiments.sqlite');
export function defaultLongExperimentSources(baseRoot=root):LongExperimentSources{return {
    genesisPath:join(baseRoot,'.local/simulation/world-genesis-runs.sqlite'),agentPath:join(baseRoot,'.local/agent-state/agents.sqlite'),
    parameterPath:join(baseRoot,'.local/admin/experiment-parameters.sqlite'),clockPath:join(baseRoot,'.local/simulation/simulation-clock.sqlite'),configDirectory:join(baseRoot,'config'),
    integrityPath:join(baseRoot,'.local/simulation/society-integrity.sqlite')};}
export function localExperimentClient(origin='http://localhost:7780',token=process.env.ADMIN_TOKEN?.trim()||'',fetcher:(url:URL,init:RequestInit)=>Promise<Response>=fetch){
    const url=new URL(origin);check(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
        && !url.username && !url.password && url.pathname==='/' && !url.search && !url.hash,'Only the local/private gateway is supported');
    return async(path:string,body?:unknown)=>{
        check(path.startsWith('/api/admin/multi-agent-experiments') && !path.includes('..'),'Invalid experiment endpoint');
        const response=await fetcher(new URL(path,url),{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30000),
            headers:{'X-Admin-Request':'rs-sdk-admin',...(token?{'X-Admin-Token':token}:{}),'Content-Type':'application/json'},
            ...(body===undefined?{}:{body:JSON.stringify(body)})});
        check(response.ok,`Local experiment request failed: HTTP ${response.status}`);return response.json();
    };
}
export function nativeLongExperimentDependencies(paths=defaultLongExperimentSources(),client=localExperimentClient(),
    experimentPath=join(root,'.local/admin/multi-agent-experiments.sqlite'),xpExecutionPath=join(root,'.local/admin/xp-execution.sqlite')):LongExperimentDependencies {
    function contemporaneous<T>(store:SimulationClockStore,id:string,write:(wallTime:string)=>T):T {
        for(let attempt=0;attempt<3;attempt++){
            const wallTime=new Date(Math.max(Date.now(),Date.parse(store.get(id)!.lastObservedWallTime))).toISOString();
            try{return write(wallTime);}catch(error){if(attempt===2 || !(error instanceof Error) || !error.message.includes('Wall clock regression rejected'))throw error;}
        }
        throw new Error('Concurrent world clock did not settle');
    }
    function verifyStamps(stamps:BoundSimulationEventStamp[]){
        readDatabase(paths.clockPath,db=>{
            check((db.query('PRAGMA user_version').get() as any).user_version===SIMULATION_CLOCK_STORE_SCHEMA_VERSION,'Unsupported native clock');
            for(const stamp of stamps){const row=db.query('SELECT * FROM simulation_event_stamp WHERE clock_id=?1 AND domain=?2 AND source_id=?3').get(stamp.clockId,stamp.domain,stamp.sourceId) as any;
                check(row && row.source_digest===stamp.sourceDigest && row.simulation_time===stamp.simulationTime && row.wall_time===stamp.wallTime
                    && row.profile_digest===stamp.profileDigest && row.sequence===stamp.sequence && row.clock_status===stamp.status
                    && row.clock_revision===stamp.revision && row.engine_tick===stamp.engineTick,'Long experiment native clock backing differs');}
        });
    }
    function clock<T>(callback:(store:SimulationClockStore,id:string)=>T){
        check(existsSync(paths.clockPath),'Existing world clock required; no clock is created');
        readDatabase(paths.clockPath,db=>check((db.query('PRAGMA user_version').get() as any).user_version===SIMULATION_CLOCK_STORE_SCHEMA_VERSION,'Unsupported native clock'));
        const config=loadSimulationClockRuntimeConfig(join(paths.configDirectory,'simulation-clock.json')),store=new SimulationClockStore(paths.clockPath);
        try{const state=store.get(config.clockId);check(state && state.profileDigest===simulationClockProfileDigest(config.profile),'Configured native clock differs');return callback(store,config.clockId);}finally{store.close();}
    }
    return {
        binding:plan=>readLongExperimentBinding(plan,paths),
        preflight:async input=>client('/api/admin/multi-agent-experiments/preflight',{...input,reason:'Controlled long experiment preflight.'}),
        environmentDigest:async()=>validateMultiAgentExperimentEnvironment(await client('/api/admin/multi-agent-experiments/environment')).digest,
        getWave:id=>{if(!existsSync(experimentPath))return null;const store=new MultiAgentExperimentStore(experimentPath,true);
            try{return store.get(id);}finally{store.close();}},
        startWave:async(claim,definition)=>client('/api/admin/multi-agent-experiments',{...claim.input,experimentId:claim.experimentId,
            expectedInitialStateDigest:claim.expectedInitialStateDigest,expectedEnvironmentDigest:definition.environmentDigest,
            ...(claim.index===0 && definition.xpInitialState?{expectedXpCohortDigest:definition.xpInitialState.cohortDigest}:{}),
            expectedParameterProfileDigest:definition.plan.parameterProfileDigest,reason:`Bounded long experiment ${definition.plan.sessionId}, wave ${claim.index}.`}),
        observe:()=>clock((store,id)=>contemporaneous(store,id,wallTime=>store.observe(id,wallTime))),
        bind:(sourceId,event)=>clock((store,id)=>contemporaneous(store,id,wallTime=>store.bindEvent({clockId:id,domain:'society-long-run',sourceId,
            sourceDigest:digest({...event,wallTime,stamp:null}),wallTime}).stamp)),
        verifyStamp:stamp=>verifyStamps([stamp]),verifyStamps,
        verifyXpExecution:report=>{const native=readXpExecutionSource(report.binding.request.experimentId,xpExecutionPath);check(native && native.digest===report.digest,'Native XP execution backing differs');},
        verifyXpExecutions:reports=>{const native=readXpExecutionSources(reports.map(report=>report.binding.request.experimentId),xpExecutionPath);
            for(const report of reports)check(native.get(report.binding.request.experimentId)?.digest===report.digest,'Native XP execution backing differs');},
        getWaves:ids=>{if(!existsSync(experimentPath))return new Map(ids.map(id=>[id,null]));const store=new MultiAgentExperimentStore(experimentPath,true);
            try{return new Map(ids.map(id=>[id,store.get(id)]));}finally{store.close();}},
        wallNow:()=>new Date().toISOString()
    };
}
/** Read only; HTTP cannot choose source paths, advance time or submit evidence. */
export function readLongExperimentReport(id:string,journalPath=longExperimentJournalPath,deps=nativeLongExperimentDependencies()){
    if(!existsSync(journalPath))return {status:'unavailable',reason:'No long experiment journal exists.'};
    const store=new LongExperimentStore(journalPath,true);
    try{const state=store.get(id);if(!state)return {status:'unavailable',reason:'Long experiment not found.'};
        verifyLongExperimentBacking(state,deps);return reportLongExperiment(state);}finally{store.close();}
}
export interface LongComparisonOptions {
    controlJournalPath?:string; treatmentJournalPath?:string;
    controlDependencies?:LongExperimentDependencies; treatmentDependencies?:LongExperimentDependencies;
}
/** Native readonly sources only. Separate paths permit archived/isolated worlds; HTTP never selects them. */
export function readLongExperimentComparison(raw:unknown,options:LongComparisonOptions={}){
    const request=validateLongComparisonRequest(raw);
    const load=(id:string,path:string)=>{
        if(!existsSync(path))return null;
        const store=new LongExperimentStore(path,true);try{return store.get(id);}finally{store.close();}
    };
    const control=load(request.controlSessionId,options.controlJournalPath??longExperimentJournalPath),
        treatment=load(request.treatmentSessionId,options.treatmentJournalPath??options.controlJournalPath??longExperimentJournalPath);
    if(!control || !treatment)return {status:'unavailable',request,reason:'Both native long program journals are required.',
        capabilities:LONG_COMPARISON_CAPABILITIES};
    const cdeps=options.controlDependencies??nativeLongExperimentDependencies(),tdeps=options.treatmentDependencies??cdeps;
    // Unsupported axes must not expose unverified journal references either.
    if(request.axis!=='diminishing-xp'){
        verifyLongExperimentBacking(control,cdeps);verifyLongExperimentBacking(treatment,tdeps);
    }
    return compareLongExperiments(request,{state:control,deps:cdeps},{state:treatment,deps:tdeps});
}
