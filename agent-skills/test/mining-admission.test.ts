import { afterEach,expect,test } from 'bun:test';
import { readFileSync,writeFileSync } from 'node:fs';
import { miningSourceFixture } from './mining-demand-fixture.js';
import { authorizeMiningDemand,persistMiningDemandInvocation,cancelMiningDemandInvocation,miningDemandCancellation,readMiningDemandInvocation,miningRequestDigest } from '../mining-demand-source.js';
import { miningDemandId,sealMiningOperationAdmission } from '../mining-admission.js';
import { validateMiningDemandRequest } from '../../sdk/mining-demand.js';
const fixtures:ReturnType<typeof miningSourceFixture>[]=[];afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
function fixture(){const f=miningSourceFixture();fixtures.push(f);return f;}

test('exact run, operation instance, parameters, reviewed checksum and active population are required',()=>{
    const f=fixture();expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow();f.admit();
    expect(authorizeMiningDemand(f.root,f.owner,f.request).authorityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(()=>authorizeMiningDemand(f.root,{...f.owner,lifecycleId:'f'.repeat(64)},f.request)).toThrow('population');
    expect(()=>authorizeMiningDemand(f.root,f.owner,{...f.request,args:{...f.request.args,timeoutMs:300000}})).toThrow('admission');
    expect(()=>authorizeMiningDemand(f.root,f.owner,{...f.request,context:{...f.request.context,stepId:'unexecuted'}})).toThrow('admission');
    f.agents.setSkillKnowledge(f.owner.actorId,f.request.context.skill,'blocked',1);
    expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('learned');
});
test('same step in a repeated operation gets a new ID and only the current instance can open',()=>{
    const f=fixture();f.admit();const next={...f.request,context:{...f.request.context,operationSequence:2}};f.admit(next);
    expect(miningDemandId(next)).not.toBe(f.demandId);expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('admission');
    expect(authorizeMiningDemand(f.root,f.owner,next).authorityDigest).toMatch(/^[a-f0-9]{64}$/);
});
test('stale heartbeat, closed executor step and modified admission cannot renew a request',()=>{
    const f=fixture();f.admit();const marker=JSON.parse(readFileSync(f.markerPath,'utf8'));
    writeFileSync(f.markerPath,JSON.stringify({...marker,heartbeatAt:'2001-01-01T00:00:00.000Z'}));
    expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('admission');
    writeFileSync(f.markerPath,JSON.stringify(marker));sealMiningOperationAdmission(f.root,f.request);
    expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('sealed');
});
test('durable cancellation precedes native dispatch and survives marker removal and replay',()=>{
    const f=fixture();f.admit();persistMiningDemandInvocation(f.root,f.owner,f.request);
    cancelMiningDemandInvocation(f.root,f.demandId,f.owner);cancelMiningDemandInvocation(f.root,f.demandId,f.owner);
    expect(miningDemandCancellation(f.root,f.demandId,f.owner)).toBeTrue();expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('cancelled');
    const {worldId,...rest}=f.owner;
    expect(readMiningDemandInvocation(f.root,f.demandId,{...rest,worldId}).contextDigest).toBe(miningRequestDigest(f.request));
    expect(()=>persistMiningDemandInvocation(f.root,f.owner,{...f.request,args:{...f.request.args,item:'tin ore'}})).toThrow('conflict');
});
test('typed SDK request rejects posted paths/owners/receipts and out-of-range sequence or quantities',()=>{
    const f=fixture();expect(()=>validateMiningDemandRequest({...f.request,owner:f.owner} as any)).toThrow();
    expect(()=>validateMiningDemandRequest({...f.request,args:{...f.request.args,path:'C:/other'}} as any)).toThrow();
    expect(()=>validateMiningDemandRequest({...f.request,context:{...f.request.context,operationSequence:0}})).toThrow();
    expect(()=>validateMiningDemandRequest({...f.request,args:{...f.request.args,timeoutMs:300001}})).toThrow();
});
