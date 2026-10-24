import { expect,test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSkillDefinition } from '../validation.js';
import { verifyAndPromoteSkill } from '../verifier.js';
import { RsSdkSkillRuntime } from '../rs-sdk-runtime.js';
import { validateSocietyToolRequest } from '../../sdk/society-tools.js';
import { toolSkillOperationId } from '../../server/gateway/admin/native-tool-skills.js';
import { classifySkillFailure } from '../../server/gateway/admin/autonomous-skill-binding.js';
import { draftTrialAuthorization } from '../food-trials.js';
import type { SkillRunResult,SkillRuntimeAuthorization } from '../types.js';
const load=(id:string)=>validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir,`../catalog/${id}@0.1.0.skill.json`),'utf8')));
const context={runId:randomUUID(),skill:{id:'procedure.metallurgy.smelt-bronze',version:'0.1.0'},stepId:'smelt',parametersDigest:'a'.repeat(64)};
const request={operation:'tool-smelt-bronze' as const,args:{timeoutMs:1000},context};
const authorization:SkillRuntimeAuthorization={operations:['tool-smelt-bronze'],itemNames:['copper ore','tin ore','bronze bar'],
    partners:[],maxQuantity:1,maxGpPerRun:0,maxUnitPriceGp:0};
test('SI-C03 tool drafts are bounded and cannot widen input, receipts, time, retry or authority',()=>{
    for(const id of ['procedure.metallurgy.smelt-bronze','procedure.tools.repair-bronze-pickaxe']){
        const draft=load(id);expect(draft.status).toBe('draft');expect(draft.limits.maxOperations).toBe(2);
        expect(draftTrialAuthorization(draft)!.maxGpPerRun).toBe(0);
        expect(verifyAndPromoteSkill(draft,[],{targetVersion:'1.0.0',parameters:id.includes('repair')?{'business-id':'test-workshop'}:{}}).passed).toBeFalse();
        Object.assign(draft.steps[1]!,{maxAttempts:2});expect(()=>validateSkillDefinition(draft)).toThrow('one attempt');
    }
    for(const patch of [{receipt:{}},{inputItems:[]},{timeoutMs:60001},{timeoutMs:0},{owner:'other'}])
        expect(()=>validateSocietyToolRequest({...request,args:{...request.args,...patch}})).toThrow();
    expect(toolSkillOperationId(request)).toBe(toolSkillOperationId({...request,args:{timeoutMs:2000}}));
    expect(toolSkillOperationId(request)).not.toBe(toolSkillOperationId({...request,context:{...context,runId:randomUUID()}}));
    expect(classifySkillFailure('tool-uncertain','possibly started')).toBe('authorization');
});
test('SI-C03 runtime requires material authorization and executor context; posted dispatch success cannot complete work',async()=>{
    let calls=0;const sdk={sendSocietyTool:async()=>{calls++;return{success:true,message:'sent'};}} as any;
    expect(await new RsSdkSkillRuntime({} as any,sdk).execute(request.operation,request.args,new AbortController().signal,context))
        .toMatchObject({success:false,code:'authorization-item'});expect(calls).toBe(0);
    const runtime=new RsSdkSkillRuntime({} as any,sdk,authorization);
    expect(await runtime.execute(request.operation,request.args,new AbortController().signal)).toMatchObject({success:false,code:'tool-context-required'});
    expect(await runtime.execute(request.operation,request.args,new AbortController().signal,context))
        .toMatchObject({success:false,code:'tool-uncertain',retryable:false});expect(calls).toBe(1);
});
test('SI-C03 runtime rechecks permission while polling the same native operation',async()=>{
    const grant=structuredClone(authorization),requests:unknown[]=[];
    const sdk={sendSocietyTool:async(value:unknown)=>{requests.push(value);grant.operations=[];return{success:false,message:'waiting',data:{status:'waiting'}};}};
    expect(await new RsSdkSkillRuntime({} as any,sdk as any,grant).execute(request.operation,request.args,new AbortController().signal,context))
        .toMatchObject({success:false,code:'authorization-operation',retryable:false});expect(requests).toHaveLength(1);
});
test('SI-C03 promotion requires distinct native effects and a trusted canonical source callback',()=>{
    const draft=load('procedure.metallurgy.smelt-bronze'),timestamp='2026-10-24T12:00:00.000Z';
    const run=():SkillRunResult=>{const runId=randomUUID(),skill={id:draft.id,version:draft.version};return{runId,skill,username:'worker',status:'completed',
        reason:'completed',message:'done',parameters:{},operations:2,durationMs:1000,events:[{runId,skill,type:'step.succeeded',timestamp,stepId:'smelt',operation:'tool-smelt-bronze',
            data:{receipt:{intent:{operationId:randomUUID()}}}},{runId,skill,type:'skill.completed',timestamp}]};};
    const runs=[run(),run()];expect(verifyAndPromoteSkill(draft,runs,{targetVersion:'1.0.0'}).checks.find(c=>c.id==='native-tool-sources')!.passed).toBeFalse();
    expect(verifyAndPromoteSkill(draft,runs,{targetVersion:'1.0.0',verifyToolEvidence:()=>true}).passed).toBeTrue();
    runs[1]!.events[0]!.data=runs[0]!.events[0]!.data;
    expect(verifyAndPromoteSkill(draft,runs,{targetVersion:'1.0.0',verifyToolEvidence:()=>true}).passed).toBeFalse();
});
