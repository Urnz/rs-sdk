import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readDatabase, check } from '../external-trade/source.js';
import { digest, time } from '../external-trade/policy.js';
import { validateWorldGenesisResult } from '../world-genesis/result.js';
import { populationMembersFromGenesis } from '../population-lifecycle/genesis.js';
import { loadWorldGenesisProfileCatalog } from '../world-genesis/config.js';
import { loadPopulationLifecyclePolicyCatalog, loadPopulationWorldProfileBindingCatalog } from '../population-lifecycle/config.js';
import { resolvePopulationGenesis } from '../population-lifecycle/genesis.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../agent-state/types.js';
import { generateNpcAttributeProfile, loadAttributeBudgetPolicyCatalog, loadAttributeAllocationPolicyCatalog } from '../character-attributes/index.js';
import { validateExperimentParameterProfile } from '../server/gateway/admin/experiment-parameters.js';
import type { LongExperimentPlan } from './plan.js';
import { SocietyIntegrityStore } from '../society-integrity/store.js';

export interface LongExperimentSources { genesisPath: string; agentPath: string; parameterPath: string; clockPath: string; configDirectory: string; integrityPath:string }
/** Read-only native binding; no missing files, memberships or past attribute profiles are fabricated. */
export function readLongExperimentBinding(plan: LongExperimentPlan, paths: LongExperimentSources) {
    const result = readDatabase(paths.genesisPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === 1, 'Unsupported genesis source');
        const row = db.query('SELECT * FROM world_genesis_application WHERE result_id=?1').get(plan.genesisResultId) as any;
        check(row?.status === 'applied' && row.receipt_json && row.result_digest === plan.genesisResultDigest, 'Long experiment requires exact applied genesis');
        const result = validateWorldGenesisResult(JSON.parse(row.result_json));
        check(result.resultDigest === row.result_digest && result.resultId === plan.genesisResultId, 'Native genesis binding differs'); return result;
    });
    const config = (name: string) => join(paths.configDirectory,name);
    const resolved = resolvePopulationGenesis(result, loadWorldGenesisProfileCatalog(config('world-genesis-profiles.json')),
        loadPopulationLifecyclePolicyCatalog(config('population-lifecycle-policies.json')), loadPopulationWorldProfileBindingCatalog(config('population-world-profile-bindings.json')));
    check(resolved.policy?.kind === 'finite', 'Long society experiments require finite population policy');
    const roster = populationMembersFromGenesis(result,true); check(roster.length >= 2 && roster.length <= 50, 'Phase 12 requires 2-50 founders');
    const integrityStore=new SocietyIntegrityStore(paths.integrityPath,true);
    let integrity;
    try{integrity=integrityStore.report(result.resultId);}finally{integrityStore.close();}
    check(integrity.run.resultDigest===result.resultDigest && integrity.run.status==='observing' && !integrity.run.invalidated
        && integrity.injectionCount===0,'Native society integrity is reset or contaminated');
    const integrityBinding={runId:integrity.run.runId,resultDigest:integrity.run.resultDigest,invalidateOnInjection:integrity.run.invalidateOnInjection,
        genesisAppliedAtSimulationTime:integrity.run.genesisAppliedAtSimulationTime};
    const founders = readDatabase(paths.agentPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === AGENT_STATE_SCHEMA_VERSION, 'Unsupported AgentState source');
        const actual = db.query("SELECT * FROM agent_population_member WHERE source_result_id=?1 AND status='active' ORDER BY agent_id").all(result.resultId) as any[];
        check(digest(actual.map(row => ({agentId:row.agent_id,playerUsername:row.player_username}))) === digest(roster), 'Native founder roster differs');
        return roster.map(member => {
            const row = actual.find(row => row.agent_id === member.agentId)!, identity = db.query('SELECT * FROM agent_identity WHERE agent_id=?1').get(member.agentId) as any,
                life = db.query('SELECT * FROM agent_character_lifecycle WHERE agent_id=?1').get(member.agentId) as any,
                control = db.query(`SELECT role,subject_kind,subject_id,avatar_player_username,decision_interval_ms,max_decisions_per_day,
                    daily_llm_budget_micros,daily_operational_budget_gp FROM agent_control_profile WHERE agent_id=?1`).get(member.agentId) as any;
            check(identity?.player_username === member.playerUsername && life && row.source_result_digest === result.resultDigest
                && row.simulation_clock_id === result.simulationClock.clockId && row.simulation_clock_profile_digest === result.simulationClock.profileDigest
                && row.world_profile_digest === result.profile.digest && row.world_profile_id===result.profile.profileId && row.world_profile_version===result.profile.version
                && row.lifecycle_policy_digest === resolved.policy!.digest && row.lifecycle_policy_id===resolved.policy!.policyId && row.lifecycle_policy_version===resolved.policy!.version
                && control?.role==='player' && control.subject_kind==='player' && control.subject_id===member.playerUsername
                && control.avatar_player_username===member.playerUsername, 'Native founder identity/profile binding differs');
            time(life.created_at_simulation_time); return {...member,lifecycleCreatedAtSimulationTime:life.created_at_simulation_time,control};
        });
    });
    const budgets = loadAttributeBudgetPolicyCatalog(config('attribute-budget-policies.json')).policies.filter(row => row.policyId === plan.attributeBudgetPolicyId),
        allocations = loadAttributeAllocationPolicyCatalog(config('attribute-allocation-policies.json')).policies.filter(row => row.policyId === plan.attributeAllocationPolicyId);
    check(budgets.length===1 && allocations.length===1, 'Exact attribute generation policies unavailable or ambiguous');
    const budget=budgets[0]!,allocation=allocations[0]!;
    // These immutable declared inputs do not claim engine-side aptitude enforcement.
    const attributeInputs = founders.map(member => generateNpcAttributeProfile(budget,allocation,{seed:result.seed,
        characterAgentId:member.agentId,lifecycleCreatedAtSimulationTime:member.lifecycleCreatedAtSimulationTime}));
    const parameterProfile = readDatabase(paths.parameterPath, db => {
        const row = db.query('SELECT * FROM experiment_parameter_profile WHERE profile_id=?1 AND version=?2').get(plan.parameterProfileId,plan.parameterProfileVersion) as any;
        check(row, 'Native Phase 12 parameter profile unavailable');
        const profile = validateExperimentParameterProfile({profileId:row.profile_id,version:row.version,label:row.label,description:row.description,
            origin:row.origin,parameters:JSON.parse(row.parameters_json)},row.created_at);
        check(profile.digest === row.digest && profile.digest === plan.parameterProfileDigest, 'Parameter profile digest differs'); return profile;
    });
    const configNames = readdirSync(paths.configDirectory).filter(name=>name.endsWith('.json')).sort();
    check(configNames.length > 0 && configNames.length <= 200, 'Configuration snapshot exceeds limits');
    const policySnapshot = configNames.map(name => ({name,digest:digest(JSON.parse(readFileSync(config(name),'utf8')))}));
    const definition = {schemaVersion:1,genesis:result,founders,attributeInputs,attributeDistributionDigest:digest(attributeInputs),
        attributeAuthority:'declared-seeded-input-not-engine-enforcement', parameterProfile,policySnapshot,
        lifecyclePolicy:resolved.policy,worldProfile:resolved.profile,integrityBinding};
    const {generatedAtAudit:_audit,...genesisCondition}=result;
    return {...definition,integrityResolved:integrity.passesObservedInjectionGate,conditionDigest:digest({...definition,genesis:genesisCondition}),sourcePathsDigest:digest(Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,resolve(path)])))};
}
export type LongExperimentBinding = ReturnType<typeof readLongExperimentBinding>;
