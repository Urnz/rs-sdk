import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {managedContext} from '../server/control-plane/instance-context.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';
import {PolicyMutationStore} from './policy-mutations.js';
import {validatePolicyEnvironment,worldPolicyMutationProducers,type PolicyEnvironmentPin} from './policy-environment.js';
import {beginPolicyMutation,policyMutationWorkspace} from './policy-mutation-observer.js';
import {policyProcessSessionId} from './policy-process.js';
import type {SimulationClockObservation} from '../simulation-clock/types.js';

export type PolicyRuntimeRole='engine'|'gateway';
const publicPolicyInputs={engine:['EASY_STARTUP','ENGINE_REVISION','NODE_ID','NODE_MEMBERS','NODE_AUTO_SUBSCRIBE_MEMBERS','NODE_XPRATE','NODE_PRODUCTION',
    'NODE_MINIMUM_WEALTH_VALUE_EVENT','NODE_DEBUG','NODE_DEBUG_PROFILE','NODE_CLIENT_ROUTEFINDER','NODE_PROFILE','NODE_MAX_CONNECTED','NODE_DEBUGPROC_CHAR',
    'NODE_HOP_TIME','NODE_MAX_NPCS','NODE_RATELIMIT_ADDRESS_LOGIN','NODE_RATELIMIT_DEVICE_LOGIN','NODE_MAX_MESSAGE_LENGTH','NODE_OBJ_REVEAL_TICKS',
    'NODE_OBJ_DESPAWN_SCALE','NODE_SHOP_ECONOMY_MODE','BUILD_STARTUP','BUILD_VERIFY','BUILD_VERIFY_FOLDER','BUILD_VERIFY_PACK','BUILD_LIVE_RELOAD','BUILD_SRC_DIR'],
    gateway:['TRADE_EVIDENCE_DB']} as const;
export const worldPolicyWriters=[...worldPolicyMutationProducers,
    {id:'clock-pause',path:'simulation-clock/store.ts',entry:'SimulationClockStore.pause',effect:'monotonic-clock-revision'},
    {id:'clock-resume',path:'simulation-clock/store.ts',entry:'SimulationClockStore.resume',effect:'monotonic-clock-revision'},
    {id:'clock-profile',path:'simulation-clock/store.ts',entry:'SimulationClockStore.reconfigure',effect:'monotonic-clock-revision'}];
const requiredSources=['package.json','bun.lock','server/engine/bun.lock','server/gateway/bun.lock','server/engine/src/app.ts','server/gateway/gateway.ts',
    'population-lifecycle/world-policy-runtime.ts','simulation-clock/store.ts'];
export interface WorldPolicyRuntimeContract {schemaVersion:1;environmentDigest:string;writerRegistryDigest:string;inputRegistryDigest:string;
    inputs:Record<PolicyRuntimeRole,string>;trust:'immutable-pinned-application-inputs';roles:['engine','gateway']}
function check(v:unknown,m='World policy runtime source differs'):asserts v {if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function pinnedPath(root:string,path:string){let target=resolve(root);for(const part of path.split('/')){target=resolve(target,part);check(!lstatSync(target).isSymbolicLink());}return target;}
/** Whitelist only; never read/export API keys, full environment or .env files. */
export function policyRuntimeInputs(environment:PolicyEnvironmentPin,role:PolicyRuntimeRole,values:Record<string,string|undefined>){
    return hash([...new Set([...environment.inputRegistry.filter(i=>i.role===role).map(i=>i.key),...publicPolicyInputs[role]])].sort().map(key=>({key,value:values[key]??null})));}
export function createWorldPolicyRuntimeContract(environment:PolicyEnvironmentPin,values:Record<PolicyRuntimeRole,Record<string,string|undefined>>):WorldPolicyRuntimeContract{
    validatePolicyEnvironment(environment);check(hash(environment.producers)===hash(worldPolicyMutationProducers)&&requiredSources.every(path=>environment.files.some(f=>f.path===path&&f.role==='source')));
    return{schemaVersion:1,environmentDigest:hash(environment),writerRegistryDigest:hash(worldPolicyWriters),inputRegistryDigest:hash(publicPolicyInputs),
        inputs:{engine:policyRuntimeInputs(environment,'engine',values.engine),gateway:policyRuntimeInputs(environment,'gateway',values.gateway)},
        trust:'immutable-pinned-application-inputs',roles:['engine','gateway']};
}
function validateContract(c:WorldPolicyRuntimeContract,environment:PolicyEnvironmentPin){
    check(c?.schemaVersion===1&&c.environmentDigest===hash(environment)&&c.writerRegistryDigest===hash(worldPolicyWriters)&&c.inputRegistryDigest===hash(publicPolicyInputs)
        &&c.trust==='immutable-pinned-application-inputs'&&hash(c.roles)===hash(['engine','gateway'])&&hex(c.inputs?.engine)&&hex(c.inputs?.gateway)
        &&hash(environment.producers)===hash(worldPolicyMutationProducers)
        &&requiredSources.every(path=>environment.files.some(f=>f.path===path&&f.role==='source')));
}
export interface PolicyRuntimeWitness {role:PolicyRuntimeRole;sessionId:string;worldId:string;clock:SimulationClockObservation|null;wallTime:string;
    selectionDigest:string;contractDigest:string;environmentDigest:string;materializedDigest:string|null;inputsDigest:string;bunVersion:string;platform:string;gaps:string[]}
/** Optional own schema inside the already selected mutation journal. Legacy sources are read without initialization/backfill. */
export class WorldPolicyRuntimeStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='world_policy_runtime_contract'").get();}
    constructor(readonly db:Database,contract?:WorldPolicyRuntimeContract){
        const selection=new PolicyMutationStore(db).selection();
        if(!WorldPolicyRuntimeStore.present(db)){
            check(contract,'Explicit world-policy runtime contract required');validateContract(contract,selection.environment);
            check(selection.worldPolicyRuntimeContractDigest===hash(contract));
            db.transaction(()=>{check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('world_policy_runtime_event','world_policy_runtime_head','world_policy_runtime_schema')").get());
                db.exec(`CREATE TABLE world_policy_runtime_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO world_policy_runtime_schema VALUES(1);
                    CREATE TABLE world_policy_runtime_contract(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE world_policy_runtime_event(sequence INTEGER PRIMARY KEY,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                    CREATE TABLE world_policy_runtime_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                    INSERT INTO world_policy_runtime_head VALUES(1,0,NULL);
                    CREATE TRIGGER world_policy_runtime_contract_no_update BEFORE UPDATE ON world_policy_runtime_contract BEGIN SELECT RAISE(ABORT,'World policy contract immutable');END;
                    CREATE TRIGGER world_policy_runtime_contract_no_delete BEFORE DELETE ON world_policy_runtime_contract BEGIN SELECT RAISE(ABORT,'World policy contract immutable');END;
                    CREATE TRIGGER world_policy_runtime_event_no_update BEFORE UPDATE ON world_policy_runtime_event BEGIN SELECT RAISE(ABORT,'World policy runtime immutable');END;
                    CREATE TRIGGER world_policy_runtime_event_no_delete BEFORE DELETE ON world_policy_runtime_event BEGIN SELECT RAISE(ABORT,'World policy runtime immutable');END;`);
                db.run('INSERT INTO world_policy_runtime_contract VALUES(1,?,?)',[JSON.stringify(contract),hash(contract)]);
            }).immediate();
        }
        check((db.query('SELECT version FROM world_policy_runtime_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1');
        if(contract)check(hash(this.contract())===hash(contract));
    }
    contract(){const row=this.db.query('SELECT payload,digest FROM world_policy_runtime_contract WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(row);const contract=JSON.parse(row.payload) as WorldPolicyRuntimeContract,s=new PolicyMutationStore(this.db).selection();
        validateContract(contract,s.environment);check(hash(contract)===row.digest&&s.worldPolicyRuntimeContractDigest===row.digest);return contract;}
    read(){const contract=this.contract();check((this.db.query('SELECT count(*) n FROM world_policy_runtime_event').get() as {n:number}).n<=10000);
        let previous:string|null=null;const entries=(this.db.query('SELECT * FROM world_policy_runtime_event ORDER BY sequence').all() as any[]).map((r,i)=>{
            const witness=JSON.parse(r.payload) as PolicyRuntimeWitness;
            check(r.sequence===i+1&&r.previous_digest===previous&&r.digest===hash({sequence:r.sequence,payload:r.payload,previousDigest:previous})
                &&['engine','gateway'].includes(witness.role)&&typeof witness.sessionId==='string'&&witness.sessionId.length<=128
                &&typeof witness.worldId==='string'&&witness.worldId.length>0&&witness.worldId.length<=256&&stamp(witness.wallTime)
                &&hex(witness.selectionDigest)&&hex(witness.contractDigest)&&hex(witness.environmentDigest)&&hex(witness.inputsDigest)
                &&(witness.materializedDigest===null||hex(witness.materializedDigest))
                &&typeof witness.bunVersion==='string'&&witness.bunVersion.length<=128&&typeof witness.platform==='string'&&witness.platform.length<=128
                &&Array.isArray(witness.gaps)&&witness.gaps.length<=32&&witness.gaps.every(g=>/^[a-z0-9-]{1,96}$/.test(g)));
            const c=witness.clock;if(c)check(typeof c.clockId==='string'&&hex(c.profileDigest)&&stamp(c.simulationTime)&&stamp(c.wallTime)
                &&['running','paused'].includes(c.status)&&Number.isSafeInteger(c.revision)&&c.revision>=0);
            previous=r.digest;return{sequence:r.sequence as number,witness,digest:r.digest as string};});
        const head=this.db.query('SELECT sequence,digest FROM world_policy_runtime_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null;
        check(head&&head.sequence===entries.length&&head.digest===previous);return{contract,entries,head};
    }
    append(witness:PolicyRuntimeWitness){this.db.transaction(()=>{const {head}=this.read(),sequence=head.sequence+1,payload=JSON.stringify(witness),digest=hash({sequence,payload,previousDigest:head.digest});
        this.db.run('INSERT INTO world_policy_runtime_event VALUES(?,?,?,?)',[sequence,payload,head.digest,digest]);
        this.db.run('UPDATE world_policy_runtime_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);this.read();
    }).immediate();}
}
/** Hash the selected immutable archive inputs once at real process startup, not every tick or retrospectively during reporting. */
export function captureWorldPolicyRuntime(root:string,role:PolicyRuntimeRole,db:Database,context:{worldId:string;sessionId:string;clock:SimulationClockObservation|null;
    wallTime:string;env:Record<string,string|undefined>;bunVersion:string;platform:string}):PolicyRuntimeWitness{
    const selection=new PolicyMutationStore(db).selection(),contract=new WorldPolicyRuntimeStore(db).contract(),gaps:string[]=[],files:PolicyEnvironmentPin['files']=[];
    let bytes=0;
    try{for(const pin of selection.environment.files){const path=pinnedPath(root,pin.path);
            const stat=lstatSync(path);bytes+=stat.size;check(stat.isFile()&&stat.size===pin.size&&bytes<=256*1024*1024);
            const actual={...pin,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};check(actual.sha256===pin.sha256);files.push(actual);}}
    catch{gaps.push('pinned-runtime-inputs-unavailable-or-different');}
    const materializedDigest=gaps.length?null:hash(files);
    if(context.bunVersion!==selection.environment.bunVersion||context.platform!==selection.environment.platform)gaps.push('runtime-version-or-platform-different');
    const inputsDigest=policyRuntimeInputs(selection.environment,role,context.env);if(inputsDigest!==contract.inputs[role])gaps.push('runtime-input-values-different');
    if(!context.clock)gaps.push('runtime-clock-unavailable');
    const {env,...runtime}=context;
    return{role,...runtime,selectionDigest:hash(selection),contractDigest:hash(contract),environmentDigest:hash(selection.environment),materializedDigest,inputsDigest,gaps};
}
/** Called only by actual engine/gateway startup. Explicitly unselected/legacy worlds remain untouched. */
export function recordWorldPolicyRuntime(role:PolicyRuntimeRole,root:string){
    const path=resolve(root,'.local/society-metrics/policy-mutations.sqlite');if(!existsSync(path))return;
    let db:OwnedDatabase|undefined;
    try{db=new OwnedDatabase(path,{create:false,strict:true});if(!WorldPolicyRuntimeStore.present(db))return;
        const s=new PolicyMutationStore(db).selection(),clockPath=resolve(root,'.local/simulation/simulation-clock.sqlite');let clock:SimulationClockObservation|null=null;
        if(existsSync(clockPath)){const source=new OwnedDatabase(clockPath,{readonly:true,strict:true});try{const r=source.query('SELECT * FROM simulation_clock WHERE clock_id=?').get(s.clockId) as any;
            if(r)clock={clockId:r.clock_id,profileDigest:r.profile_digest,status:r.status,revision:r.revision,simulationTime:new Date(r.last_simulation_ms).toISOString(),wallTime:new Date(r.last_observed_wall_ms).toISOString(),engineTick:null};
        }finally{source.close(true);}}
        new WorldPolicyRuntimeStore(db).append(captureWorldPolicyRuntime(root,role,db,{worldId:managedContext()?.id??`local:${hash(resolve(root)+sep)}`,sessionId:policyProcessSessionId,
            clock,wallTime:new Date().toISOString(),env:process.env,bunVersion:process.versions.bun??'not-bun',platform:process.platform}));
    }catch{if(db)try{new PolicyMutationStore(db).fault();}catch{/* Unusable evidence cannot certify a policy gate. */}
        console.error('[WorldPolicyRuntime] startup evidence unavailable; policy coverage remains unknown');}finally{db?.close(true);}
}

const loadedPacked=new Map<string,string|null>();
/** Observe the real World.reload boundary against the last loaded identity, not two equal reads of newly edited files. */
export function observeWorldPackedReload<T>(root:string,run:()=>T):T{
    root=policyMutationWorkspace(root);
    const path=resolve(root,'.local/society-metrics/policy-mutations.sqlite');if(!existsSync(path))return run();
    let selected=false,key='',before:string|null=null,readPacked:(()=>string)|undefined,db:OwnedDatabase|undefined;
    try{db=new OwnedDatabase(path,{readonly:true,strict:true});if(WorldPolicyRuntimeStore.present(db)){
        const selection=new PolicyMutationStore(db).selection();new WorldPolicyRuntimeStore(db).contract();selected=true;key=hash({root:resolve(root),selection:hash(selection)});
        const files=selection.environment.files.filter(f=>f.role==='packed');
        readPacked=()=>{let bytes=0;return hash(files.map(f=>{const target=pinnedPath(root,f.path),stat=lstatSync(target);bytes+=stat.size;check(stat.isFile()&&bytes<=256*1024*1024);
            return{...f,size:stat.size,sha256:createHash('sha256').update(readFileSync(target)).digest('hex')};}));};
        before=loadedPacked.has(key)?loadedPacked.get(key)!:hash(files);
    }}catch{selected=true;}finally{db?.close(true);}
    if(!selected)return run();
    const operation=beginPolicyMutation('world-pack-reload',before,undefined,root);
    try{const value=run();if(value===false){loadedPacked.set(key,null);operation?.finish(null,'failed');return value;}
        let after:string|null=null;try{after=readPacked?.()??null;}catch{/* Unknown partial load never certifies policy continuity. */}
        loadedPacked.set(key,after);operation?.finish(after,after!==null&&before===after?'no-op':'applied');return value;
    }catch(error){loadedPacked.set(key,null);operation?.finish(null,'failed');throw error;}
}
