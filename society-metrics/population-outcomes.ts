import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { AgentStateStore } from '../agent-state/store.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { SocietyIntegrityStore } from '../society-integrity/store.js';
import { assertNativeFoodPath,assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { validateWorldGenesisResult } from '../world-genesis/result.js';
import { loadWorldGenesisProfileCatalog } from '../world-genesis/config.js';
import { populationMembersFromGenesis,resolvePopulationGenesis } from '../population-lifecycle/genesis.js';
import { loadPopulationLifecyclePolicyCatalog,loadPopulationWorldProfileBindingCatalog } from '../population-lifecycle/config.js';
import { populationDeathMembershipDigest } from '../population-lifecycle/death.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { outcomeCheck as check } from './outcome-work.js';
import type { EvaluationScope } from './evaluation.js';
import { nativeMortalityActor } from '../population-lifecycle/native-coverage.js';
import type { NativeGenesisOpeningPaths } from './genesis-opening.js';

/** Backend-selected native sources. Neither source paths nor the result identity come from report queries. */
export interface NativePopulationSelection {
    genesisPath:string;integrityPath:string;healthPath:string;configDirectory:string;
    genesisResultId:string;genesisResultDigest:string;
    opening?:NativeGenesisOpeningPaths;
}
interface PopulationOptions {workspace:string;worldId:string;agentPath:string;population:NativePopulationSelection}
/** Bound work before domain readers allocate/verify full journals. Reject a changing store rather than claiming an atomic cross-store snapshot. */
export function readStableOutcomeStore<T>(options:{workspace:string;worldId:string},path:string,read:(db:Database)=>T){
    try{assertNativeFoodPath({...options,checkpointPath:path});}catch{assertNativeFoodDomainPath({...options,checkpointPath:path});}
    check(statSync(path).size<=256*1024*1024,'Population source exceeds byte limit');
    const db=new OwnedDatabase(path,{readonly:true,strict:true});
    try{
        for(const {name} of db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]){
            check(/^[a-z_][a-z0-9_]*$/.test(name),'Unsupported population source table');
            check((db.query(`SELECT COUNT(*) n FROM ${name}`).get() as {n:number}).n<=100000,'Population source exceeds row limit');
        }
        const snapshot=()=>createHash('sha256').update(db.serialize()).digest('hex'),before=snapshot(),value=read(db);
        check(before===snapshot(),'Population source changed while reading');return{...value,sourceSnapshotDigest:before};
    }finally{db.close(true);}
}
const stable=readStableOutcomeStore;
export function readNativeFounderBaseline(scope:EvaluationScope,options:PopulationOptions){
    const selected=options.population;
    const genesis=stable(options,selected.genesisPath,db=>{
        check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===1,'Unsupported genesis source');
        const row=db.query('SELECT * FROM world_genesis_application WHERE result_id=?').get(selected.genesisResultId) as
            {status:string;receipt_json:string|null;result_digest:string;result_json:string}|null;
        check(row?.status==='applied'&&row.receipt_json&&row.result_digest===selected.genesisResultDigest,'Exact applied genesis unavailable');
        const result=validateWorldGenesisResult(JSON.parse(row.result_json));
        check(result.resultId===selected.genesisResultId&&result.resultDigest===row.result_digest,'Genesis identity differs');return{result};
    });
    const result=genesis.result,config=(name:string)=>join(selected.configDirectory,name);
    const resolved=resolvePopulationGenesis(result,loadWorldGenesisProfileCatalog(config('world-genesis-profiles.json')),
        loadPopulationLifecyclePolicyCatalog(config('population-lifecycle-policies.json')),loadPopulationWorldProfileBindingCatalog(config('population-world-profile-bindings.json')));
    check(resolved.policy?.kind==='finite','Finite founder policy required');
    const founders=populationMembersFromGenesis(result,true);
    check(digest(founders.map(f=>f.agentId).sort())===digest([...scope.actorAgentIds].sort())
        &&result.simulationClock.clockId===scope.clockId&&result.simulationClock.profileDigest===scope.clockProfileDigest,'Original founder scope differs');
    const anchor=stable(options,selected.integrityPath,()=>{
        const store=new SocietyIntegrityStore(selected.integrityPath,true);
        try{const report=store.report(result.resultId);
            check(report.run.status==='observing'&&digest(report.run.result)===digest(result),'Applied integrity baseline differs');
            // Contamination is a separate gate; it must not hide a verified population failure.
            return{genesisAppliedAtSimulationTime:report.run.genesisAppliedAtSimulationTime,journalDigest:digest(report)};
        }finally{store.close();}
    });
    return{worldId:options.worldId,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,
        genesisResultId:result.resultId,genesisResultDigest:result.resultDigest,genesisAppliedAtSimulationTime:anchor.genesisAppliedAtSimulationTime,
        founders,worldProfile:result.profile,lifecyclePolicy:resolved.policy,
        genesisSnapshotDigest:genesis.sourceSnapshotDigest,anchorSnapshotDigest:anchor.sourceSnapshotDigest,anchorDigest:anchor.journalDigest};
}
export type NativeFounderBaseline=ReturnType<typeof readNativeFounderBaseline>;

/** Deaths are terminal negative evidence. Offline/current-active state and a fresh wall heartbeat never certify survival. */
export function readNativeFounderDeaths(scope:EvaluationScope,options:PopulationOptions,baseline:NativeFounderBaseline){
    const agents=stable(options,options.agentPath,()=>{
        const store=new AgentStateStore(options.agentPath,undefined,true);
        try{return{members:baseline.founders.map(founder=>{
            const member=store.getPopulationMember(founder.agentId);
            check(member&&member.playerUsername===founder.playerUsername&&member.sourceResultId===baseline.genesisResultId
                &&member.sourceResultDigest===baseline.genesisResultDigest&&member.simulationClock.clockId===scope.clockId
                &&member.simulationClock.profileDigest===scope.clockProfileDigest&&member.worldProfile.digest===baseline.worldProfile.digest
                &&member.worldProfile.profileId===baseline.worldProfile.profileId&&member.worldProfile.version===baseline.worldProfile.version
                &&digest(member.lifecyclePolicy)===digest({policyId:baseline.lifecyclePolicy.policyId,version:baseline.lifecyclePolicy.version,digest:baseline.lifecyclePolicy.digest,kind:'finite'})
                &&member.joinedAtSimulationTime<=baseline.genesisAppliedAtSimulationTime
                &&member.characterLifecycle.createdAtSimulationTime<=baseline.genesisAppliedAtSimulationTime,'Founder membership/lifecycle differs');
            return member;
        })};}finally{store.close();}
    });
    const health=stable(options,options.population.healthPath,db=>{
        const store=new PlayerHealthEvidenceStore(options.population.healthPath,true);
        try{
            check(store.schemaVersion===2,'Terminal population authority unavailable');const deaths=store.listDeaths();
            // listDeaths verifies both audit tails and the immutable avatar-binding anchor.
            const bindings=db.query('SELECT * FROM engine_population_binding').all() as {username:string;agent_id:string;identity_digest:string}[];
            return{deaths:agents.members.flatMap(member=>{
                const binding=bindings.find(b=>b.username===member.playerUsername),identity=digest({agentId:member.agentId,username:member.playerUsername,
                    worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,clock:member.simulationClock,joinedAt:member.joinedAtSimulationTime,
                    genesisId:member.sourceResultId,genesisDigest:member.sourceResultDigest,createdAt:member.createdAt});
                check(binding?.agent_id===member.agentId&&binding.identity_digest===identity,'Finite avatar identity differs');
                const death=deaths.find(d=>d.agentId===member.agentId||d.playerUsername===member.playerUsername);
                if(!death)return[];
                check(death.agentId===member.agentId&&death.playerUsername===member.playerUsername&&death.membershipDigest===populationDeathMembershipDigest(member)
                    &&death.clock.clockId===scope.clockId&&death.clock.profileDigest===scope.clockProfileDigest
                    &&death.atSimulationTime>=member.joinedAtSimulationTime,'Founder death binding differs');
                return[{agentId:member.agentId,eventId:death.eventId,eventDigest:death.eventDigest,atSimulationTime:death.atSimulationTime,
                    recordedAt:death.recordedAt,cause:death.cause.kind}];
            })};
        }finally{store.close();}
    });
    return{deaths:health.deaths,founderBindings:agents.members.map(nativeMortalityActor),agentSnapshotDigest:agents.sourceSnapshotDigest,healthSnapshotDigest:health.sourceSnapshotDigest,
        completeMortalityCoverage:false,meaning:'Verified deaths bound to the full original roster; no absence-of-death or continuous mortality coverage claim.'};
}
