import { afterEach,expect,test } from 'bun:test';
import { BotActions } from '../actions';
import { ActionHelpers } from '../actions-helpers';
import { miningSourceFixture } from '../../agent-skills/test/mining-demand-fixture.js';
import { validateMiningInteractionRequest,type MiningInteractionRequest } from '../mining-interaction.js';
const fixtures:ReturnType<typeof miningSourceFixture>[]=[];afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
function fixture(){
    const f=miningSourceFixture();fixtures.push(f);const packets:MiningInteractionRequest[]=[];let raw=0,walks=0;
    const controller=new AbortController(),loc={id:2090,name:'Rocks copper ore',x:3230,z:3149,distance:3,optionsWithIndex:[{text:'Mine',opIndex:1}]};
    const state={tick:1,player:{x:0,z:0,worldX:3227,worldZ:3149,level:0,animId:-1},dialog:{isOpen:false},interface:{isOpen:false},gameMessages:[]};
    const bot=Object.create(BotActions.prototype) as any;
    bot.dismissBlockingUI=async()=>{};bot.walkTo=async()=>{walks++;return{success:true,message:'walked'};};
    bot.helpers={resolveLocation:()=>loc,refindLocation:()=>loc,getMessageTick:()=>0,checkCantReachMessage:()=>false,
        walkAdjacentTo:async()=>{walks++;state.player.worldX=loc.x-1;return true;},
        withDoorRetry:async(run:()=>Promise<unknown>)=>run()};
    bot.sdk={getState:()=>state,sendMiningInteraction:async(r:MiningInteractionRequest)=>{packets.push(validateMiningInteractionRequest(r));state.player.animId=1;return{success:true,message:'admitted'};},
        sendInteractLoc:async()=>{raw++;state.player.animId=1;return{success:true,message:'raw'};},waitForCondition:async()=>state};
    return{...f,bot,packets,controller,loc,raw:()=>raw,walks:()=>walks};
}
test('managed SDK interaction emits exact source context/sequence/target without a raw OPLOC or serialized AbortSignal',async()=>{
    const f=fixture(),r=await f.bot.interactLoc(f.loc,'mine',{demand:f.request,dispatchSequence:1,signal:f.controller.signal});
    expect(r.success).toBeTrue();expect(f.raw()).toBe(0);expect(f.walks()).toBe(1);expect(f.packets).toHaveLength(1);
    expect(f.packets[0]).toMatchObject({demand:f.request,dispatchSequence:1,target:{x:3230,z:3149,locId:2090,optionIndex:1}});
    expect(Object.keys(f.packets[0]!).sort()).toEqual(['demand','dispatchSequence','target']);
});
test('abort during walking cannot send a later managed Mining command',async()=>{
    const f=fixture();f.bot.helpers.walkAdjacentTo=async()=>{f.controller.abort();return true;};
    const r=await f.bot.interactLoc(f.loc,'mine',{demand:f.request,dispatchSequence:1,signal:f.controller.signal});
    expect(r.success).toBeFalse();expect(f.raw()).toBe(0);expect(f.packets).toHaveLength(0);
});
test('native Mining approaches a neighbour, retains the chosen rock identity and never walks to its blocked centre',async()=>{
    const f=fixture();f.bot.walkTo=async()=>{throw Error('Blocked centre must not be a walk target');};
    let approached:unknown;f.bot.helpers.walkAdjacentTo=async(x:number,z:number,tolerance:number)=>{approached={x,z,tolerance};return true;};
    const other={...f.loc,id:2091,x:f.loc.x+2};let resolves=0;
    f.bot.helpers.resolveLocation=()=>++resolves===1?f.loc:other;
    const result=await f.bot.interactLoc('Rocks copper ore','mine',{demand:f.request,dispatchSequence:1,signal:f.controller.signal});
    expect(result.success).toBeTrue();expect(approached).toEqual({x:f.loc.x,z:f.loc.z,tolerance:0});expect(f.packets[0]?.target.locId).toBe(f.loc.id);expect(f.raw()).toBe(0);
});
test('failed native approach emits no dispatch or raw packet',async()=>{
    const f=fixture();f.bot.helpers.walkAdjacentTo=async()=>false;
    expect((await f.bot.interactLoc(f.loc,'mine',{demand:f.request,dispatchSequence:1,signal:f.controller.signal})).success).toBeFalse();
    expect(f.raw()).toBe(0);expect(f.packets).toHaveLength(0);
});
test('strict neighbour arrival does not accept a candidate one tile early outside native Mining range',async()=>{
    const player={worldX:0,worldZ:0};let tolerance:unknown;
    const helper=new ActionHelpers({getState:()=>({player}),sendWalk:async()=>({success:true})} as any);
    helper.waitForMovementComplete=async(x,z,radius)=>{tolerance=radius;player.worldX=x-radius!;player.worldZ=z;
        return{arrived:true,stoppedMoving:true,x:player.worldX,z:player.worldZ};};
    expect(await helper.walkAdjacentTo(3,0,0)).toBeTrue();expect(tolerance).toBe(0);
    expect(Math.max(Math.abs(player.worldX-3),Math.abs(player.worldZ))).toBe(1);
});
test('contextless SDK interaction retains its ordinary raw transport',async()=>{
    const f=fixture();expect((await f.bot.interactLoc(f.loc,1)).success).toBeTrue();expect(f.raw()).toBe(1);expect(f.packets).toHaveLength(0);
});
