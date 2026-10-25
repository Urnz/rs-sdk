import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash,type NativeToolOwner } from './native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { MiningInteractionRequest } from '../sdk/mining-interaction.js';
import { miningDispatchId } from '../agent-skills/mining-interaction-source.js';
import { miningDemandId } from '../agent-skills/mining-admission.js';
import { miningRequestDigest } from '../agent-skills/mining-demand-source.js';
import type { NativeMiningIntent } from './native-mining-intent.js';
export interface NativeMiningDispatch {schemaVersion:1;dispatchId:string;demandId:string;owner:NativeToolOwner;sourceDigest:string;level:number;
    request:MiningInteractionRequest;clock:SimulationClockObservation}
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
function validate(r:NativeMiningDispatch){
    check(r?.schemaVersion===1&&miningDispatchId(r.request)===r.dispatchId&&miningDemandId(r.request.demand)===r.demandId
        &&/^[a-f0-9]{64}$/.test(r.sourceDigest)&&Number.isSafeInteger(r.level)&&r.level>=0&&r.level<=3,'Invalid native Mining dispatch');
    const o=r.owner,c=r.clock;check(o&&Object.keys(o).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'
        &&Object.values(o).every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&/^[a-z0-9]{1,12}$/.test(o.username),'Invalid Mining dispatch owner');
    check(c&&c.status==='running'&&c.clockId===o.clockId&&c.profileDigest===o.clockProfileDigest&&/^[a-f0-9]{64}$/.test(c.profileDigest)
        &&Number.isSafeInteger(c.revision)&&c.revision>=0&&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0
        &&Number.isFinite(Date.parse(c.simulationTime))&&Number.isFinite(Date.parse(c.wallTime)),'Invalid Mining dispatch clock');
}
/** Immutable once-only admission before native execution. It is not a completion receipt. */
export class NativeMiningDispatchStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_mining_dispatch_schema'").get();}
    constructor(readonly db:Database,initialize=false){
        if(initialize)db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_mining_dispatch_schema(version INTEGER PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS native_mining_dispatch(dispatch_id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS native_mining_dispatch_no_update BEFORE UPDATE ON native_mining_dispatch BEGIN SELECT RAISE(ABORT,'Mining dispatch is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_dispatch_no_delete BEFORE DELETE ON native_mining_dispatch BEGIN SELECT RAISE(ABORT,'Mining dispatch is immutable'); END;`);
            if(!db.query('SELECT 1 FROM native_mining_dispatch_schema').get()){
                check(!db.query('SELECT 1 FROM native_mining_dispatch').get(),'Unversioned Mining dispatch data');db.run('INSERT INTO native_mining_dispatch_schema VALUES(1)');
            }this.version();
        }).immediate();else this.version();
    }
    private version(){const rows=this.db.query<{version:number},[]>('SELECT version FROM native_mining_dispatch_schema').all();
        check(rows.length===1&&rows[0]!.version===1,'Unsupported native Mining dispatch schema');}
    get(id:string){const row=this.db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_mining_dispatch WHERE dispatch_id=?').get(id);
        if(!row)return null;const r=JSON.parse(row.payload) as NativeMiningDispatch;validate(r);
        check(hash(r)===row.digest&&r.dispatchId===id,'Mining dispatch proof differs');return r;}
    admit(r:NativeMiningDispatch){validate(r);this.db.transaction(()=>{
        check(!this.get(r.dispatchId),'Mining dispatch already consumed');this.db.run('INSERT INTO native_mining_dispatch VALUES(?,?,?)',[r.dispatchId,JSON.stringify(r),hash(r)]);
    }).immediate();}
    read(){this.version();check((this.db.query('SELECT COUNT(*) n FROM native_mining_dispatch').get() as {n:number}).n<=100000,'Mining dispatch source exceeds row limit');
        return this.db.query<{dispatch_id:string},[]>('SELECT dispatch_id FROM native_mining_dispatch ORDER BY dispatch_id').all().map(row=>this.get(row.dispatch_id)!);}
}
export function requireNativeMiningDispatchProof(db:Database,intent:NativeMiningIntent,actionId:string,proof:{nativeMiningDispatchId?:string;source:{type:number;x:number;z:number;level:number};outputItemId:number;owner:NativeToolOwner}){
    const record=new NativeMiningDispatchStore(db).get(actionId),t=record?.request.target;
    check(record&&proof.nativeMiningDispatchId===actionId&&record.demandId===intent.demandId&&hash(record.owner)===hash(intent.owner)
        &&hash(proof.owner)===hash(intent.owner)&&miningRequestDigest(record.request.demand)===intent.contextDigest
        &&t&&t.x===proof.source.x&&t.z===proof.source.z&&t.locId===proof.source.type&&record.level===proof.source.level&&proof.outputItemId===intent.outputItemId,
        'Native Mining output lacks its exact executor dispatch');return record;
}
