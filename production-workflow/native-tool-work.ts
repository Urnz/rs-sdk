import type { Database } from 'bun:sqlite';
import type { NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { CompetenceSnapshot } from '../character-attributes/types.js';
import type { ItemInstanceState } from '../item-lifecycle/types.js';

export type NativeToolWorkKind = 'smelt' | 'repair';
export interface ToolWorkAccess {digest:string;skill:{id:string;version:string;checksum:string};trialRunId?:string;
    facility:{providerId:string;grantId:string;sourceEvidenceDigest:string}|null}
export interface NativeToolWorkIntent {
    operationId: string; kind: NativeToolWorkKind; owner: NativeToolOwner;
    businessId: string | null; itemInstanceId: string | null; expectedRevision: number | null;
    escrowId: string; policyDigest: string; authorityDigest: string;
    skill: {id:string;version:string;checksum:string}; contextDigest: string;
}
export interface NativeToolWorkRecord {
    schemaVersion: 1; intent: NativeToolWorkIntent; intentDigest: string;
    phase: 'working' | 'paused' | 'completed'; reason: string | null; progressMs: number; workTicks:number; revision: number;
    started: SimulationClockObservation;
    last: {clock:SimulationClockObservation;sessionId:string;valid:boolean};
    competence: CompetenceSnapshot | null; materialDigest: string;
    result: {kind:NativeToolWorkKind;inputItems:{id:number;count:number}[];outputItems:{id:number;count:number}[];
        tool:ItemInstanceState|null;checkpointDigest:string;script:string|null}|null;
}

/** Component-owned service WIP. A repair has capacity output, not a fictitious newly produced item. */
export class NativeToolWorkStore {
    constructor(readonly db: Database) {
        db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_tool_work_schema(version INTEGER PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS native_tool_work(operation_id TEXT PRIMARY KEY,username TEXT NOT NULL,instance_id TEXT,
                    phase TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS native_tool_work_actor ON native_tool_work(username) WHERE phase!='completed';
                CREATE UNIQUE INDEX IF NOT EXISTS native_tool_work_instance ON native_tool_work(instance_id) WHERE phase!='completed';
                CREATE TABLE IF NOT EXISTS native_tool_work_audit(sequence INTEGER PRIMARY KEY,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS native_tool_work_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                CREATE TRIGGER IF NOT EXISTS native_tool_work_audit_no_update BEFORE UPDATE ON native_tool_work_audit
                BEGIN SELECT RAISE(ABORT,'Native tool work history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_tool_work_audit_no_delete BEFORE DELETE ON native_tool_work_audit
                BEGIN SELECT RAISE(ABORT,'Native tool work history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_tool_work_no_delete BEFORE DELETE ON native_tool_work
                BEGIN SELECT RAISE(ABORT,'Native tool work cannot be discarded'); END;`);
            const versions=db.query<{version:number},[]>('SELECT version FROM native_tool_work_schema').all();
            if(!versions.length){db.run('INSERT INTO native_tool_work_schema VALUES(1)');db.run('INSERT INTO native_tool_work_head VALUES(1,0,NULL)');}
            else if(versions.length!==1||versions[0]!.version!==1)throw new Error('Unsupported native tool work schema');
            this.list();
        }).immediate();
    }
    static present(db:Database):boolean{return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_tool_work_schema'").get();}
    static read(db:Database):NativeToolWorkRecord[]{
        const versions=db.query<{version:number},[]>('SELECT version FROM native_tool_work_schema').all();
        if(versions.length!==1||versions[0]!.version!==1)throw new Error('Unsupported native tool work source schema');
        const latest=new Map<string,string>();let digest:string|null=null,sequence=0;
        for(const row of db.query<{sequence:number;payload:string;previous_digest:string|null;digest:string},[]>('SELECT * FROM native_tool_work_audit ORDER BY sequence').all()){
            if(row.sequence!==++sequence||row.previous_digest!==digest||nativeToolDigest({sequence:row.sequence,payload:row.payload,previousDigest:digest})!==row.digest)
                throw new Error('Native tool work audit mismatch');
            const event=JSON.parse(row.payload);latest.set(event.operationId,event.recordDigest);digest=row.digest;
        }
        const head=db.query<{sequence:number;digest:string|null},[]>('SELECT sequence,digest FROM native_tool_work_head WHERE singleton=1').get();
        if(!head||head.sequence!==sequence||head.digest!==digest)throw new Error('Native tool work audit tail mismatch');
        const rows=db.query<{operation_id:string;username:string;instance_id:string|null;phase:string;payload:string;digest:string},[]>('SELECT * FROM native_tool_work').all();
        if(rows.length!==latest.size)throw new Error('Native tool work row missing');
        return rows.map(row=>{const record=JSON.parse(row.payload) as NativeToolWorkRecord;
            if(nativeToolDigest(record)!==row.digest||latest.get(row.operation_id)!==row.digest||record.intent.operationId!==row.operation_id
                ||record.intent.owner.username!==row.username||record.intent.itemInstanceId!==row.instance_id||record.phase!==row.phase
                ||record.schemaVersion!==1||record.intentDigest!==nativeToolDigest(record.intent))throw new Error('Native tool work record mismatch');
            return record;});
    }
    list():NativeToolWorkRecord[]{return NativeToolWorkStore.read(this.db);}
    get(id:string):NativeToolWorkRecord|null{return this.list().find(row=>row.intent.operationId===id)??null;}
    write(record:NativeToolWorkRecord):NativeToolWorkRecord{
        if(!this.db.inTransaction)throw new Error('Native tool work requires its checkpoint transaction');
        const prior=this.get(record.intent.operationId);
        if(record.intentDigest!==nativeToolDigest(record.intent)||record.revision!==(prior?.revision??0)+1
            ||(prior&&(record.intentDigest!==prior.intentDigest||prior.phase==='completed'||record.progressMs<prior.progressMs)))
            throw new Error('Native tool work revision/intent is immutable');
        const digest=nativeToolDigest(record),json=JSON.stringify(record);
        this.db.query(`INSERT INTO native_tool_work VALUES(?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET
            phase=excluded.phase,payload=excluded.payload,digest=excluded.digest`)
            .run(record.intent.operationId,record.intent.owner.username,record.intent.itemInstanceId,record.phase,json,digest);
        const head=this.db.query<{sequence:number;digest:string|null},[]>('SELECT sequence,digest FROM native_tool_work_head WHERE singleton=1').get()!;
        const sequence=head.sequence+1,payload=JSON.stringify({operationId:record.intent.operationId,revision:record.revision,
            phase:record.phase,progressMs:record.progressMs,last:record.last,recordDigest:digest});
        const next=nativeToolDigest({sequence,payload,previousDigest:head.digest});
        this.db.query('INSERT INTO native_tool_work_audit VALUES(?,?,?,?)').run(sequence,payload,head.digest,next);
        this.db.query('UPDATE native_tool_work_head SET sequence=?,digest=? WHERE singleton=1').run(sequence,next);
        return record;
    }
}
