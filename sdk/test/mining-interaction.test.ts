import { afterEach,expect,test } from 'bun:test';
import { BotActions } from '../actions';
import { miningSourceFixture } from '../../agent-skills/test/mining-demand-fixture.js';
import { validateMiningInteractionRequest,type MiningInteractionRequest } from '../mining-interaction.js';
const fixtures:ReturnType<typeof miningSourceFixture>[]=[];afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
function fixture(){
    const f=miningSourceFixture();fixtures.push(f);const packets:MiningInteractionRequest[]=[];let raw=0,walks=0;
    const controller=new AbortController(),loc={id:2090,name:'Rocks copper ore',x:3230,z:3149,distance:3,optionsWithIndex:[{text:'Mine',opIndex:1}]};
    const state={tick:1,player:{x:3229,z:3149,level:0,animId:-1},dialog:{isOpen:false},interface:{isOpen:false},gameMessages:[]};
    const bot=Object.create(BotActions.prototype) as any;
    bot.dismissBlockingUI=async()=>{};bot.walkTo=async()=>{walks++;return{success:true,message:'walked'};};
    bot.helpers={resolveLocation:()=>loc,refindLocation:()=>loc,getMessageTick:()=>0,checkCantReachMessage:()=>false,
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
    const f=fixture();f.bot.walkTo=async()=>{f.controller.abort();return{success:true,message:'arrived after cancel'};};
    const r=await f.bot.interactLoc(f.loc,'mine',{demand:f.request,dispatchSequence:1,signal:f.controller.signal});
    expect(r.success).toBeFalse();expect(f.raw()).toBe(0);expect(f.packets).toHaveLength(0);
});
test('contextless SDK interaction retains its ordinary raw transport',async()=>{
    const f=fixture();expect((await f.bot.interactLoc(f.loc,1)).success).toBeTrue();expect(f.raw()).toBe(1);expect(f.packets).toHaveLength(0);
});
