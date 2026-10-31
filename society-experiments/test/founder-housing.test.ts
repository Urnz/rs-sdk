import {expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
import {commonFounderStageFixture} from '../founder-stage.js';
import {founderHousingAssignments,inspectFreshFounderHousing,FOUNDER_HOUSING_LIMITS,founderHousingParentEnvironment,reachableFounderBedApproach,settleFounderBedApproach} from '../founder-housing.js';
import {loadIntegrationFixture} from '../../society-integration/fixture.js';
const root=resolve(import.meta.dir,'../..');
test('four original founders receive one owner and three distinct paid beds with finite exact rent/ferry economics',async()=>{
    const source=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json')),
        fixture=await commonFounderStageFixture(root,source),before=structuredClone(fixture),assignments=founderHousingAssignments(fixture);
    expect(assignments.map(a=>a.username)).toEqual(source.avatars.map(a=>a.username));expect(fixture).toEqual(before);
    expect(assignments.filter(a=>a.kind==='owner').map(a=>a.username)).toEqual(['silessor']);
    expect(new Set(assignments.map(a=>a.bed.bedSlotId)).size).toBe(4);expect(assignments.reduce((n,a)=>n+a.expectedFareGp,0)).toBe(60);
    expect(assignments.reduce((n,a)=>n+a.openingGp,0)).toBe(2800);expect(assignments.every(a=>a.opening===fixture.avatars.find(f=>f.agentId===a.agentId)!.position)).toBeTrue();
    expect(FOUNDER_HOUSING_LIMITS).toMatchObject({maximumWallMs:480000,travelMs:360000,bedMs:30000});
    fixture.founderBaseline!.beds[1]={...fixture.founderBaseline!.beds[0]!,bedSlotId:'other-name'};
    expect(()=>founderHousingAssignments(fixture)).toThrow('distinct physical beds');
});
test('root and historical non-founder worlds are rejected before opening their databases',()=>{
    expect(()=>inspectFreshFounderHousing(root,root)).toThrow('own backups');
    expect(()=>founderHousingAssignments(loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-v1.json')))).toThrow('common four-founder');
});
test('the orchestration parent retains both managed endpoints; incomplete binding cannot reach a rent mutation',()=>{
    const env={CONTROL_PLANE_SERVER_ID:'srv-0c8d5093-61c9-469f-8751-07152f4ea6d4',MANAGED_WORKSPACE:join(root,'backups/own/workspace'),
        ENGINE_ADMIN_URL:'http://127.0.0.1:12345',GATEWAY_URL:'ws://127.0.0.1:12346',ENGINE_ADMIN_TOKEN:'test-only'};
    expect(founderHousingParentEnvironment(env)).toEqual(env);
    expect(()=>founderHousingParentEnvironment({...env,GATEWAY_URL:undefined})).toThrow('Incomplete managed');
});
test('real SDK collision paths select a reachable exact bed neighbour instead of the blocked west tile',async()=>{
    const {findLongPath,isTileWalkable}=await import('../../sdk/pathfinding');
    const fixture=await commonFounderStageFixture(root,loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json')));
    const assignments=founderHousingAssignments(fixture),from={x:2972,z:3330,level:0};
    expect(isTileWalkable(0,2972,3328)).toBeFalse();
    for(const a of assignments){
        const target=await reachableFounderBedApproach(a.bed,from,async(x,z)=>{
            if(!isTileWalkable(0,x,z))return false;
            const end=findLongPath(0,from.x,from.z,x,z).at(-1);return end?.x===x&&end.z===z&&end.level===0;
        });
        expect(isTileWalkable(0,target.x,target.z)).toBeTrue();
        expect(Math.max(Math.abs(target.x-a.bed.x),Math.abs(target.z-a.bed.z))).toBe(1);
        if(a.kind==='owner')expect(target).toEqual({x:2972,z:3329,level:0});
    }
    await expect(reachableFounderBedApproach(assignments[0]!.bed,{x:0,z:0,level:0},async()=>false)).rejects.toThrow('No completely reachable');
},60000);
test('crossing the bed tile with an older movement pending requires a fresh stop and three stable server ticks',async()=>{
    function avatar(reject=false,drift=false){
        let tick=0,pending=true,calls=0;const player={worldX:2976,worldZ:3331,level:0,lifeId:1,hp:10,isDead:false};
        const sdk={getState:()=>({tick,player}),getStateAge:()=>0,sendWalk:async(x:number,z:number)=>{
            calls++;expect([x,z]).toEqual([2976,3331]);if(!reject)pending=false;return{success:!reject};
        },waitForTicks:async()=>{tick++;if(pending||drift)player.worldX=2975;}};
        return{sdk:sdk as any,calls:()=>calls};
    }
    const target={x:2976,z:3331,level:0},normal=avatar();
    expect(await settleFounderBedApproach(normal.sdk,target,1)).toHaveLength(3);expect(normal.calls()).toBe(1);
    const rejected=avatar(true);await expect(settleFounderBedApproach(rejected.sdk,target,1)).rejects.toThrow('stop command was rejected');expect(rejected.calls()).toBe(1);
    const drift=avatar(false,true);await expect(settleFounderBedApproach(drift.sdk,target,1)).rejects.toThrow('remain stopped');expect(drift.calls()).toBe(1);
});
