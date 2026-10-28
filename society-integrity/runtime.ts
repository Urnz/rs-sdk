import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import { Database } from 'bun:sqlite';
import { openSimulationClockRuntime } from '../simulation-clock/config.js';
import { SocietyIntegrityStore, type IntegrityMutation, type IntegrityStamp, type IntegrityCompensation } from './store.js';

const root = new URL('../',import.meta.url);
const path = (relative:string)=>fileURLToPath(new URL(relative,root));
export const societyIntegrityDbPath = path('.local/simulation/society-integrity.sqlite');
export const societyIntegrityPolicyPath = path('config/society-integrity-policy.json');
export const nativeSocietyValuePaths={treasury:path('.local/economy/institution-treasury.sqlite'),
    business:path('.local/economy/businesses.sqlite'),reward:path('server/engine/data/mods/player-action-rewards.sqlite')};
export function nativeSocietyPathMatches(actual:string,expected:string):boolean {
    return resolve(actual).toLowerCase()===resolve(expected).toLowerCase();
}
export function loadSocietyIntegrityPolicy(configPath=societyIntegrityPolicyPath) {
    const value=JSON.parse(readFileSync(configPath,'utf8'));
    if(!value || Object.keys(value).sort().join(',')!=='invalidateOnInjection,policyId,schemaVersion,version'
        || value.schemaVersion!==1 || value.policyId!=='private-society-integrity' || value.version!=='1.0.0'
        || typeof value.invalidateOnInjection!=='boolean')throw new Error('Society integrity policy is invalid');
    return value as {schemaVersion:1;policyId:string;version:string;invalidateOnInjection:boolean};
}
function observe():IntegrityStamp {
    const clockPath=path('.local/simulation/simulation-clock.sqlite');
    if(!existsSync(clockPath))throw new Error('Society intervention requires the real SimulationClock');
    const shared=openSimulationClockRuntime(path('config/simulation-clock.json'),clockPath);
    try {
        const state=shared.store.get(shared.clockId)!;
        const wallTime=new Date(Math.max(Date.now(),Date.parse(state.lastObservedWallTime))).toISOString();
        const observed=shared.store.observe(shared.clockId,wallTime);
        return {clockId:observed.clockId,profileDigest:observed.profileDigest,simulationTime:observed.simulationTime,wallTime};
    } finally {shared.store.close();}
}
export interface IntegrityBoundary { path:string; observe():IntegrityStamp }
const boundaryOverrides=new AsyncLocalStorage<IntegrityBoundary>();
/** Internal synchronous fixture/backend scope only; no model, packet or HTTP endpoint accepts this capability. */
export function withSocietyIntegrityBoundary<T>(boundary:IntegrityBoundary,run:()=>T):T{return boundaryOverrides.run(boundary,run);}
export function observeLegacySocietyRun(journalPath:string,runPath:string,stamp:()=>IntegrityStamp,invalidateOnInjection:boolean) {
    if(!existsSync(runPath))return;
    const source=new Database(runPath,{readonly:true,strict:true});
    let results:Array<import('../world-genesis/types.js').WorldGenesisResult>;
    try {
        results=(source.query("SELECT result_json FROM world_genesis_application WHERE status='applied' AND receipt_json IS NOT NULL")
            .all() as {result_json:string}[]).map(row=>JSON.parse(row.result_json))
            .filter(result=>['mature-society','historical-burn-in'].includes(result.profile.profileId));
    }finally{(source as Database & {clearQueryCache():void}).clearQueryCache();source.close(true);}
    if(!results.length)return;
    const store=new SocietyIntegrityStore(journalPath);
    try {
        store.verify();if(store.active().length)return;
        const unseen=results.filter(result=>!store.get(result.resultId));
        if(unseen.length>1)throw new Error('Legacy society world has conflicting applied genesis runs');
        if(!unseen.length)return;
        const observed=stamp(),result=unseen[0]!;
        if(result.simulationClock.clockId!==observed.clockId || result.simulationClock.profileDigest!==observed.profileDigest)
            throw new Error('Legacy society clock binding conflicts');
        store.begin(result,invalidateOnInjection);store.recordCoverageGap(result.resultId,observed);store.finishBootstrap(result.resultId);
    }finally{store.close();}
}
export function initializeNativeSocietyObserver() {
    observeLegacySocietyRun(societyIntegrityDbPath,path('.local/simulation/world-genesis-runs.sqlite'),observe,loadSocietyIntegrityPolicy().invalidateOnInjection);
}
/** Legacy runs retain an explicit coverage gap. Errors leave a pending operation. */
export function withSocietyValueMutation<T>(input:IntegrityMutation,mutate:()=>T,
    boundary:IntegrityBoundary|false=boundaryOverrides.getStore()??{path:societyIntegrityDbPath,observe},changed:(result:T)=>boolean=()=>true,
    compensated:()=>IntegrityCompensation|null=()=>null):T {
    if(boundary===false)return mutate();
    const native=boundary.path===societyIntegrityDbPath && boundary.observe===observe;
    if(native && input.source.startsWith('engine.') && !nativeSocietyPathMatches(process.cwd(),path('server/engine/')))return mutate();
    if(native)initializeNativeSocietyObserver();
    if(!existsSync(boundary.path))return mutate();
    const store=new SocietyIntegrityStore(boundary.path);
    try {
        store.verify();
        if(!store.active().length)return mutate();
        const affected=store.before(input,boundary.observe());
        let result:T;
        try{result=mutate();}catch(error){const proof=compensated();if(proof)store.compensateTransfer(input,proof);throw error;}
        if(result && typeof (result as {then?:unknown}).then==='function')throw new Error('Society value boundaries must be synchronous');
        store.committed(affected,input.operationId,changed(result),typeof result==='number'?result:null); return result;
    } finally {store.close();}
}
export function authorizeSocietyBootstrap(runId:string,mutation:IntegrityMutation,location=societyIntegrityDbPath) {
    if(!existsSync(location))return;
    const store=new SocietyIntegrityStore(location);
    try {if(store.get(runId))store.authorize(runId,mutation);}finally{store.close();}
}
