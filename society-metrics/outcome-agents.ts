import type { Database } from 'bun:sqlite';
import { AGENT_STATE_SCHEMA_VERSION } from '../agent-state/types.js';
import { evaluateStateObjective } from '../agent-state/state-objectives.js';
import { nativeToolDigest as digest } from '../item-lifecycle/native-tool.js';
import { verifyMemoryHistory } from '../agent-state/memory-archive.js';
import { verifyPopulationEntryHistory } from '../agent-state/population-entry.js';
import type { EvaluationScope } from './evaluation.js';
import { outcomeCheck as check,outcomeRows as rows,outcomeTime as time,type OutcomeActor } from './outcome-work.js';

/** No biography, prompt, social notes, episode text, goal text or skill parameters leave this projection. */
export function readOutcomeAgents(db:Database,scope:EvaluationScope,observers:readonly string[]){
    check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===AGENT_STATE_SCHEMA_VERSION,'Unsupported outcome AgentState schema');
    for(const name of ['agent_memory_audit','agent_population_memory_archive','agent_memory_transfer','agent_population_entry','agent_population_member'])rows(db,name);
    verifyMemoryHistory(db);verifyPopulationEntryHistory(db);
    const identities=rows(db,'agent_identity'),members=rows(db,'agent_population_member'),lifecycles=rows(db,'agent_character_lifecycle');
    const actors:OutcomeActor[]=scope.actorAgentIds.map(agentId=>{
        const identity=identities.find(r=>r.agent_id===agentId);check(identity,'Selected outcome actor is missing');
        const m=members.find(r=>r.agent_id===agentId),l=lifecycles.find(r=>r.agent_id===agentId);
        if(!m)return{agentId,username:identity.player_username as string|null,lifecycleId:null};
        check(l&&m.player_username===identity.player_username&&m.simulation_clock_id===scope.clockId
            &&m.simulation_clock_profile_digest===scope.clockProfileDigest,'Outcome actor lifecycle/clock differs');
        const lifecycleId=digest({agentId,createdAt:l.created_at,origin:l.origin,createdAtSimulationTime:l.created_at_simulation_time,
            sourceResultId:m.source_result_id,sourceResultDigest:m.source_result_digest,
            worldProfile:{profileId:m.world_profile_id,version:m.world_profile_version,digest:m.world_profile_digest},
            lifecyclePolicy:{policyId:m.lifecycle_policy_id,version:m.lifecycle_policy_version,digest:m.lifecycle_policy_digest,kind:m.lifecycle_policy_kind},
            simulationClock:{clockId:m.simulation_clock_id,profileDigest:m.simulation_clock_profile_digest}});
        return{agentId,username:m.player_username as string,lifecycleId};
    });
    const aliases=new Map<string,string>();for(const a of actors)for(const key of [a.agentId,a.username,a.username?`player:${a.username}`:null]){
        if(!key)continue;const normalized=key.toLowerCase();check(!aliases.has(normalized)||aliases.get(normalized)===a.agentId,'Ambiguous social actor alias');aliases.set(normalized,a.agentId);}
    const episodes=rows(db,'agent_episode');
    const evidence=(observer:string,raw:string)=>{const ids=JSON.parse(raw);check(Array.isArray(ids),'Invalid observer evidence');
        return ids.map((id:unknown)=>{check(typeof id==='string'&&episodes.some(e=>e.episode_id===id&&e.agent_id===observer),'Observer evidence belongs to another actor');return id;});};
    const relationships=rows(db,'agent_relationship').filter(r=>observers.includes(r.agent_id)&&aliases.has(r.actor_key)).map(r=>({
        observerAgentId:r.agent_id as string,partnerAgentId:aliases.get(r.actor_key)!,kind:'observer-belief',trust:r.trust as number,
        affinity:r.affinity as number,familiarity:r.familiarity as number,updatedAtWall:r.updated_at as string,
        evidenceEpisodeIds:evidence(r.agent_id,r.evidence_episode_ids)}));
    const commitments=rows(db,'agent_commitment').filter(r=>observers.includes(r.agent_id)&&aliases.has(r.actor_key)).map(r=>({
        id:r.commitment_id as string,observerAgentId:r.agent_id as string,partnerAgentId:aliases.get(r.actor_key)!,direction:r.direction as string,
        status:r.status as string,kind:r.status==='fulfilled'?'observer-reported-cooperation':r.status==='broken'?'observer-reported-conflict':'observer-commitment',
        updatedAtWall:r.updated_at as string,evidenceEpisodeIds:evidence(r.agent_id,r.evidence_episode_ids)}));
    const goals=rows(db,'agent_goal'),objectives=rows(db,'agent_state_objective'),evaluations=rows(db,'agent_state_evaluation');
    const executions=rows(db,'agent_goal_execution'),events=rows(db,'agent_goal_event');
    const transitions=events.filter(e=>scope.actorAgentIds.includes(e.agent_id)&&e.kind==='status-changed'&&e.status==='completed').map(e=>{
        const facts={schemaVersion:1,goalId:e.goal_id,agentId:e.agent_id,kind:e.kind,previousStatus:e.previous_status,status:e.status,
            previousRevision:e.previous_revision,revision:e.revision,skill:e.skill_id&&e.skill_version?{id:e.skill_id,version:e.skill_version}:null,occurredAt:e.occurred_at};
        const sourceDigest=digest(facts);if(e.simulation_source_digest)check(sourceDigest===e.simulation_source_digest,'Goal transition digest differs');
        const matching=evaluations.find(v=>v.goal_id===e.goal_id&&v.goal_revision===e.previous_revision&&v.evaluated_at===e.occurred_at&&v.result==='satisfied');
        return{goalId:e.goal_id as string,agentId:e.agent_id as string,sourceId:`${e.agent_id}:${e.goal_id}:${e.revision}:${e.kind}`,sourceDigest,
            sequence:e.simulation_sequence as number|null,clockId:e.simulation_clock_id as string|null,
            profileDigest:e.simulation_profile_digest as string|null,simulationTime:e.simulation_time as string|null,
            wallTime:e.simulation_binding_wall_time as string|null,basis:matching?'state-predicate':'skill-manual-or-hierarchy',
            stateObservationDigest:matching?.digest as string|undefined??null};
    });
    const goalOutcomes=goals.filter(g=>scope.actorAgentIds.includes(g.agent_id)).map(g=>{
        const objective=objectives.find(o=>o.goal_id===g.goal_id),execution=executions.find(e=>e.goal_id===g.goal_id);
        const states=objective?evaluations.filter(e=>e.goal_id===g.goal_id).flatMap(e=>{
            const observation=JSON.parse(e.observation_json);check(observation.agentId===g.agent_id&&/^[a-f0-9]{64}$/.test(observation.binding),'Goal observation binding differs');
            const result=evaluateStateObjective(JSON.parse(objective.objective_json),observation,e.evaluated_at);
            check(result.digest===e.digest&&result.result===e.result&&result.observedAt===e.observed_at&&e.goal_revision<=g.revision,'Goal evaluation evidence differs');
            // The observation has simulation time, but no clock/profile stamp. Do not falsely place it into this simulation window.
            return[{id:`${g.goal_id}:${e.digest}`,result:result.result,observedAtWall:result.observedAt,evaluatedAtWall:e.evaluated_at as string,
                recordedSimulationTime:observation.simulationTime as string|null,simulationWindowPlacement:'unverified-clock-binding',
                source:'server-recorded-state-predicate-evaluation',observationDigest:result.digest}];
        }):[];
        return{goalId:g.goal_id as string,agentId:g.agent_id as string,statusAtSourceHead:g.status as string,
            completionBasis:objective?'state-predicate':execution?'successful-skill-runs':'manual-or-hierarchy',
            successfulSkillRuns:execution?.successful_runs as number|undefined??null,requiredSuccessfulSkillRuns:execution?.required_successful_runs as number|undefined??null,
            stateEvaluations:states,nativeStrategySuccessInSimulationWindow:null};
    });
    for(const r of [...relationships,...commitments])time(r.updatedAtWall);
    return{actors,social:{relationships,commitments,basis:'observer-owned memory at source head; wall timestamps, no simulation placement',
        globalTrust:null,tradeImpliesTrust:false},goals:{rows:goalOutcomes,transitions,basis:'Historical server-recorded state evaluations, independently recomputed; skill progress is separate.',
        completeStrategySuccessCoverage:false,limitation:'Stored economic observations lack historical native re-attestation and exact clock/profile stamps; no simulation-window success rate.'}};
}
