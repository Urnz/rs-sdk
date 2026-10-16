import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {Database} from 'bun:sqlite';
import {digest,time} from '../../../../external-trade/policy.js';
import {check} from '../../../../external-trade/source.js';
import {validateXpStateSnapshot,type XpStateSnapshot} from '../../../../society-experiments/xp-state.js';
import {buildXpExecutionReport,validateXpExecutionArm,xpExecutionEntryHash,type XpExecutionArmRequest,
    type XpExecutionBinding,type XpExecutionEvent,type XpExecutionEntry,type XpExecutionReport} from '../../../../society-experiments/xp-execution.js';

/** A prepared first calculation is persisted before running any XP policy. A crash leaves explicit uncertainty. */
export class XpExecutionStore {
    private readonly db:Database;
    constructor(path:string,private readonly readOnly=false,private readonly now=()=>new Date().toISOString()){
        if(!readOnly)mkdirSync(dirname(path),{recursive:true});
        this.db=new Database(path,readOnly?{readonly:true,strict:true}:{create:true,strict:true});
        try{
            const version=(this.db.query('PRAGMA user_version').get() as any).user_version;
            check(readOnly?version===1:version===0||version===1,'Unsupported XP execution schema');
            if(!readOnly){this.db.run('PRAGMA journal_mode=WAL');this.db.run('PRAGMA synchronous=FULL');}
            if(!readOnly && version===0)this.db.transaction(()=>{
                this.db.run('CREATE TABLE xp_execution_run(id TEXT PRIMARY KEY,binding TEXT NOT NULL,binding_digest TEXT NOT NULL,sequence INTEGER NOT NULL,head_hash TEXT NOT NULL,sealed INTEGER NOT NULL)');
                this.db.run('CREATE TABLE xp_execution_event(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL,PRIMARY KEY(run_id,sequence))');
                this.db.run('CREATE TABLE xp_execution_player(username TEXT PRIMARY KEY,run_id TEXT NOT NULL)');
                this.db.run('PRAGMA user_version=1');
            }).immediate();
        }catch(error){this.close();throw error;}
    }
    close(){(this.db as Database&{clearQueryCache():void}).clearQueryCache();this.db.close(true);}
    get(id:string):XpExecutionReport|null{return this.db.transaction(()=>{
        const row=this.db.query('SELECT * FROM xp_execution_run WHERE id=?1').get(id) as any;if(!row)return null;
        const binding=JSON.parse(row.binding) as XpExecutionBinding;
        check(binding.request.experimentId===id && digest(binding)===row.binding_digest,'XP execution definition differs');
        const entries=(this.db.query('SELECT * FROM xp_execution_event WHERE run_id=?1 ORDER BY sequence').all(id) as any[])
            .map(entry=>({sequence:entry.sequence,payload:JSON.parse(entry.payload),previousHash:entry.previous_hash,hash:entry.entry_hash}));
        const report=buildXpExecutionReport(binding,entries,row.sequence,row.head_hash);
        check(report.sealed===Boolean(row.sealed),'XP execution seal differs');
        const owners=this.db.query('SELECT username FROM xp_execution_player WHERE run_id=?1 ORDER BY username').all(id) as {username:string}[];
        check(digest(owners.map(row=>row.username))===digest(report.sealed?[]:binding.request.cohort),'XP execution cohort ownership differs');
        return report;
    })();}
    arm(raw:XpExecutionArmRequest,snapshot:XpStateSnapshot,policyDigest:string):XpExecutionReport{
        check(!this.readOnly,'Read-only XP execution journal');const request=validateXpExecutionArm(raw);
        let result!:XpExecutionReport;this.db.transaction(()=>{
            const existing=this.get(request.experimentId);
            if(existing){check(digest(existing.binding.request)===digest(request),'XP experiment identity conflict');result=existing;return;}
            const checked=validateXpStateSnapshot(snapshot,request.cohort);
            check(checked.cohortDigest===request.expectedCohortDigest && policyDigest===request.expectedPolicyDigest,'XP execution preflight changed');
            const binding={request,snapshot:checked,policyDigest},hash=digest(binding);
            this.db.run('INSERT INTO xp_execution_run VALUES(?1,?2,?3,0,?3,0)',[request.experimentId,JSON.stringify(binding),hash]);
            for(const username of request.cohort)this.db.run('INSERT INTO xp_execution_player VALUES(?1,?2)',[username,request.experimentId]);
            this.append(request.experimentId,{kind:'armed',at:snapshot.observedAt});result=this.get(request.experimentId)!;
        }).immediate();return result;
    }
    seal(id:string,at=this.now()):XpExecutionReport{
        check(!this.readOnly,'Read-only XP execution journal');let result!:XpExecutionReport;this.db.transaction(()=>{
            const report=this.get(id);check(report,'XP execution experiment not found');if(report.sealed){result=report;return;}
            this.append(id,{kind:'sealed',at:time(at)});this.db.run('UPDATE xp_execution_run SET sealed=1 WHERE id=?1',[id]);
            this.db.run('DELETE FROM xp_execution_player WHERE run_id=?1',[id]);result=this.get(id)!;
        }).immediate();return result;
    }
    observe(player:string,skill:string,context:NonNullable<XpExecutionEvent['context']>,inputXp:number,policyDigest:string,
        capture:()=>XpStateSnapshot,execute:(strict:boolean)=>number){
        check(!this.readOnly,'Read-only XP execution journal');
        const owner=this.db.query('SELECT run_id FROM xp_execution_player WHERE username=?1').get(player) as {run_id:string}|null;
        if(!owner)return execute(false);
        const report=this.get(owner.run_id)!,member=report.members.find(row=>row.username===player)!;
        if(member.status==='observed')return execute(false);
        if(member.status!=='unobserved')return 0;
        let prepared=false;
        try{
            const before=validateXpStateSnapshot(capture(),[player],report.binding.snapshot.configurationDigest);
            check(policyDigest===report.binding.policyDigest && digest(before.players[player])===digest(report.binding.snapshot.players[player]),'First XP calculation baseline or policy changed');
            this.append(owner.run_id,{kind:'pending',at:before.observedAt,player,before,policyDigest,skill,context,inputXp});prepared=true;
            const outputXp=execute(true);check(Number.isFinite(outputXp) && outputXp>=0,'Invalid native XP outcome');
            const after=validateXpStateSnapshot(capture(),[player],report.binding.snapshot.configurationDigest);
            this.append(owner.run_id,{kind:'observed',at:after.observedAt,player,after,outputXp});return outputXp;
        }catch(error){
            // Failed outcome persistence must retain the pending marker. Never retry a later call as the first.
            if(!prepared)try{this.append(owner.run_id,{kind:'rejected',at:this.now(),player,error:(error instanceof Error?error.message:'XP evidence failure').slice(0,1000)});}catch{/* No calculation ran; a future attempt still cannot claim an earlier award. */}
            return 0;
        }
    }
    private append(id:string,event:XpExecutionEvent){
        this.db.transaction(()=>{
            const row=this.db.query('SELECT * FROM xp_execution_run WHERE id=?1').get(id) as any;
            check(row && !row.sealed,'XP execution journal is sealed or missing');
            const entry:Omit<XpExecutionEntry,'hash'>={sequence:row.sequence+1,payload:event,previousHash:row.head_hash},hash=xpExecutionEntryHash(id,entry);
            const current=row.sequence===0?{binding:JSON.parse(row.binding) as XpExecutionBinding,entries:[]}:this.get(id)!;
            buildXpExecutionReport(current.binding,[...current.entries,{...entry,hash}],entry.sequence,hash);
            this.db.run('INSERT INTO xp_execution_event VALUES(?1,?2,?3,?4,?5)',[id,entry.sequence,JSON.stringify(event),entry.previousHash,hash]);
            check(this.db.run('UPDATE xp_execution_run SET sequence=?2,head_hash=?3 WHERE id=?1 AND sequence=?4',[id,entry.sequence,hash,row.sequence]).changes===1,'XP execution concurrent write');
        }).immediate();
    }
}
