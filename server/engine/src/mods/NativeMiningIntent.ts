import type Player from '../engine/entity/Player.js';
import World from '../engine/World.js';
import { nativeMiningToolForWork,type NativeMiningPorts } from './NativeMiningTool.js';
import { nativeToolDigest,type NativeToolOwner } from '../../../../item-lifecycle/native-tool.js';
import { NativeMiningIntentStore,nativeMiningDemandSessionId,type NativeMiningIntentRecord } from '../../../../item-lifecycle/native-mining-intent.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

export interface NativeMiningIntentCommand {demandId:string;username:string;outputItemId:436|438;contextDigest:string;maximumWallMilliseconds:number}
export interface NativeMiningIntentPorts extends NativeMiningPorts {
    clock():SimulationClockObservation;
    /** Trusted caller must re-read the admitted high-level invocation; a posted digest is not authority. */
    authorizeStart(command:NativeMiningIntentCommand,owner:NativeToolOwner):{authorityDigest:string};
}
function ownerFor(p:NativeMiningPorts,player:Player,id:string){
    const c=p.identity(player.username,id,0,World.currentTick);
    if(!c||c.clock.status!=='running'||c.clock.clockId!==c.action.clockId||c.clock.profileDigest!==c.action.clockProfileDigest
        ||c.clock.engineTick!==World.currentTick)throw Error('Native mining intent identity/clock unavailable');
    const {actorId,username,lifecycleId,worldId,clockId,clockProfileDigest}=c.action;
    return{owner:{actorId,username,lifecycleId,worldId,clockId,clockProfileDigest},clock:c.clock};
}

/** Observer only: retains an acknowledged standing request; never moves, retries Mining or repairs a tool. */
export class NativeMiningIntentTracker {
    readonly store:NativeMiningIntentStore;
    constructor(readonly ports:NativeMiningIntentPorts,readonly sessionId:string=nativeMiningDemandSessionId){
        this.store=new NativeMiningIntentStore(ports.market.db);
    }
    private sample(owner:NativeToolOwner,id:string,player:Player|null,clock:SimulationClockObservation):NativeMiningIntentRecord['sample']{
        const unknown=(reason:string)=>({clock,sessionId:this.sessionId,availability:'unknown' as const,itemInstanceId:null,itemRevision:null,reason});
        if(!player||player.loggingOut)return unknown('offline');
        if(player.populationTerminal||player.populationSleeping)return unknown('terminal-or-sleeping');
        try{
            const actual=ownerFor(this.ports,player,id);
            if(nativeToolDigest(actual.owner)!==nativeToolDigest(owner))return unknown('identity-unavailable');
            clock=actual.clock;
            const tool=nativeMiningToolForWork(player,id),utility=tool.store.cycle.utility('bronze-pickaxe-mining',tool.item.itemInstanceId,owner.actorId);
            return{clock,sessionId:this.sessionId,availability:utility.capabilityAvailable?'usable':'unusable',
                itemInstanceId:tool.item.itemInstanceId,itemRevision:tool.item.revision,reason:null};
        }catch{return unknown('tool-evidence-unavailable');}
    }
    start(command:NativeMiningIntentCommand,player:Player){
        if(!command||Object.keys(command).sort().join(',')!=='contextDigest,demandId,maximumWallMilliseconds,outputItemId,username'
            ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(command.demandId)
            ||!Number.isInteger(command.outputItemId)||![436,438].includes(command.outputItemId)||!/^[a-f0-9]{64}$/.test(command.contextDigest)
            ||!Number.isSafeInteger(command.maximumWallMilliseconds)||command.maximumWallMilliseconds<100||command.maximumWallMilliseconds>300000
            ||command.username!==player.username)throw Error('Invalid standing native mining request');
        const actual=ownerFor(this.ports,player,command.demandId),authority=this.ports.authorizeStart(command,actual.owner);
        if(!/^[a-f0-9]{64}$/.test(authority.authorityDigest))throw Error('Native mining intent admission unavailable');
        const prior=this.store.get(command.demandId);
        const sample=prior?.sample??this.sample(actual.owner,command.demandId,player,actual.clock);
        const intent={demandId:command.demandId,owner:actual.owner,outputItemId:command.outputItemId,contextDigest:command.contextDigest,...authority,
            maximumWallMilliseconds:command.maximumWallMilliseconds,
            expiresAtWallTime:prior?.intent.expiresAtWallTime??new Date(Date.parse(sample.clock.wallTime)+command.maximumWallMilliseconds).toISOString()};
        if(prior){if(nativeToolDigest(intent)!==nativeToolDigest(prior.intent))throw Error('Native mining intent conflict');return prior;}
        return this.store.write({schemaVersion:1,intent,revision:1,phase:'pending',sample,completionEventId:null});
    }
    observe(id:string,player:Player|null){
        const prior=this.store.get(id);if(!prior)throw Error('Native mining intent missing');if(prior.phase!=='pending')return prior;
        const clock=this.ports.clock();
        if(prior.sample.sessionId===this.sessionId&&prior.sample.clock.engineTick===clock.engineTick)return prior;
        if(Date.parse(clock.wallTime)>=Date.parse(prior.intent.expiresAtWallTime))return this.store.write({...prior,revision:prior.revision+1,phase:'expired',
            sample:{clock,sessionId:this.sessionId,availability:'unknown',itemInstanceId:null,itemRevision:null,reason:'request-expired'}});
        return this.store.write({...prior,revision:prior.revision+1,sample:this.sample(prior.intent.owner,id,player,clock)});
    }
    cancel(id:string,player:Player){
        const prior=this.store.get(id);if(!prior)throw Error('Native mining intent missing');
        const actual=ownerFor(this.ports,player,id);
        if(nativeToolDigest(actual.owner)!==nativeToolDigest(prior.intent.owner))throw Error('Native mining intent cancel owner differs');
        if(prior.phase!=='pending')return prior;
        return this.store.write({...prior,revision:prior.revision+1,phase:'cancelled',sample:this.sample(prior.intent.owner,id,player,actual.clock)});
    }
}
