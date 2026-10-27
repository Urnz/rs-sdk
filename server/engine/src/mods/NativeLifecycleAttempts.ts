import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { nativePopulationLifecycleAuthority,populationAvatarIsFinite,populationAvatarRestricted } from './PopulationDeathRuntime.js';
import { NativeLifecycleAttemptStore,type LifecycleAuthority,type LifecycleAttemptKind,type LifecycleAttemptOutcome,type LifecycleAttemptEvent } from '../../../../population-lifecycle/native-attempts.js';
import { NativeLifecycleWatermarkStore,type LifecycleWatermarkStage } from '../../../../population-lifecycle/native-watermarks.js';

interface ObservedAvatar {username:string;levels:ArrayLike<number>;populationTerminal:boolean;populationFinite:boolean}
export interface LifecycleObservationPorts {db:Database;context(username:string,tick:number):LifecycleAuthority|null;wallTime():string}
const overrides=new AsyncLocalStorage<LifecycleObservationPorts>(),sessionId=randomUUID();
/** Internal fixture/backend scope only. No packet, HTTP or model endpoint accepts observer ports. */
export function withNativeLifecycleObservation<T>(ports:LifecycleObservationPorts,run:()=>T):T{return overrides.run(ports,run);}
function production():LifecycleObservationPorts|null {
    const market=playerSaveStore();if(!market||!NativeLifecycleAttemptStore.present(market.db))return null;
    return{db:market.db,context:nativePopulationLifecycleAuthority,wallTime:()=>new Date().toISOString()};
}
export const isNativeRespawnScript=(name:string)=>/^\[(?:queue|proc|label),player_death(?:_duel)?\]$/.test(name);
/** Missing context remains explicit; every observer error is isolated from the existing gameplay decision. */
export function beginNativeLifecycleAttempt(kind:LifecycleAttemptKind,username:string,tick:number,avatar?:ObservedAvatar,scriptName:string|null=null){
    let p:LifecycleObservationPorts|null=null;
    try{
        p=overrides.getStore()??production();if(!p||!NativeLifecycleAttemptStore.present(p.db))return;
        const store=new NativeLifecycleAttemptStore(p.db),s=store.selection().mortality;
        if(!s.actors.some(a=>a.username===username))return;
        const attemptId=randomUUID(),ports=p;
        const event=(phase:'begin'|'result',outcome:LifecycleAttemptOutcome|null,player?:ObservedAvatar,scriptState:number|null=null):LifecycleAttemptEvent=>{
            let authority:LifecycleAuthority|null=null;try{authority=ports.context(username,tick);}catch{ /* No fabricated identity/clock. */ }
            return{attemptId,sessionId,username,kind,phase,wallTime:ports.wallTime(),authority,scriptName,outcome,scriptState,
                vitals:player?{hitpoints:player.levels[PlayerStat.HITPOINTS]!,terminal:player.populationTerminal,finite:player.populationFinite}:null};
        };
        store.append(event('begin',null,avatar));let finished=false;
        return{finish(outcome:LifecycleAttemptOutcome,player?:ObservedAvatar,scriptState:number|null=null){
            if(finished)return;finished=true;
            try{store.append(event('result',outcome,player,scriptState));}catch{try{store.fault();}catch{ /* A failed DB cannot attest coverage. */ }
                console.error('[NativeLifecycleAttempts] result unavailable; gap retained');}
        }};
    }catch{if(p)try{new NativeLifecycleAttemptStore(p.db).fault();}catch{ /* Absence is not a zero-attempt certificate. */ }
        console.error('[NativeLifecycleAttempts] begin unavailable; gap retained');}
}

/** The existing World login rule, with observation around the same two authority lookups. Ports are backend/test only. */
export function observeNativePopulationLogin(player:ObservedAvatar,tick:number,
    guard={finite:populationAvatarIsFinite,restricted:populationAvatarRestricted}):'passed'|'blocked'|'source-unavailable'{
    const attempt=beginNativeLifecycleAttempt('login-guard',player.username,tick,player);
    try{player.populationFinite=guard.finite(player.username);
        if(guard.restricted(player.username)||(player.populationFinite&&player.levels[PlayerStat.HITPOINTS]===0)){
            attempt?.finish(player.populationFinite&&player.levels[PlayerStat.HITPOINTS]===0?'blocked-hp-zero':'blocked-restricted',player);return'blocked';}
        attempt?.finish('passed',player);return'passed';
    }catch{attempt?.finish('source-unavailable',player);return'source-unavailable';}
}

/** Observe the actual indexed World collection, including avatars missing from the processing loop. Never mutates it. */
export function observeNativeLifecycleWatermark(stage:LifecycleWatermarkStage,tick:number,players:ReadonlyArray<ObservedAvatar|undefined>){
    let p:LifecycleObservationPorts|null=null;
    try{
        p=overrides.getStore()??production();if(!p||!NativeLifecycleWatermarkStore.present(p.db))return;
        const store=new NativeLifecycleWatermarkStore(p.db),s=store.selection().mortality;
        const actors=s.actors.map(a=>{let authority:LifecycleAuthority|null=null;try{authority=p!.context(a.username,tick);}catch{ /* Unknown remains unknown. */ }
            return{username:a.username,authority};});
        const clock=actors.find(a=>a.authority)?.authority?.clock;if(!clock)throw Error('No current lifecycle census clock');
        if(clock.simulationTime<s.fromSimulationTime||clock.simulationTime>s.toSimulationTime)return;
        const avatars:Array<{username:string;slot:number;vitals:{hitpoints:number;terminal:boolean;finite:boolean}}>=[];
        for(let slot=0;slot<players.length;slot++){const a=players[slot];if(a&&s.actors.some(m=>m.username===a.username))
            avatars.push({username:a.username,slot,vitals:{hitpoints:a.levels[PlayerStat.HITPOINTS]!,terminal:a.populationTerminal,finite:a.populationFinite}});}
        const mortalityHead=p.db.query('SELECT sequence,digest FROM native_mortality_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null;
        if(!mortalityHead||mortalityHead.sequence===0)throw Error('No mortality witness for lifecycle census');
        const cursor=new NativeLifecycleAttemptStore(p.db).cursor();
        store.append({sessionId,clock,wallTime:p.wallTime(),stage,mortalityHead,attemptHead:cursor.head,attemptFaultCount:cursor.faultCount,actors,avatars});
    }catch{if(p)try{new NativeLifecycleWatermarkStore(p.db).fault();}catch{ /* A failed DB cannot attest census coverage. */ }
        console.error('[NativeLifecycleWatermarks] census unavailable; gap retained');}
}
