import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { digest, time } from '../external-trade/policy.js';
import type {XpStateSnapshot} from './xp-state.js';
import { check } from '../external-trade/source.js';
import { validateLongExperimentPlan, type LongExperimentPlan } from './plan.js';
import type { LongExperimentBinding } from './source.js';
import type { BoundSimulationEventStamp } from '../simulation-clock/types.js';
import type { MultiAgentExperimentInput } from '../server/gateway/admin/multi-agent-experiments.js';

export interface LongDefinition { plan: LongExperimentPlan; binding: LongExperimentBinding; initialStateDigest: string; environmentDigest: string;xpInitialState?:XpStateSnapshot }
export interface WaveClaim { index: number; experimentId: string; input: MultiAgentExperimentInput; expectedInitialStateDigest?: string }
export type LongEvent = { kind: 'started'|'observed'|'claimed'|'settled'|'completed'|'failed'|'stopped'; wallTime: string; definitionDigest: string;
    stamp: BoundSimulationEventStamp | null; wave?: WaveClaim; receipt?: { experimentId: string; digest: string; status: string;
        startedAt: string; finishedAt: string; terminalRunIds: string[] }; error?: string; unresolvedIntegrity?:boolean };
export class LongExperimentStore {
    private readonly db: Database;
    constructor(path: string, readonly readOnly = false) {
        if (!readOnly) mkdirSync(dirname(path),{recursive:true});
        this.db = new Database(path,readOnly?{readonly:true,strict:true}:{create:true,strict:true});
        try {
            const version = (this.db.query('PRAGMA user_version').get() as any).user_version;
            check(readOnly ? version===1 : version===0 || version===1,'Unsupported long experiment journal schema');
            if (!readOnly && version===0) this.db.transaction(()=>{
                this.db.run(`CREATE TABLE long_experiment_run(id TEXT PRIMARY KEY,definition TEXT NOT NULL,definition_digest TEXT NOT NULL,
                    sequence INTEGER NOT NULL,head_hash TEXT NOT NULL)`);
                this.db.run(`CREATE TABLE long_experiment_event(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL,
                    previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL,PRIMARY KEY(run_id,sequence),FOREIGN KEY(run_id) REFERENCES long_experiment_run(id))`);
                this.db.run('CREATE TABLE long_experiment_lock(clock_id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE)');
                this.db.run('PRAGMA user_version=1');
            }).immediate();
        } catch(error){this.close();throw error;}
    }
    close(){(this.db as Database & {clearQueryCache():void}).clearQueryCache();this.db.close(true);}
    get(id:string){
        let state!:ReturnType<LongExperimentStore['readState']>;
        this.db.transaction(()=>{state=this.readState(id);})();return state;
    }
    private readState(id: string) {
        const row = this.db.query('SELECT * FROM long_experiment_run WHERE id=?1').get(id) as any;
        if(!row)return null;
        const definition = JSON.parse(row.definition) as LongDefinition;
        check(digest(definition)===row.definition_digest && definition.plan.sessionId===id,'Long experiment definition differs');
        validateLongExperimentPlan(definition.plan);
        const events = this.db.query('SELECT * FROM long_experiment_event WHERE run_id=?1 ORDER BY sequence').all(id) as any[];
        check(events.length<=200000,'Long experiment journal exceeds limits');
        let previous = row.definition_digest, status: 'running'|'completed'|'failed'|'stopped' = 'running', active: (WaveClaim & {stamp:BoundSimulationEventStamp})|null=null;
        let nextWave=0, lastStamp:BoundSimulationEventStamp|null=null, started:BoundSimulationEventStamp|null=null;
        const settled: Array<{claim:WaveClaim & {stamp:BoundSimulationEventStamp};event:LongEvent}> = [];
        const history: LongEvent[] = [];
        for (const [index,event] of events.entries()) {
            const payload = JSON.parse(event.payload) as LongEvent; time(payload.wallTime);
            check(event.sequence===index+1 && event.previous_hash===previous
                && event.entry_hash===digest({runId:id,sequence:event.sequence,payload,previousHash:previous}), 'Long experiment audit chain differs');
            check(payload.definitionDigest===row.definition_digest && (index===0 ? payload.kind==='started' : payload.kind!=='started' && status==='running'),'Invalid long experiment transition');
            if(payload.stamp){
                const stamp=payload.stamp; time(stamp.simulationTime);
                check(stamp.domain==='society-long-run' && stamp.sourceId===`${id}:${index+1}` && stamp.clockId===definition.binding.genesis.simulationClock.clockId
                    && stamp.profileDigest===definition.binding.genesis.simulationClock.profileDigest && stamp.wallTime===payload.wallTime
                    && stamp.sourceDigest===digest({...payload,stamp:null})
                    && (!lastStamp || Date.parse(stamp.simulationTime)>=Date.parse(lastStamp.simulationTime)), 'Long experiment clock binding differs');
                lastStamp=stamp;
            } else check(payload.kind==='failed'||payload.kind==='stopped','Long experiment event lacks clock evidence');
            if(payload.kind==='started')started=payload.stamp;
            else if(payload.kind==='claimed') {check(!active && payload.wave?.index===nextWave && payload.stamp,'Overlapping or unordered cohort wave');active={...payload.wave!,stamp:payload.stamp!};nextWave++;}
            else if(payload.kind==='settled') {check(active && payload.receipt?.experimentId===active.experimentId,'Wrong wave settlement');settled.push({claim:active!,event:payload});active=null;}
            else if(payload.kind==='completed'){check(!active,'Cannot finish with an unresolved wave');status='completed';}
            else if(payload.kind==='failed')status='failed'; else if(payload.kind==='stopped')status='stopped';
            history.push(payload); previous=event.entry_hash;
        }
        check(events.length>0 && row.sequence===events.length && row.head_hash===previous && started && lastStamp,'Long experiment tail differs');
        const lock=this.db.query('SELECT run_id FROM long_experiment_lock WHERE clock_id=?1').get(definition.binding.genesis.simulationClock.clockId) as any;
        check(status==='running'?lock?.run_id===id:lock?.run_id!==id,'Long experiment active lock differs');
        return {definition,definitionDigest:row.definition_digest as string,sequence:row.sequence as number,headHash:previous,status,active,nextWave,
            started:started!,lastStamp:lastStamp!,settled,history};
    }
    create(definition:LongDefinition, event:LongEvent){
        check(!this.readOnly,'Read-only long experiment journal');validateLongExperimentPlan(definition.plan);
        let result!:LongState;
        this.db.transaction(()=>{
            const existing=this.get(definition.plan.sessionId);
            if(existing){check(existing.definitionDigest===digest(definition),'Long experiment id is already bound');result=existing;return;}
            const hash=digest(definition),id=definition.plan.sessionId;
            check(!this.db.query('SELECT 1 FROM long_experiment_lock WHERE clock_id=?1').get(definition.binding.genesis.simulationClock.clockId),'Another long experiment owns this world clock');
            this.db.run('INSERT INTO long_experiment_run VALUES(?1,?2,?3,0,?3)',[id,JSON.stringify(definition),hash]);
            this.db.run('INSERT INTO long_experiment_lock VALUES(?1,?2)',[definition.binding.genesis.simulationClock.clockId,id]);
            this.write(id,0,hash,event);result=this.get(id)!;
        }).immediate();return result;
    }
    append(id:string,expectedSequence:number,event:LongEvent){
        check(!this.readOnly,'Read-only long experiment journal');
        let result!:LongState;
        this.db.transaction(()=>{
            const state=this.get(id);check(state && state.sequence===expectedSequence && state.status==='running','Long experiment changed or terminal');
            this.write(id,expectedSequence,state.headHash,event);result=this.get(id)!;
        }).immediate();return result;
    }
    private write(id:string,sequence:number,previousHash:string,payload:LongEvent){
        const next=sequence+1,hash=digest({runId:id,sequence:next,payload,previousHash});
        this.db.run('INSERT INTO long_experiment_event VALUES(?1,?2,?3,?4,?5)',[id,next,JSON.stringify(payload),previousHash,hash]);
        check(this.db.run('UPDATE long_experiment_run SET sequence=?2,head_hash=?3 WHERE id=?1 AND sequence=?4',[id,next,hash,sequence]).changes===1,'Journal head changed');
        if(['completed','failed','stopped'].includes(payload.kind))this.db.run('DELETE FROM long_experiment_lock WHERE run_id=?1',[id]);
    }
}
export type LongState = NonNullable<ReturnType<LongExperimentStore['get']>>;
