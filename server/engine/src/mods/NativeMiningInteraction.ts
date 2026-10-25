import { fileURLToPath } from 'node:url';
import World from '../engine/World.js';
import type Player from '../engine/entity/Player.js';
import LocType from '../cache/config/LocType.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { assertManagedModuleRoot } from '../../../control-plane/instance-context.js';
import { NativeMiningIntentStore } from '../../../../item-lifecycle/native-mining-intent.js';
import { NativeMiningDispatchStore,type NativeMiningDispatch } from '../../../../item-lifecycle/native-mining-dispatch.js';
import { readMiningInteractionSource } from '../../../../agent-skills/mining-interaction-source.js';
import { authorizeMiningDemand,miningOwner,miningRequestDigest } from '../../../../agent-skills/mining-demand-source.js';
import { miningDemandId } from '../../../../agent-skills/mining-admission.js';
import { nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import type { NativeMiningPorts } from './NativeMiningTool.js';
import type { NativeMiningInteractionCommand } from '../../../../sdk/mining-interaction.js';
export interface NativeMiningInteractionRuntime {workspace:string;ports:NativeMiningPorts;player(username:string):Player|null}
type Response={ok:true;dispatch:NativeMiningDispatch}|{ok:false;error:string};
const queue:Array<{command:NativeMiningInteractionCommand;expires:number;resolve(r:Response):void}>=[];
function valid(c:NativeMiningInteractionCommand){return c&&Object.keys(c).sort().join(',')==='dispatchId,username'
    &&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.dispatchId)&&/^[a-z0-9]{1,12}$/.test(c.username);}
export function enqueueNativeMiningInteraction(command:NativeMiningInteractionCommand):Promise<Response>{
    if(!valid(command))return Promise.resolve({ok:false,error:'Invalid typed Mining interaction'});
    if(queue.length>=50)return Promise.resolve({ok:false,error:'Mining interaction queue full'});
    return new Promise(resolve=>queue.push({command:structuredClone(command),expires:Date.now()+5000,resolve}));
}
function production():NativeMiningInteractionRuntime{
    const workspace=fileURLToPath(new URL('../../../../',import.meta.url));assertManagedModuleRoot(workspace);
    return{workspace,ports:{market:ensurePlayerSaveStore(),identity:populationFoodContext,checkpoint:players=>{for(const p of players)World.checkpointPlayers(p);}},
        player:name=>World.getPlayerByUsername(name)??null};
}
/** The authenticated native command is the transport. No ambient OPLOC can inherit its provenance. */
export function applyNativeMiningInteraction(local:NativeMiningInteractionRuntime,command:NativeMiningInteractionCommand):Response{
    if(!valid(command))return{ok:false,error:'Invalid typed Mining interaction'};
    let stage='source';
    try{
        const source=readMiningInteractionSource(local.workspace,command.dispatchId),{request,owner}=source,p=local.ports;
        if(owner.username!==command.username)throw Error('Mining dispatch owner differs');
        const dispatches=new NativeMiningDispatchStore(p.market.db),prior=dispatches.get(command.dispatchId);
        if(prior){if(prior.sourceDigest!==source.digest||nativeToolDigest(prior.owner)!==nativeToolDigest(owner))throw Error('Mining dispatch conflict');return{ok:true,dispatch:prior};}
        stage='authority';const authority=authorizeMiningDemand(local.workspace,owner,request.demand),player=local.player(command.username);
        const pending=new NativeMiningIntentStore(p.market.db).get(miningDemandId(request.demand));
        stage='availability';
        if(!pending||pending.phase!=='pending'||pending.intent.contextDigest!==miningRequestDigest(request.demand)
            ||pending.intent.authorityDigest!==authority.authorityDigest||nativeToolDigest(pending.intent.owner)!==nativeToolDigest(owner)
            ||!player||player.loggingOut||player.populationTerminal||player.populationSleeping||player.delayed||player.protect||player.activeScript)throw Error('Mining dispatch unavailable');
        stage='identity';const context=p.identity(player.username,command.dispatchId,0,World.currentTick);
        if(!context||nativeToolDigest(miningOwner(context.action))!==nativeToolDigest(owner)||context.clock.engineTick!==World.currentTick
            ||Date.parse(context.clock.wallTime)>=Date.parse(pending.intent.expiresAtWallTime))throw Error('Mining dispatch identity/clock expired');
        stage='target';const t=request.target,loc=World.getLoc(t.x,t.z,player.level,t.locId),type=loc?LocType.get(loc.type):null;
        const output=type&&({copperrock1:436,copperrock2:436,tinrock1:438,tinrock2:438} as Record<string,number>)[type.debugname??''];
        const name=output?`${type!.name} ${output===436?'copper':'tin'} ore`.toLowerCase():'',wanted=request.demand.args.name.toLowerCase();
        if(!loc||!type)throw Error('Mining dispatch target missing');
        stage='target-output';if(output!==pending.intent.outputItemId)throw Error('Mining dispatch output differs');
        stage='target-range';if(Math.max(Math.abs(loc.x-player.x),Math.abs(loc.z-player.z))>1)throw Error('Mining dispatch range differs');
        stage='target-name';if(request.demand.args.match==='exact'?name!==wanted:!name.includes(wanted))throw Error('Mining dispatch name differs');
        stage='target-option';if(type.op?.[t.optionIndex-1]?.toLowerCase()!=='mine')throw Error('Mining dispatch option differs');
        stage='script';const script=ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1+t.optionIndex-1,loc.type,type.category);
        if(!script)throw Error('Native Mining script unavailable');
        const record:NativeMiningDispatch={schemaVersion:1,dispatchId:command.dispatchId,demandId:pending.intent.demandId,request,owner,sourceDigest:source.digest,clock:context.clock,level:player.level};
        // Consume before any script effect. Failure after this point is reconciled, never blindly repeated.
        stage='consume';dispatches.admit(record);
        const state=ScriptRunner.init(script,player,loc);state.nativeMiningDispatchId=command.dispatchId;state.nativeMiningActionId=command.dispatchId;
        stage='execute';player.clearPendingAction();player.executeScript(state,true);
        return{ok:true,dispatch:record};
    }catch{return{ok:false,error:`Native Mining interaction ${stage} rejected or execution uncertain`};}
}
export function tickNativeMiningInteractions(override?:NativeMiningInteractionRuntime){
    for(const entry of queue.splice(0,10)){
        if(World.shutdown||Date.now()>entry.expires){entry.resolve({ok:false,error:'Mining interaction expired'});continue;}
        try{entry.resolve(applyNativeMiningInteraction(override??production(),entry.command));}
        catch{entry.resolve({ok:false,error:'Mining interaction unavailable'});}
    }
}
