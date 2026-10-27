import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { nativePopulationLifecycleAuthority,populationAvatarIsFinite,populationAvatarRestricted } from './PopulationDeathRuntime.js';
import { NativeLifecycleAttemptStore,type LifecycleAuthority,type LifecycleAttemptKind,type LifecycleAttemptOutcome,type LifecycleAttemptEvent } from '../../../../population-lifecycle/native-attempts.js';

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
