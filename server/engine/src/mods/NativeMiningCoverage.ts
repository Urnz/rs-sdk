import type { Database } from 'bun:sqlite';
import type Player from '../engine/entity/Player.js';
import World from '../engine/World.js';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import { fileURLToPath } from 'node:url';
import { populationFoodContext,populationFoodTickClock,populationMiningCoverageRoster } from './PopulationDeathRuntime.js';
import type { NativeMiningPorts } from './NativeMiningTool.js';
import { NativeMiningIntentStore,nativeMiningDemandSessionId } from '../../../../item-lifecycle/native-mining-intent.js';
import { NativeMiningCoverageStore,miningCoverageSourceHeads,miningRosterDigest,type NativeMiningCoverageSample,type NativeMiningCoverageIngress } from '../../../../item-lifecycle/native-mining-coverage.js';
import { miningIntentFulfillmentAllowed,miningOwner } from '../../../../agent-skills/mining-demand-source.js';
import { miningExecutorSourceAvailable } from '../../../../agent-skills/mining-request-source.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { NativeMiningDispatchStore } from '../../../../item-lifecycle/native-mining-dispatch.js';

/** Explicit test/backend ports only; none are posted by an avatar or exposed through HTTP. */
export interface MiningCoveragePorts {
    db:Database;workspace:string;clock():SimulationClockObservation|null;identity:NativeMiningPorts['identity'];
    player(username:string):Player|null;roster():ReturnType<typeof populationMiningCoverageRoster>;
    admitted(record:NonNullable<ReturnType<NativeMiningIntentStore['get']>>):boolean;
}
const ingressFailures=new WeakSet<Database>();
function production():MiningCoveragePorts|null{
    const market=playerSaveStore();if(!market||!NativeMiningCoverageStore.present(market.db))return null;
    const workspace=fileURLToPath(new URL('../../../../',import.meta.url));
    return{db:market.db,workspace,clock:()=>populationFoodTickClock(World.currentTick),identity:populationFoodContext,
        player:name=>World.getPlayerByUsername(name)??null,roster:populationMiningCoverageRoster,
        admitted:r=>miningIntentFulfillmentAllowed(workspace,r.intent)};
}
function inWindow(store:NativeMiningCoverageStore,c:SimulationClockObservation){
    const s=store.selection(),at=Date.parse(c.simulationTime);
    return at>=Date.parse(s.fromSimulationTime)-s.maximumSimulationGapMs&&at<=Date.parse(s.toSimulationTime)+s.maximumSimulationGapMs;
}
function sameClock(a:SimulationClockObservation,b:SimulationClockObservation){
    return a.status==='running'&&a.clockId===b.clockId&&a.profileDigest===b.profileDigest&&a.engineTick===b.engineTick
        &&a.revision>=b.revision&&Date.parse(a.simulationTime)>=Date.parse(b.simulationTime)
        &&Date.parse(a.wallTime)>=Date.parse(b.wallTime)&&Date.parse(a.wallTime)-Date.parse(b.wallTime)<=5000;
}
/** Runs even with an empty standing queue. Missing frames/clock/session remain holes at export. */
export function tickNativeMiningCoverage(override?:MiningCoveragePorts){
    const p=override??production();if(!p||!NativeMiningCoverageStore.present(p.db))return;
    try{
        const store=new NativeMiningCoverageStore(p.db),s=store.selection(),clock=p.clock();if(!clock||!inWindow(store,clock))return;
        const intents=new NativeMiningIntentStore(p.db).pending();let rosterDigest:string|null=null;
        try{rosterDigest=miningRosterDigest(p.roster());}catch{ /* Missing source is an explicit gap. */ }
        const actors:NativeMiningCoverageSample['actors']=s.actors.map(owner=>{
            const row=intents.find(r=>r.intent.owner.username===owner.username),result={actorId:owner.actorId,demandId:row?.intent.demandId??null};
            const player=p.player(owner.username);if(!player||player.loggingOut)return{...result,status:'offline'};
            if(player.populationTerminal||player.populationSleeping)return{...result,status:'restricted'};
            try{
                const context=p.identity(owner.username,s.selectionId,0,World.currentTick);
                if(!context||miningRosterDigest([miningOwner(context.action)])!==miningRosterDigest([owner])
                    ||!sameClock(context.clock,clock))return{...result,status:'identity-unavailable'};
            }catch{return{...result,status:'identity-unavailable'};}
            if(row&&(miningRosterDigest([row.intent.owner])!==miningRosterDigest([owner])||!p.admitted(row)))return{...result,status:'source-unavailable'};
            return{...result,status:'observed'};
        });
        store.append({kind:'sample',clock,sessionId:nativeMiningDemandSessionId,rosterDigest,heads:miningCoverageSourceHeads(p.db),actors,
            ...(s.executorSelectionDigest?{executorSourceAvailable:miningExecutorSourceAvailable(p.workspace,p.db,s.executorSelectionDigest)}:{}),
            ingressWriteFailed:ingressFailures.has(p.db)});ingressFailures.delete(p.db);
    }catch{console.error('[NativeMiningCoverage] source unavailable; no coverage claimed');}
}
/** Before identity/tool early returns, including legacy/raw Mining. Observation never admits work. */
export function observeNativeMiningIngress(player:Player,nativeActionId:string,output:number|undefined,ports:NativeMiningPorts|null,override?:MiningCoveragePorts,dispatchId?:string){
    const p=override??ports?.miningCoverage??production();
    if(!p||!NativeMiningCoverageStore.present(p.db))return;
    try{
        const store=new NativeMiningCoverageStore(p.db),s=store.selection();if(!s.actors.some(a=>a.username===player.username))return;
        if(ports&&ports.market.db!==p.db)throw Error('Mining coverage checkpoint differs');
        const clock=p.clock();if(!clock||!inWindow(store,clock))throw Error('Mining ingress clock unavailable');
        const owner=s.actors.find(a=>a.username===player.username)!,pending=new NativeMiningIntentStore(p.db).pending().find(r=>r.intent.owner.username===player.username);
        let reason:NativeMiningCoverageIngress['reason']='identity-unavailable',demandId:string|null=null;
        let context=null;try{context=(ports?.identity??p.identity)(player.username,nativeActionId,0,World.currentTick);}catch{ /* Durable identity gap below. */ }
        if(context&&miningRosterDigest([miningOwner(context.action)])===miningRosterDigest([owner])&&sameClock(context.clock,clock)){
            if(![436,438].includes(output??0))reason='unsupported-native-path';
            else if(!pending)reason='no-standing-request';
            else if(pending.intent.outputItemId!==output||!p.admitted(pending))reason='admission-unavailable';
            else{
                const old=p.db.query<{sequence:number},[string]>(`SELECT sequence FROM native_mining_demand_event
                    WHERE json_valid(payload) AND json_extract(payload,'$.requestId')=? ORDER BY sequence LIMIT 1`).get(nativeActionId);
                if(pending.intent.attemptSequenceAtAdmission===undefined||old&&old.sequence<=pending.intent.attemptSequenceAtAdmission)reason='pre-admission-action';
                else{
                    reason='compatible-request';demandId=pending.intent.demandId;
                    if(dispatchId){const proof=new NativeMiningDispatchStore(p.db).get(dispatchId);
                        if(proof&&proof.dispatchId===nativeActionId&&proof.demandId===demandId&&miningRosterDigest([proof.owner])===miningRosterDigest([owner]))reason='source-bound-request';
                        else{reason='admission-unavailable';demandId=null;}}
                }
            }
        }
        store.append({kind:'ingress',clock,sessionId:nativeMiningDemandSessionId,username:player.username,nativeActionId,demandId,reason,
            ...(dispatchId?{dispatchId}:{}),heads:miningCoverageSourceHeads(p.db)});
    }catch{ingressFailures.add(p.db);console.error('[NativeMiningCoverage] Mining ingress unavailable; gap retained');}
}
