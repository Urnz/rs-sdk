import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import tin from '../catalog/procedure.mining.gather-tin@0.1.0.skill.json';
import {SkillRegistry} from '../registry.js';
import {SkillTrialStore} from '../trials.js';
import {FileSkillRunJournal} from '../journal.js';
import {SkillExecutor} from '../executor.js';
import {nativeToolDigest as hash} from '../../item-lifecycle/native-tool.js';
import {readSkillTrialReview,reviewSkillTrial} from '../trial-review.js';

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(count=2){
    const root=mkdtempSync(join(tmpdir(),'trial-review-'));roots.push(root);
    const definition=new SkillRegistry().register({...tin,id:'procedure.review-test',preconditions:[],steps:[tin.steps[0]]}).definition;
    mkdirSync(join(root,'agent-skills/catalog'),{recursive:true});writeFileSync(join(root,'agent-skills/catalog',`${definition.id}@0.1.0.skill.json`),JSON.stringify(definition));
    const registered=new SkillRegistry().register(definition),trials=new SkillTrialStore(join(root,'.local/agent-skills/trials.json'));
    let trial=await trials.create({gapId:'gap-'+'a'.repeat(20),draft:{id:definition.id,version:definition.version},targetVersion:'1.0.0',testBotUsername:'worker',parameters:{}},'2026-10-30T00:00:00.000Z');
    trial=await trials.transition(trial.trialId,trial.revision,'running');
    const journal=new FileSkillRunJournal(join(root,'.local/agent-skills/runs')),runs=[];
    for(let i=0;i<count;i++){
        const run=await new SkillExecutor({test:async()=>true,execute:async()=>({success:true,message:'unit movement'})}).execute(definition,{allowDraft:true});run.username='worker';
        await journal.start({runId:run.runId,username:'worker',skill:run.skill,checksum:registered.checksum,parameters:{},parametersDigest:hash([])});
        await journal.save(run);runs.push(run);
    }
    return{root,trials,trial,definition,runs,options:{workspace:root,trialId:trial.trialId,selected:{worldId:'trial-world',checkpointPath:join(root,'unused.sqlite')}}};
}
test('normal review persists two runs and a stable approval, reopens readonly and never publishes a skill',async()=>{
    const f=await fixture(),review=await reviewSkillTrial(f.options),before=readFileSync(join(f.root,'.local/agent-skills/trials.json'),'utf8');
    expect(review.report.passed).toBeTrue();expect(review.approval?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await readSkillTrialReview(f.options)).approval.digest).toBe(review.approval!.digest);
    expect(readFileSync(join(f.root,'.local/agent-skills/trials.json'),'utf8')).toBe(before);
    expect(existsSync(join(f.root,'.local/agent-skills/shared',`${f.definition.id}@1.0.0.skill.json`))).toBeFalse();
});
test('one run remains a durable failed review and cannot yield approval',async()=>{
    const f=await fixture(1),review=await reviewSkillTrial(f.options);
    expect(review.report.passed).toBeFalse();expect(review.approval).toBeNull();
    expect((await f.trials.get(f.trial.trialId))?.status).toBe('verification-failed');
    await expect(readSkillTrialReview(f.options)).rejects.toThrow('passed review');
});
test('rehashed or changed run data, executor checksum and stored report require a new review',async()=>{
    for(const target of ['run','admission','report'] as const){
        const f=await fixture(),review=await reviewSkillTrial(f.options),base=join(f.root,'.local/agent-skills');
        const path=target==='report'?join(base,'verifications',`${review.report.id}.json`):join(base,'runs',`${f.runs[0]!.runId}${target==='admission'?'.admission':''}.json`);
        const value=JSON.parse(readFileSync(path,'utf8'));
        if(target==='run')value.message='changed after review';else if(target==='admission')value.checksum='f'.repeat(64);else value.promoted.steps=[];
        writeFileSync(path,JSON.stringify(value));await expect(readSkillTrialReview(f.options)).rejects.toThrow();
    }
});
