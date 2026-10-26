import { join } from 'node:path';
import { AgentStateStore } from '../agent-state/store.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { populationNeedsBinding } from '../needs/population-binding.js';
import { populationDeathMembershipDigest } from '../population-lifecycle/death.js';
import { loadPopulationAgePolicy } from '../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy,evaluatePopulationMortality } from '../population-lifecycle/mortality.js';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { NativeIntegrationOptions,NativeWealthPaths,readWealthBoundary } from './integration-sources.js';
import type { EvaluationScope } from './evaluation.js';
import type { DurableNeedsState } from '../needs/store.js';
import { readStableOutcomeStore } from './population-outcomes.js';
export interface NativeFoodBoundaryPaths extends NativeWealthPaths {agentPath:string;healthPath:string}
function check(v:unknown):asserts v {if(!v)throw Error('Native food boundary binding differs');}

/** Frozen census + physical inventory. Bank/business/escrow stock is an upper bound until access is proved. */
export function readNativeFoodBoundary(scope:EvaluationScope,options:NativeIntegrationOptions,paths:NativeFoodBoundaryPaths,wealth:ReturnType<typeof readWealthBoundary>){
    const contract=loadSocietyMinimumContract(options.configDirectory),at=wealth.simulationTime;
    const initialized=readStableOutcomeStore(options,paths.needsPath,db=>({rows:(db.query('SELECT snapshot_json FROM needs_event WHERE revision=1').all() as {snapshot_json:string}[])
        .map(r=>JSON.parse(r.snapshot_json) as DurableNeedsState)}));
    const agents=readStableOutcomeStore(options,paths.agentPath,()=>{
        const store=new AgentStateStore(paths.agentPath,undefined,true);
        try{return{members:store.listPopulationMembers()};}finally{store.close();}
    });
    check(digest(agents.members.map(m=>m.agentId).sort())===digest([...scope.actorAgentIds].sort()));
    const observation:SimulationClockObservation={clockId:scope.clockId,profileDigest:scope.clockProfileDigest,status:'paused',revision:wealth.clock.revision,
        simulationTime:at,wallTime:new Date(wealth.clock.last_observed_wall_ms).toISOString(),engineTick:null};
    const age=loadPopulationAgePolicy(join(options.configDirectory,'population-age-policy.json')),
        mortality=loadPopulationMortalityPolicy(join(options.configDirectory,'population-mortality-policy.json'));
    const health=readStableOutcomeStore(options,paths.healthPath,db=>{
        const store=new PlayerHealthEvidenceStore(paths.healthPath,true);
        try{
            check(store.schemaVersion===2);const deaths=store.listDeaths();check(deaths.every(d=>d.clock.simulationTime<=at));
            const bindings=db.query('SELECT * FROM engine_population_binding').all() as {username:string;agent_id:string;identity_digest:string}[];
            return{eligible:agents.members.flatMap(member=>{
                const needs=wealth.cohort.find(n=>n.binding.actorId===member.agentId);
                check(needs&&digest(needs.binding)===digest(populationNeedsBinding(options.worldId,member))&&member.joinedAtSimulationTime<=at);
                const binding=bindings.find(b=>b.username===member.playerUsername),identity=digest({agentId:member.agentId,username:member.playerUsername,
                    worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,clock:member.simulationClock,joinedAt:member.joinedAtSimulationTime,
                    genesisId:member.sourceResultId,genesisDigest:member.sourceResultDigest,createdAt:member.createdAt});
                check(binding?.agent_id===member.agentId&&binding.identity_digest===identity);
                const death=deaths.find(d=>d.agentId===member.agentId||d.playerUsername===member.playerUsername);
                if(death)check(death.agentId===member.agentId&&death.playerUsername===member.playerUsername&&death.membershipDigest===populationDeathMembershipDigest(member)
                    &&death.clock.clockId===scope.clockId&&death.clock.profileDigest===scope.clockProfileDigest);
                if(death||member.status!=='active'||member.characterLifecycle.status!=='active'||needs.terminal)return[];
                const natural=evaluatePopulationMortality(member,observation,age,mortality);
                if(member.characterLifecycle.birthAtSimulationTime===null||natural.candidate?.due)return[];
                const hunger=needs.state.values.find(n=>n.needId==='hunger')!;
                if(contract.dependencies.needs.policyId==='day-survival-needs'&&hunger.value>=contract.dependencies.needs.needs.find(n=>n.needId==='hunger')!.maximumValue)return[];
                const vitals=wealth.playerVitals.find(p=>p.username===member.playerUsername);
                return vitals?.currentHitpoints&&vitals.currentHitpoints>0?[member.playerUsername]:[];
            })};
        }finally{store.close();}
    });
    const rule=contract.dependencies.dynamics.rules.find(r=>r.needId==='hunger')!,rates=[rule.onlineAwakePerHour,rule.offlineAwakePerHour,rule.onlineSleepingPerHour,rule.offlineSleepingPerHour];
    check(rates.every(r=>Number.isSafeInteger(r)&&r>0));
    const hungerRateLower=health.eligible.length*Math.min(...rates),hungerRateUpper=agents.members.length*Math.max(...rates);
    return{at,worldId:options.worldId,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,contractDigest:contract.digest,
        cohort:wealth.cohort.map(n=>{const first=initialized.rows.find(r=>digest(r.binding)===digest(n.binding));
            check(first&&digest(first.admission)===digest(n.admission));return{binding:n.binding,admission:n.admission,initializedAt:first!.state.observedAtSimulationTime};}),
        hungerRateLower,hungerRateUpper,chains:contract.dependencies.food.chains.map(chain=>{
            const upper=wealth.assets.filter(a=>a.itemId===chain.cookedItem.itemId).reduce((n,a)=>n+BigInt(a.count),0n),
                lower=wealth.assets.filter(a=>a.itemId===chain.cookedItem.itemId&&a.location==='player-inventory'&&health.eligible.includes(a.owner)).reduce((n,a)=>n+BigInt(a.count),0n);
            return{chainId:chain.foodChainId,lowerRelief:String(lower*BigInt(chain.hungerRelief)),upperRelief:String(upper*BigInt(chain.hungerRelief))};
        }),agentSnapshotDigest:agents.sourceSnapshotDigest,healthSnapshotDigest:health.sourceSnapshotDigest,needsSnapshotDigest:initialized.sourceSnapshotDigest,
        meaning:'Instant physical lower/upper usable capacity under the frozen closed cohort; not continuous mortality, legal-access history or complete source coverage.'};
}
