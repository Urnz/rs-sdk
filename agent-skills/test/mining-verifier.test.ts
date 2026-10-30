import {expect,test} from 'bun:test';
import tin from '../catalog/procedure.mining.gather-tin@0.1.0.skill.json';
import {SkillRegistry} from '../registry.js';
import {SkillExecutor} from '../executor.js';
import {requiresNativeMiningEvidence,verifyAndPromoteSkill} from '../verifier.js';
import type {SkillRuntime,SkillRunResult} from '../types.js';

const draft=new SkillRegistry().register(tin,{trusted:true}).definition;
// Unit-only runtime: tests verifier gates, never supplies real publication evidence.
async function evidence(){
    const runs:SkillRunResult[]=[];
    for(let i=0;i<2;i++){
        const runtime:SkillRuntime={test:async()=>true,execute:async()=>({success:true,message:'unit effect',data:{miningDemand:{nativeActionId:`unit-${i}`}}})};
        runs.push({...await new SkillExecutor(runtime).execute(draft,{allowDraft:true}),username:'worker'});
    }return runs;
}
test('completed Mining runs and distinct posted effect IDs cannot replace canonical native source verification',async()=>{
    const runs=await evidence(),options={targetVersion:'1.0.0'};
    expect(verifyAndPromoteSkill(draft,runs,options).checks.find(c=>c.id==='native-mining-sources')?.passed).toBeFalse();
    for(const verifyMiningEvidence of [()=>false,()=>{throw Error('source changed');}])
        expect(verifyAndPromoteSkill(draft,runs,{...options,verifyMiningEvidence}).passed).toBeFalse();
    expect(verifyAndPromoteSkill(draft,runs,{...options,verifyMiningEvidence:()=>true}).passed).toBeTrue();
});
test('source requirement is derived from the procedure and each child invocation, independently of an old report',()=>{
    expect(requiresNativeMiningEvidence(draft,{})).toBeTrue();
    const gather=structuredClone(draft.steps[1]!);if(gather.kind!=='operation')throw Error('Expected gather');
    gather.arguments.item={parameter:'item'};
    const child={...draft,id:'procedure.parameterized-child',parameters:{item:{type:'string' as const,description:'Output',required:true}},steps:[gather]};
    const composed={...draft,steps:[
        {kind:'call' as const,id:'first',skill:{id:child.id,version:child.version},arguments:{item:'iron ore'}},
        {kind:'call' as const,id:'second',skill:{id:child.id,version:child.version},arguments:{item:'tin ore'}}
    ]};
    expect(requiresNativeMiningEvidence(composed,{},()=>child)).toBeTrue();
    expect(requiresNativeMiningEvidence({...composed,steps:[composed.steps[0]!]}, {},()=>child)).toBeFalse();
    expect(requiresNativeMiningEvidence({...draft,steps:[draft.steps[0]!]},{})).toBeFalse();
});
test('reused effects or ACK-only Mining results fail even if a trusted source callback returns true',async()=>{
    const runs=await evidence(),options={targetVersion:'1.0.0',verifyMiningEvidence:()=>true};
    const first=runs[0]!.events.find(e=>e.operation==='gather-loc'&&e.type==='step.succeeded')!;
    const second=runs[1]!.events.find(e=>e.operation==='gather-loc'&&e.type==='step.succeeded')!;
    second.data=structuredClone(first.data);
    expect(verifyAndPromoteSkill(draft,runs,options).checks.find(c=>c.id==='independent-native-mining')?.passed).toBeFalse();
    second.data={ack:true};
    expect(verifyAndPromoteSkill(draft,runs,options).passed).toBeFalse();
});
test('repeat and resolved child Mining cannot bypass the source gate',async()=>{
    const runs=await evidence(),gather=draft.steps[1]!;
    const repeated={...draft,steps:[{kind:'repeat' as const,id:'repeat',maxIterations:1,until:{condition:'inventory-contains' as const,arguments:{name:'tin ore',amount:1}},steps:[gather]}]};
    expect(verifyAndPromoteSkill(repeated,runs,{targetVersion:'1.0.0'}).checks.find(c=>c.id==='native-mining-sources')?.passed).toBeFalse();
    const child={...draft,id:'procedure.child',version:'1.0.0',status:'verified' as const,provenance:{...draft.provenance,authorKind:'system' as const},steps:[gather]};
    const composed={...draft,steps:[{kind:'call' as const,id:'child',skill:{id:child.id,version:child.version},arguments:{}}]};
    expect(verifyAndPromoteSkill(composed,runs,{targetVersion:'1.0.0',resolveDefinition:()=>child}).checks.find(c=>c.id==='native-mining-sources')?.passed).toBeFalse();
});
