import {afterEach,expect,test} from 'bun:test';
import {readFileSync,writeFileSync} from 'node:fs';
import tin from '../catalog/procedure.mining.gather-tin@0.1.0.skill.json';
import {SkillRegistry} from '../registry.js';
import {miningTrialAuthorization} from '../mining-trials.js';
import {draftTrialAuthorization} from '../food-trials.js';
import {authorizeMiningDemand} from '../mining-demand-source.js';
import {miningSourceFixture} from './mining-demand-fixture.js';

const draft=new SkillRegistry().register(tin,{trusted:true}).definition;
const fixtures:ReturnType<typeof miningSourceFixture>[]=[];
afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
function fixture(){const f=miningSourceFixture(draft);fixtures.push(f);f.admit();return f;}
function acknowledge(f:ReturnType<typeof fixture>){
    const marker=JSON.parse(readFileSync(f.markerPath,'utf8'));
    writeFileSync(f.markerPath,JSON.stringify({...marker,nativeMiningTrial:{checksum:f.registered.checksum,runtimeAuthorization:miningTrialAuthorization(draft)}}));
}
test('only the exact bounded tin draft receives trial operations, without spending or trading',()=>{
    expect(draftTrialAuthorization(draft)).toEqual(miningTrialAuthorization(draft)!);
    expect(miningTrialAuthorization(draft)).toMatchObject({operations:['walk-to','gather-loc'],maxQuantity:1,maxGpPerRun:0});
    expect(miningTrialAuthorization({...draft,status:'verified'})).toBeUndefined();
    for(const mutate of [
        (d:typeof draft)=>{if(d.steps[0]?.kind==='operation')d.steps[0].arguments.x=3286;},
        (d:typeof draft)=>{if(d.steps[1]?.kind==='operation')d.steps[1].maxAttempts=2;},
        (d:typeof draft)=>{if(d.steps[1]?.kind==='operation')d.steps[1].arguments.item='copper ore';},
        (d:typeof draft)=>{if(d.steps[1]?.kind==='operation')d.steps[1].arguments.timeoutMs=15000;},
        (d:typeof draft)=>{if(d.steps[1]?.kind==='operation')d.steps[1].arguments.timeoutMs=60001;},
        (d:typeof draft)=>{d.limits.maxOperations=3;},
        (d:typeof draft)=>{d.limits.timeoutMs=120001;}
    ]){const changed=structuredClone(draft);mutate(changed);expect(()=>miningTrialAuthorization(changed)).toThrow();}
});
test('learned draft and generic executor admission alone cannot open Mining; exact acknowledged trial can',()=>{
    const f=fixture();expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('acknowledged trial');
    acknowledge(f);expect(authorizeMiningDemand(f.root,f.owner,f.request).authorityDigest).toMatch(/^[a-f0-9]{64}$/);
    const marker=JSON.parse(readFileSync(f.markerPath,'utf8'));
    writeFileSync(f.markerPath,JSON.stringify({...marker,nativeMiningTrial:{...marker.nativeMiningTrial,runtimeAuthorization:{...marker.nativeMiningTrial.runtimeAuthorization,maxQuantity:2}}}));
    expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow('acknowledged trial');
});
test('acknowledgment cannot bypass blocked knowledge, stale executor or a different native gather request',()=>{
    const f=fixture();acknowledge(f);
    const changed={...f.request,context:{...f.request.context,operationSequence:2},args:{...f.request.args,timeoutMs:16000}};f.admit(changed);acknowledge(f);
    expect(()=>authorizeMiningDemand(f.root,f.owner,changed)).toThrow('acknowledged trial');
    const stale=fixture();acknowledge(stale);
    const marker=JSON.parse(readFileSync(stale.markerPath,'utf8'));writeFileSync(stale.markerPath,JSON.stringify({...marker,heartbeatAt:'2001-01-01T00:00:00.000Z'}));
    expect(()=>authorizeMiningDemand(stale.root,stale.owner,stale.request)).toThrow('admission');
    const blocked=fixture();acknowledge(blocked);blocked.agents.setSkillKnowledge(blocked.owner.actorId,blocked.request.context.skill,'blocked',1);
    expect(()=>authorizeMiningDemand(blocked.root,blocked.owner,blocked.request)).toThrow('learned');
});
