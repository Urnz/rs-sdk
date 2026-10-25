import { fileURLToPath } from 'node:url';
import World from '../engine/World.js';
import type Player from '../engine/entity/Player.js';
import { playerSaveStore,ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { populationFoodContext,populationFoodTickClock } from './PopulationDeathRuntime.js';
import { NativeMiningIntentTracker } from './NativeMiningIntent.js';
import { NativeMiningIntentStore,type NativeMiningIntentRecord } from '../../../../item-lifecycle/native-mining-intent.js';
import { authorizeMiningDemand,authorizeMiningDemandCommand,readMiningDemandInvocation,miningDemandCancellation,miningOperationSealed } from '../../../../agent-skills/mining-demand-source.js';
import { assertManagedModuleRoot } from '../../../control-plane/instance-context.js';
import { tickNativeMiningCoverage,type MiningCoveragePorts } from './NativeMiningCoverage.js';
import { tickNativeMiningInteractions,type NativeMiningInteractionRuntime } from './NativeMiningInteraction.js';

import type { NativeMiningDemandCommand } from '../../../../sdk/mining-demand.js';
export type { NativeMiningDemandCommand } from '../../../../sdk/mining-demand.js';
type Response={ok:true;record:NativeMiningIntentRecord|null}|{ok:false;error:string};
export interface NativeMiningDemandRuntime {workspace:string;tracker:NativeMiningIntentTracker;player(username:string):Player|null;coverage?:MiningCoveragePorts;interaction?:NativeMiningInteractionRuntime}
const queue:Array<{command:NativeMiningDemandCommand;expires:number;resolve(value:Response):void}>=[];
let current:NativeMiningDemandRuntime|null=null;
function valid(c:NativeMiningDemandCommand){return c&&Object.keys(c).sort().join(',')==='contextDigest,demandId,operation,username'
    &&['open','close'].includes(c.operation)&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.demandId)
    &&/^[a-z0-9]{1,12}$/.test(c.username)&&/^[a-f0-9]{64}$/.test(c.contextDigest);}
export function enqueueNativeMiningDemand(command:NativeMiningDemandCommand):Promise<Response>{
    if(!valid(command))return Promise.resolve({ok:false,error:'Invalid typed Mining demand command'});
    if(queue.length>=50)return Promise.resolve({ok:false,error:'Mining demand queue full'});
    return new Promise(resolve=>queue.push({command:structuredClone(command),expires:Date.now()+5000,resolve}));
}
function runtime():NativeMiningDemandRuntime{
    const workspace=fileURLToPath(new URL('../../../../',import.meta.url));assertManagedModuleRoot(workspace);
    const market=ensurePlayerSaveStore();if(current?.tracker.ports.market.db===market.db)return current;
    const tracker=new NativeMiningIntentTracker({market,identity:populationFoodContext,requireDispatchProof:true,
        checkpoint:players=>{for(const player of players)World.checkpointPlayers(player);},
        clock:()=>{const c=populationFoodTickClock(World.currentTick);if(!c)throw Error('Native mining intent clock unavailable');return c;},
        authorizeStart:(command,owner)=>authorizeMiningDemandCommand(workspace,command,owner)});
    return current={workspace,tracker,player:username=>World.getPlayerByUsername(username)??null};
}
/** Typed internal command at the engine tick boundary; caller receipts never supply identity, time or authority. */
export function applyNativeMiningDemand(local:NativeMiningDemandRuntime,command:NativeMiningDemandCommand):Response{
    if(!valid(command))return{ok:false,error:'Invalid typed Mining demand command'};
    try{
        const {tracker,workspace}=local,prior=tracker.store.get(command.demandId);
        if(command.operation==='close'&&!prior)return{ok:true,record:null};
        const player=local.player(command.username);
        const context=!prior&&player?tracker.ports.identity(player.username,command.demandId,0,World.currentTick):null;
        const owner=prior?.intent.owner??(context?(({actorId,username,lifecycleId,worldId,clockId,clockProfileDigest})=>
            ({actorId,username,lifecycleId,worldId,clockId,clockProfileDigest}))(context.action):null);
        if(!owner||owner.username!==command.username)throw Error('Native Mining owner unavailable');
        const invocation=readMiningDemandInvocation(workspace,command.demandId,owner);
        if(invocation.contextDigest!==command.contextDigest)throw Error('Native Mining context differs');
        if(command.operation==='close'){
            if(!miningDemandCancellation(workspace,command.demandId,owner)&&!miningOperationSealed(workspace,owner,invocation.request))throw Error('No acknowledged cancellation');
            return{ok:true,record:tracker.cancelAcknowledged(command.demandId)};
        }
        if(!player)throw Error('Native Mining avatar offline');
        return{ok:true,record:tracker.start({demandId:command.demandId,username:command.username,contextDigest:command.contextDigest,
            outputItemId:invocation.request.args.item==='copper ore'?436:438,maximumWallMilliseconds:invocation.request.args.timeoutMs},player)};
    }catch{return{ok:false,error:'Native Mining demand source rejected'};}
}
export function tickNativeMiningIntents(override?:NativeMiningDemandRuntime){
    if(World.shutdown)return;
    for(const entry of queue.splice(0,10))try{
        if(Date.now()>entry.expires)throw Error('Expired command');entry.resolve(applyNativeMiningDemand(override??runtime(),entry.command));
    }catch{entry.resolve({ok:false,error:'Native Mining command unavailable or expired'});}
    if(!override||override.interaction)tickNativeMiningInteractions(override?.interaction);
    try{
        const market=override?.tracker.ports.market??playerSaveStore();if(!market||!NativeMiningIntentStore.present(market.db))return;
        if(!market.db.query("SELECT 1 FROM native_mining_intent_state WHERE phase='pending' LIMIT 1").get())return;
        const local=override??runtime();
        for(const record of local.tracker.store.pending())try{
            const i=record.intent,invocation=readMiningDemandInvocation(local.workspace,i.demandId,i.owner);
            if(miningDemandCancellation(local.workspace,i.demandId,i.owner)||miningOperationSealed(local.workspace,i.owner,invocation.request)){
                local.tracker.cancelAcknowledged(i.demandId);continue;
            }
            let available=true;
            try{if(authorizeMiningDemand(local.workspace,i.owner,invocation.request).authorityDigest!==i.authorityDigest)available=false;}
            catch{available=false;}
            local.tracker.observe(i.demandId,local.player(i.owner.username),available);
        }catch{
            try{local.tracker.observe(record.intent.demandId,null,false);}catch{console.error('[NativeMiningIntent] source gap; request retained');}
        }
    }catch{console.error('[NativeMiningIntent] source unavailable; no coverage claimed');}
    finally{if(!override||override.coverage)tickNativeMiningCoverage(override?.coverage);}
}
