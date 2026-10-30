import {afterEach,expect,test} from 'bun:test';
import {copyFileSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {miningSourceFixture} from '../../agent-skills/test/mining-demand-fixture.js';
import {SkillTrialStore} from '../../agent-skills/trials.js';
import {FOUNDER_TRIAL_PROCEDURES,founderTrialSource,prepareFounderProcedureTrials} from '../founder-procedure-trials.js';
const sources:ReturnType<typeof miningSourceFixture>[]=[];afterEach(()=>{for(const s of sources.splice(0))s.close();});
function fixture(){
    const s=miningSourceFixture();sources.push(s);
    writeFileSync(join(s.root,'.local/simulation/food-trial-fixture.json'),JSON.stringify({schemaVersion:1,acceptance:'draft-trial-only',worldId:s.owner.worldId,fixtureDigest:'a'.repeat(64)}));
    for(const {id} of FOUNDER_TRIAL_PROCEDURES){const file=`${id}@0.1.0.skill.json`;copyFileSync(resolve(import.meta.dir,'../../agent-skills/catalog',file),join(s.root,'agent-skills/catalog',file));}
    return s;
}
test('preparation is idempotent, binds three exact drafts and creates no saves, inventory, runtime grants or verified skill',async()=>{
    const s=fixture(),a=await prepareFounderProcedureTrials(s.root,'worker','trial-workshop'),b=await prepareFounderProcedureTrials(s.root,'worker','trial-workshop');
    expect(a.prepared).toHaveLength(3);expect(b.prepared).toEqual(a.prepared);expect(a.executionStarted).toBeFalse();
    expect(a.prepared.every(p=>p.status==='ready'&&p.draft.version==='0.1.0'&&/^[a-f0-9]{64}$/.test(p.checksum))).toBeTrue();
    expect(a.prepared.find(p=>p.kind==='repair')?.parameters).toEqual({'business-id':'trial-workshop'});
    for(const path of ['server/engine/data/player-checkpoints.sqlite','.local/admin/active-skills/worker.json','.local/agent-skills/shared'])expect(existsSync(join(s.root,path))).toBeFalse();
    expect(s.agents.listSkillKnowledge(s.owner.actorId).some(k=>k.skill.id==='procedure.tools.repair-bronze-pickaxe')).toBeFalse();
});
test('integration worlds, incorrect trial markers, inactive subjects and missing drafts fail before trial writes',async()=>{
    const s=fixture();writeFileSync(join(s.root,'.local/simulation/integration-fixture.json'),'{}');
    expect(()=>founderTrialSource(s.root)).toThrow('separate disposable');
    const other=fixture();writeFileSync(join(other.root,'.local/simulation/food-trial-fixture.json'),JSON.stringify({schemaVersion:1,acceptance:'not-run'}));
    expect(()=>founderTrialSource(other.root)).toThrow('binding');
    const missing=fixture();await expect(prepareFounderProcedureTrials(missing.root,'stranger','trial-workshop')).rejects.toThrow('active population');
    expect(existsSync(join(missing.root,'.local/agent-skills/trials.json'))).toBeFalse();
    writeFileSync(join(missing.root,'agent-skills/catalog/procedure.mining.gather-tin@0.1.0.skill.json'),JSON.stringify({bad:true}));
    await expect(prepareFounderProcedureTrials(missing.root,'worker','trial-workshop')).rejects.toThrow();
    expect(existsSync(join(missing.root,'.local/agent-skills/trials.json'))).toBeFalse();
});
test('an active trial with different parameters cannot silently be rebound or duplicated',async()=>{
    const s=fixture();await prepareFounderProcedureTrials(s.root,'worker','first-workshop');
    await expect(prepareFounderProcedureTrials(s.root,'worker','other-workshop')).rejects.toThrow('Conflicting active');
    const trials=await new SkillTrialStore(join(s.root,'.local/agent-skills/trials.json')).list();
    expect(trials).toHaveLength(3);expect(trials.find(t=>t.draft.id.includes('repair'))?.parameters).toEqual({'business-id':'first-workshop'});
});
test('actual CLI prepares only a separate trial world; inspect cannot turn a ready trial into approval',async()=>{
    const s=fixture(),cli=resolve(import.meta.dir,'../../scripts/society-founder-trials.ts');
    const child=Bun.spawn([process.execPath,cli,'prepare','--root',s.root,'--username','worker','--business-id','trial-workshop'],{stdout:'pipe',stderr:'pipe'});
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(err).toBe('');expect(code).toBe(0);const prepared=JSON.parse(out);expect(prepared.prepared).toHaveLength(3);
    const inspect=Bun.spawn([process.execPath,cli,'inspect','--root',s.root,'--trial',prepared.prepared[0].trialId],{stdout:'pipe',stderr:'pipe'});
    const [inspectOut,inspectErr,inspectCode]=await Promise.all([new Response(inspect.stdout).text(),new Response(inspect.stderr).text(),inspect.exited]);
    expect(inspectCode).not.toBe(0);expect(inspectOut).toBe('');expect(inspectErr).toContain('passed review');
    expect(JSON.parse(readFileSync(join(s.root,'.local/agent-skills/trials.json'),'utf8')).trials.every((t:{status:string})=>t.status==='ready')).toBeTrue();
});
