import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync,readFileSync,statSync } from 'node:fs';
import { resolve,sep } from 'node:path';
import type { Database } from 'bun:sqlite';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { managedContext } from '../server/control-plane/instance-context.js';
import { nativeToolDigest as digest } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { PolicyMutationStore } from './policy-mutations.js';
import type { PolicyMutationProducer } from './policy-environment.js';
import {policyProcessSessionId} from './policy-process.js';

export interface PolicyMutationPorts {db:Database;worldId:string;workspace?:string;sessionId?:string;clock():SimulationClockObservation|null;wallTime():string;close?():void}
const overrides=new AsyncLocalStorage<PolicyMutationPorts>();
/** Backend/fixture capability only; no HTTP, model or packet endpoint can select a mutation store or clock. */
export const withPolicyMutationObservation=<T>(ports:PolicyMutationPorts,run:()=>T):T=>overrides.run(ports,run);
export const policyMutationWorkspace=(workspace:string)=>overrides.getStore()?.workspace??workspace;
export const policyMutationJournalPath=(workspace:string)=>resolve(workspace,'.local/society-metrics/policy-mutations.sqlite');
export function policyValueDigest(value:unknown){try{return digest(value);}catch{return null;}}
export function policyMutationFileDigest(path:string){try{if(statSync(path).size>8*1024*1024)return null;return digest(readFileSync(path).toString('base64'));}
    catch(error){return(error as NodeJS.ErrnoException).code==='ENOENT'?digest(null):null;}}
function close(p:PolicyMutationPorts){try{p.close?.();}catch{try{new PolicyMutationStore(p.db).fault();}catch{ /* An unusable source cannot certify coverage. */ }
    console.error('[PolicyMutations] observer close failed; coverage unavailable');}}
function production(producer:PolicyMutationProducer,resource?:string,workspace?:string):PolicyMutationPorts|null {
    if(!workspace)return null;const root=resolve(workspace)+sep;
    const expected=producer==='mod-configure'||producer==='mod-restore'?resolve(root,'.local/admin/world-mod-state.json')
        :producer==='director-configure'?resolve(root,'.local/admin/world-director.json')
            :producer==='director-event-accept'?resolve(root,'server/engine/data/mods/world-director-events.sqlite'):null;
    if(expected&&(!resource||resolve(resource)!==expected))return null;
    const journal=policyMutationJournalPath(root);if(!existsSync(journal))return null;
    const managed=managedContext();if(managed&&resolve(managed.workspace)!==resolve(root))throw Error('Policy mutation workspace differs');
    const db=new OwnedDatabase(journal,{create:false,strict:true});
    try{if(!PolicyMutationStore.present(db)){db.close(true);return null;}
        return{db,worldId:managed?.id??`local:${digest(root)}`,wallTime:()=>new Date().toISOString(),close:()=>db.close(true),clock(){
            const s=new PolicyMutationStore(db).selection(),path=resolve(root,'.local/simulation/simulation-clock.sqlite');
            if(!existsSync(path))return null;const clock=new OwnedDatabase(path,{readonly:true,strict:true});
            try{const r=clock.query('SELECT clock_id,profile_digest,status,last_observed_wall_ms,last_simulation_ms,revision FROM simulation_clock WHERE clock_id=?').get(s.clockId) as
                {clock_id:string;profile_digest:string;status:'running'|'paused';last_observed_wall_ms:number;last_simulation_ms:number;revision:number}|null;
                return r?{clockId:r.clock_id,profileDigest:r.profile_digest,status:r.status,wallTime:new Date(r.last_observed_wall_ms).toISOString(),
                    simulationTime:new Date(r.last_simulation_ms).toISOString(),revision:r.revision,engineTick:null}:null;
            }finally{clock.close(true);}
        }};
    }catch(error){db.close(true);throw error;}
}
/** Durable begin before mutation, completion afterwards. Observer errors never alter existing mutation/backup/reload behavior. */
export function beginPolicyMutation(producer:PolicyMutationProducer,beforeDigest:string|null,resource?:string,workspace?:string){
    let p:PolicyMutationPorts|null=null;
    try{p=overrides.getStore()??production(producer,resource,workspace);if(!p||!PolicyMutationStore.present(p.db))return;
        const store=new PolicyMutationStore(p.db),ports=p,attemptId=randomUUID();
        const context=()=>{try{const clock=ports.clock();if(!clock)store.fault();return clock;}catch{store.fault();return null;}};
        const begin={attemptId,sessionId:ports.sessionId??policyProcessSessionId,producer,phase:'begin' as const,wallTime:ports.wallTime(),worldId:ports.worldId,clock:context(),beforeDigest,afterDigest:null,outcome:null};
        store.append(begin);let finished=false;
        return{finish(afterDigest:string|null,outcome:'applied'|'no-op'|'failed'){
            if(finished)return;finished=true;
            try{store.append({...begin,phase:'result',wallTime:ports.wallTime(),clock:context(),afterDigest,outcome});}
            catch{try{store.fault();}catch{ /* A failed DB cannot attest mutation coverage. */ }
                console.error('[PolicyMutations] completion unavailable; gap retained');}
            finally{close(ports);}
        }};
    }catch{if(p){try{new PolicyMutationStore(p.db).fault();}catch{ /* No fabricated history. */ }finally{close(p);}}
        console.error('[PolicyMutations] begin unavailable; gap retained');}
}

/** Link the sampled policy frame to a verified prefix of the independently selected mutation journal. */
export function readPolicyMutationCursor(workspace:string){
    const fixture=overrides.getStore();if(fixture){try{return new PolicyMutationStore(fixture.db).cursor();}catch{return null;}}
    const path=policyMutationJournalPath(workspace);if(!existsSync(path))return null;
    let db:OwnedDatabase|undefined;try{db=new OwnedDatabase(path,{readonly:true,strict:true});return new PolicyMutationStore(db).cursor();}
    catch{console.error('[PolicyMutations] cursor unavailable; coverage unknown');return null;}finally{db?.close(true);}
}
