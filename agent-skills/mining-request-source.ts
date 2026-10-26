import { existsSync,mkdirSync,readFileSync,writeFileSync,statSync } from 'node:fs';
import { join,relative,resolve } from 'node:path';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { assertNativeFoodDomainPath,assertNativeFoodPath } from '../food-loop/native-source.js';
import { nativeToolDigest as hash,type NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { NativeMiningRequestStore,type MiningExecutorSelection,type MiningExecutorAdmission } from '../item-lifecycle/native-mining-requests.js';
import type { Database } from 'bun:sqlite';
import { managedContext } from '../server/control-plane/instance-context.js';
const sourcePath=(root:string)=>join(root,'.local/agent-skills/mining-request-source.json');
const failurePath=(root:string)=>join(root,'.local/agent-skills/mining-request-source.failed.json');
function descriptor(root:string){const path=sourcePath(root);if(!existsSync(path))return null;
    assertNativeFoodDomainPath({workspace:root,worldId:managedContext()?.id??'descriptor',checkpointPath:path});if(statSync(path).size>1048576)throw Error('Executor request descriptor limit');
    const value=JSON.parse(readFileSync(path,'utf8')),{digest,...body}=value;
    if(value.schemaVersion!==1||hash(body)!==digest||typeof value.checkpointPath!=='string'||!value.checkpointPath.length||!value.selectionDigest)throw Error('Executor request descriptor differs');return value;
}
function withStore<T>(root:string,read:(store:NativeMiningRequestStore)=>T):T|null{
    const d=descriptor(root);if(!d)return null;const path=resolve(root,d.checkpointPath);
    assertNativeFoodPath({workspace:root,worldId:d.worldId,checkpointPath:path});if(!existsSync(path)||statSync(path).size>256*1024*1024)throw Error('Executor request authority unavailable');
    const db=new OwnedDatabase(path,{strict:true});try{const store=new NativeMiningRequestStore(db);
        if(hash(store.selection())!==d.selectionDigest||store.selection().worldId!==d.worldId)throw Error('Executor request selection differs');return read(store);
    }finally{db.close(true);}
}
/** Explicit offline preparation, before pin/capture. Neither an avatar request nor an automatic live install. */
export function installMiningExecutorSource(root:string,checkpointPath:string,selection:MiningExecutorSelection){
    assertNativeFoodPath({workspace:root,worldId:selection.worldId,checkpointPath});
    if(!existsSync(checkpointPath))throw Error('Executor request checkpoint must already exist');
    const body={schemaVersion:1,worldId:selection.worldId,checkpointPath:relative(resolve(root),resolve(checkpointPath)).replace(/\\/g,'/'),selectionDigest:hash(selection)},value={...body,digest:hash(body)};
    const prior=descriptor(root);if(prior&&hash(prior)!==hash(value))throw Error('Executor request descriptor conflict');
    const db=new OwnedDatabase(checkpointPath,{strict:true});try{new NativeMiningRequestStore(db,selection);}finally{db.close(true);}
    const path=sourcePath(root);assertNativeFoodDomainPath({workspace:root,worldId:selection.worldId,checkpointPath:path});mkdirSync(join(root,'.local/agent-skills'),{recursive:true});
    try{writeFileSync(path,JSON.stringify(value),{encoding:'utf8',flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(hash(descriptor(root))!==hash(value))throw Error('Executor request descriptor publication differs');return value;
}
const id=(a:MiningExecutorAdmission)=>{const h=hash(['native-mining-demand',a.context.runId,a.context.stepId,a.context.operationSequence]);
    return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export function recordMiningExecutorAdmission(root:string,admission:MiningExecutorAdmission,phase:'requested'|'closed'){
    try{return withStore(root,store=>{const owner=store.selection().actors.find(o=>o.username===admission.username);if(!owner)return null;
            if(existsSync(failurePath(root)))throw Error('Executor request producer has a retained write failure');
            store.append({schemaVersion:1,demandId:id(admission),owner,admission,phase});return store.head();});
    }catch(error){try{const path=failurePath(root);assertNativeFoodDomainPath({workspace:root,worldId:managedContext()?.id??'producer-failure',checkpointPath:path});
            writeFileSync(path,JSON.stringify({schemaVersion:1,admissionDigest:admission.digest,phase}),{encoding:'utf8',flag:'wx'});
        }catch{ /* Propagate the original producer failure; never fall back to an in-memory request. */ }throw error;}
}
export function requireMiningExecutorAdmission(root:string,owner:NativeToolOwner,admission:MiningExecutorAdmission){
    return withStore(root,store=>{if(!store.selection().actors.some(a=>a.username===owner.username))return;
        if(existsSync(failurePath(root)))throw Error('Executor request producer has a retained write failure');
        const r=store.current(id(admission)),identity=(o:NativeToolOwner)=>hash(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));
        if(!r||r.phase!=='requested'||identity(r.owner)!==identity(owner)||hash(r.admission)!==hash(admission))throw Error('Missing exact executor request source');
    });
}
/** Tick witness of the actual producer descriptor and selected checkpoint authority. No installation or writable open. */
export function miningExecutorSourceAvailable(root:string,db:Database,selectionDigest:string){
    try{const d=descriptor(root);if(!d||d.selectionDigest!==selectionDigest||existsSync(failurePath(root)))return false;
        const path=resolve(root,d.checkpointPath);assertNativeFoodPath({workspace:root,worldId:d.worldId,checkpointPath:path});
        if(statSync(path).size>256*1024*1024)return false;
        const main=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main');
        return!!main&&resolve(main.file)===path&&hash(new NativeMiningRequestStore(db).selection())===selectionDigest;
    }catch{return false;}
}
