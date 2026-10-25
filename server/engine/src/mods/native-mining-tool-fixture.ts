import World from '../engine/World.js';
import { beforeAll, afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Player from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import JavaRandom from '../util/JavaRandom.js';
import Packet from '../io/Packet.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { NativeToolStore, nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import { readNativeToolContext } from '../../../../item-lifecycle/native-tool.js';
import { bindNativeMiningTool, checkpointNativeMiningTool, hydrateNativeMiningTool, captureNativeToolTrade, commitNativeToolTrade, type NativeMiningPorts } from './NativeMiningTool.js';
import { checkpointNativeAttributeXp } from './NativeAttributeXp.js';
import InvOps from '../engine/script/handlers/InvOps.js';
import { ScriptOpcode } from '../engine/script/ScriptOpcode.js';
import ScriptPointer from '../engine/script/ScriptPointer.js';
import { TradeEvidenceStore, type EngineTradeEvidence } from './TradeEvidenceStore.js';
const stores: MarketStore[] = [], dirs: string[] = [];
let sequence = 0;
export function closeNativeMiningFixtures(){for(const s of stores.splice(0))s.db.close(true);for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});}
export function fixture(longInstanceId?:string,options?:{identity?:NativeMiningPorts['identity'];username?:string;checkpointPath?:string}) {
    const dir=mkdtempSync(join(tmpdir(),'native-mining-'));dirs.push(dir);
    const market=new MarketStore(options?.checkpointPath??join(dir,'checkpoints.sqlite'));stores.push(market);
    const store=new NativeToolStore(market.db);let attempt=0,alive=true,failCheckpoint=false;
    const p: NativeMiningPorts={market,identity:options?.identity??((username,actionId,slot,tick)=>{
        if(!alive)throw new Error('Terminal population avatar');
        return {action:{actionId,worldId:'si-c02-fixture',actorId:`actor-${username}`,username,lifecycleId:`life-${username}`,
            itemId:379,quantity:1,slot,policyDigest:'a'.repeat(64),clockId:'si-c02-clock',clockProfileDigest:'b'.repeat(64)},
        clock:{clockId:'si-c02-clock',profileDigest:'b'.repeat(64),status:'running',revision:1,engineTick:tick,
            wallTime:'2026-10-24T13:00:00.000Z',simulationTime:new Date(Date.UTC(2001,0,1)+tick*600).toISOString()}};
    }),checkpoint:players=>{
        for(const player of players){const save=player.save(false);checkpointNativeMiningTool(player,save);
            checkpointNativeAttributeXp(market.db,player,save);market.checkpoint(player.username,save,true);}
        if(failCheckpoint)throw new Error('injected native checkpoint failure');
    }};
    function player(username=`miner${++sequence}`, opening=true) {
        const player=new Player(username,2n,2n);player.levels.fill(1);player.baseLevels.fill(1);
        player.setLevel(PlayerStat.MINING,99);player.nativeAttributeXpContext=()=>null;
        player.nativeMiningPorts=p;player.x=3229;player.z=3149;
        const xp=player.addXp.bind(player);player.addXp=(stat,amount)=>xp(stat,amount,false);
        if(opening){player.getInventory(InvType.INV)!.add(1265,1);
            const instanceId=longInstanceId ?? `tool-${username}`;
            store.lifecycle.create({itemInstanceId:instanceId,lifecycleTypeId:'bronze-pickaxe',ownerActorId:`actor-${username}`,
                qualityBasisPoints:10000,provenanceDigest:'c'.repeat(64),atSimulationTime:'2001-01-01T00:00:00.000Z'});
            bindNativeMiningTool(player,instanceId,'d'.repeat(64),p);}
        return player;
    }
    const miner=player(options?.username);
    function mine(seed=4096,who=miner,actionId?:string,beforeResume?:()=>void,rockName='copperrock1') {
        World.currentTick+=5;const rock=new Loc(0,3230+(attempt++*2),3149,1,1,EntityLifeCycle.FOREVER,LocType.getId(rockName),10,0);
        who.x=rock.x-1;who.z=rock.z;World.addLoc(rock,-1);
        who.setVar(VarPlayerType.getId('action_delay'),World.currentTick);who.delayed=false;JavaRandom.setSeed(seed);
        const script=ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,rock.type,LocType.get(rock.type).category)!;
        const state=ScriptRunner.init(script,who,rock);if(actionId)state.nativeMiningActionId=actionId;
        state.execution=who.runScript(state,true);
        if(state.execution===ScriptState.SUSPENDED){beforeResume?.();World.currentTick++;who.delayed=false;state.execution=who.runScript(state,true);}
        return state;
    }
    function reload(who=miner){const loaded=PlayerLoading.load(who.username,new Packet(market.saved(who.username)!),null);
        loaded.nativeMiningPorts=p;loaded.nativeAttributeXpContext=()=>null;hydrateNativeMiningTool(loaded);return loaded;}
    function opcodeState(who=miner) {
        const script=ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,LocType.getId('copperrock1'),LocType.get(LocType.getId('copperrock1')).category)!;
        const state=ScriptRunner.init(script,who);let operand=0;
        Object.defineProperty(state,'intOperand',{get:()=>operand});
        state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
        return{state,secondary(){operand=1;}};
    }
    function move(who:Player,from:number,to:number,slot:number) {
        const {state}=opcodeState(who);for(const n of [from,to,slot])state.pushInt(n);
        InvOps[ScriptOpcode.INV_MOVEFROMSLOT]!(state);
    }
    function trade(to:Player) {
        const offer=InvType.getId('tradeoffer'),slot=miner.getInventory(InvType.INV)!.getItemIndex(1265);
        move(miner,InvType.INV,offer,slot);
        const witness=captureNativeToolTrade(miner,to,offer), op=opcodeState();op.state._activePlayer2=to;
        op.state.pointerAdd(ScriptPointer.ActivePlayer2);op.state.pointerAdd(ScriptPointer.ProtectedActivePlayer2);
        let receipt!:EngineTradeEvidence;
        op.state.nativeFoodTradePorts={market,identity:p.identity,checkpoint:()=>p.checkpoint([miner,to]),record:entry=>{
            const ledger=new TradeEvidenceStore(join(dir,'trades.sqlite'));
            try{return receipt=ledger.record({tick:entry.tick,fromUsername:entry.from,toUsername:entry.to,
                fromItems:entry.fromItems,toItems:entry.toItems,fromValue:entry.fromValue,toValue:entry.toValue,
                committedAt:'2026-10-24T13:00:00.000Z'});}finally{ledger.close();}
        }};
        op.state.pushInt(offer);op.state.pushInt(InvType.INV);InvOps[ScriptOpcode.BOTH_MOVEINV]!(op.state);
        op.secondary();op.state.pushInt(offer);op.state.pushInt(InvType.INV);InvOps[ScriptOpcode.BOTH_MOVEINV]!(op.state);
        return{witness,receipt};
    }
    return{market,store,p,miner,mine,player,reload,move,trade,dead(){alive=false;},fail(value:boolean){failCheckpoint=value;}};
}
