import { join } from 'node:path';
import { readFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { digest } from '../external-trade/policy.js';
import { check } from '../external-trade/source.js';
import { NativeToolWorkStore } from '../production-workflow/native-tool-work.js';
import { NativeMaterialStore } from '../production-workflow/native-material.js';
import { NativeMortalityCoverageStore } from '../population-lifecycle/native-coverage.js';
import { NativeLifecycleAttemptStore } from '../population-lifecycle/native-attempts.js';
import { NativeLifecycleWatermarkStore } from '../population-lifecycle/native-watermarks.js';
import { NativeLifecyclePolicyStore } from '../population-lifecycle/native-policy.js';
import { lifecycleRouteManifest,lifecyclePolicyFiles } from '../population-lifecycle/native-policy-manifest.js';
import { PolicyMutationStore } from '../population-lifecycle/policy-mutations.js';
import { WorldPolicyRuntimeStore } from '../population-lifecycle/world-policy-runtime.js';
import { pinPolicyEnvironment } from '../population-lifecycle/policy-environment.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import { assertFoodProductionSchema } from '../server/engine/src/mods/NativeFoodProductionStore.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../agent-state/types.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
import { readWorkBindings } from '../business-work/binding.js';
import { NativeMiningIntentStore } from '../item-lifecycle/native-mining-intent.js';
import { NativeMiningCoverageStore } from '../item-lifecycle/native-mining-coverage.js';
import { NativeMiningRequestStore } from '../item-lifecycle/native-mining-requests.js';
import { readNativeMiningCohortCoverage } from '../society-metrics/tool-demand-coverage.js';
import { NativeMiningDispatchStore } from '../item-lifecycle/native-mining-dispatch.js';
import { captureSocietyArchive,verifySocietyArchive,restoreSocietyArchive,offlineArchiveIO as io,type ArchiveManifest } from './archive.js';
import type { LongExperimentPlan } from './plan.js';

export const EXPANDED_BASELINE_PROTOCOL='society-expanded-baseline-v1';
export interface ExpandedSelection {
    worldId:string;clockId:string;clockProfileDigest:string;seed:string;runId:string;
    provider:{provider:string;model:string;reasoningEffort:string|null};
    reportVersion:string;
    stores:Array<{role:string;path:string;requiredTables:string[]}>;
}
function selection(raw:ExpandedSelection){
    check(raw&&raw.worldId&&raw.clockId&&raw.runId&&raw.seed&&/^[a-f0-9]{64}$/.test(raw.clockProfileDigest)
        &&raw.provider?.provider&&raw.provider.model&&raw.reportVersion==='si-c05.v1','Invalid expanded baseline selection');
    check(Array.isArray(raw.stores)&&raw.stores.length>0&&raw.stores.length<=64
        &&new Set(raw.stores.map(s=>s.role)).size===raw.stores.length&&new Set(raw.stores.map(s=>s.path)).size===raw.stores.length,'Invalid source coverage');
    check(raw.stores.some(s=>s.role==='clock'&&s.requiredTables.includes('simulation_clock')),'Native clock coverage required');
    for(const store of raw.stores){io.safePath(store.path);
        check(store.path.endsWith('.sqlite')&&(store.path.startsWith('.local/')||store.path.startsWith('server/engine/data/')),'Store outside archive state roots');
        check(store.requiredTables.length>0&&store.requiredTables.every(t=>/^[a-z][a-z0-9_]*$/.test(t)),'Invalid required native tables');}
    return structuredClone(raw);
}
function stores(root:string,selected:ExpandedSelection){
    return selected.stores.map(s=>{const path=join(root,s.path);io.ancestors(path);io.plain(path,false);
        const db=new OwnedDatabase(path,{readonly:true,strict:true});
        try{let result!: {role:string;path:string;userVersion:number;schemaDigest:string;stateDigest:string};db.transaction(()=>{
            const schema=db.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as {type:string;name:string;sql:string}[];
            for(const table of s.requiredTables)check(schema.some(r=>r.type==='table'&&r.name===table),`Missing required native table: ${s.role}/${table}`);
            if(s.requiredTables.includes('native_tool_work'))for(const job of NativeToolWorkStore.read(db))check(job.intent.owner.worldId===selected.worldId
                &&job.intent.owner.clockId===selected.clockId&&job.intent.owner.clockProfileDigest===selected.clockProfileDigest,'Native work belongs to another world/clock');
            if(s.requiredTables.includes('native_material_event'))for(const {fact} of NativeMaterialStore.read(db).entries)check(fact.owner.worldId===selected.worldId
                &&fact.owner.clockId===selected.clockId&&fact.owner.clockProfileDigest===selected.clockProfileDigest,'Native materials belong to another world/clock');
            if(s.requiredTables.includes('native_mortality_selection')){const {selection}=new NativeMortalityCoverageStore(db).read();
                check(selection.worldId===selected.worldId&&selection.clockId===selected.clockId&&selection.clockProfileDigest===selected.clockProfileDigest,
                    'Native mortality coverage belongs to another world/clock');}
            if(s.requiredTables.includes('native_lifecycle_selection')){const {mortality}=new NativeLifecycleAttemptStore(db).read();
                check(mortality.worldId===selected.worldId&&mortality.clockId===selected.clockId&&mortality.clockProfileDigest===selected.clockProfileDigest,
                    'Native lifecycle attempts belong to another world/clock');}
            if(s.requiredTables.includes('native_lifecycle_watermark_selection')){const {mortality,selection,entries}=new NativeLifecycleWatermarkStore(db).read(),
                attempts=new NativeLifecycleAttemptStore(db).read(),passes=new NativeMortalityCoverageStore(db).read(),
                prefix=(h:{sequence:number;digest:string|null},events:Array<{sequence:number;digest:string}>)=>h.sequence===0?h.digest===null:events[h.sequence-1]?.digest===h.digest;
                check(mortality.worldId===selected.worldId&&mortality.clockId===selected.clockId&&mortality.clockProfileDigest===selected.clockProfileDigest,
                    'Native lifecycle watermarks belong to another world/clock');
                check(prefix(selection.openingAttemptCursor.head,attempts.entries)&&entries.every(e=>prefix(e.sample.attemptHead,attempts.entries)
                    &&prefix(e.sample.mortalityHead,passes.entries)),'Native lifecycle watermark source prefix differs');}
            if(s.requiredTables.includes('native_lifecycle_policy_selection')){const {mortality,selection:policy,entries}=new NativeLifecyclePolicyStore(db).read(),
                watermarks=new NativeLifecycleWatermarkStore(db).read(),passes=new NativeMortalityCoverageStore(db).read(),
                prefix=(h:{sequence:number;digest:string|null},events:Array<{sequence:number;digest:string}>)=>h.sequence===0?h.digest===null:events[h.sequence-1]?.digest===h.digest;
                check(mortality.worldId===selected.worldId&&mortality.clockId===selected.clockId&&mortality.clockProfileDigest===selected.clockProfileDigest,'Native lifecycle policy belongs to another world/clock');
                check(digest(lifecycleRouteManifest(root))===digest(policy.manifest)&&digest(lifecyclePolicyFiles(root))===digest(policy.opening.files),'Native lifecycle policy source pin differs');
                check(entries.every(e=>prefix(e.sample.watermarkHead,watermarks.entries)&&prefix(e.sample.mortalityHead,passes.entries)),'Native lifecycle policy source prefix differs');}
            if(s.requiredTables.includes('policy_mutation_selection')){const mutations=new PolicyMutationStore(db).read(),p=mutations.selection,
                checkpoint=selected.stores.find(s=>s.requiredTables.includes('native_lifecycle_policy_selection'));
                check(p.worldId===selected.worldId&&p.clockId===selected.clockId&&p.clockProfileDigest===selected.clockProfileDigest&&checkpoint,'Policy mutation selected world/clock differs');
                const authority=new OwnedDatabase(join(root,checkpoint.path),{readonly:true,strict:true});
                try{check(nativeToolDigest(new NativeLifecyclePolicyStore(authority).selection().selection)===p.policySelectionDigest,'Policy mutation authority pin differs');}
                finally{authority.close(true);}}
            if(s.requiredTables.includes('world_policy_runtime_contract')){const p=new PolicyMutationStore(db).selection();new WorldPolicyRuntimeStore(db).read();
                check(p.worldId===selected.worldId&&p.clockId===selected.clockId&&p.clockProfileDigest===selected.clockProfileDigest,'Policy runtime selected world/clock differs');}
            if(s.requiredTables.includes('native_food_production_schema'))assertFoodProductionSchema(db);
            if(s.requiredTables.includes('native_mining_request_selection')){const requests=new NativeMiningRequestStore(db).read(),owner=requests.selection;
                check(owner.worldId===selected.worldId&&owner.clockId===selected.clockId&&owner.clockProfileDigest===selected.clockProfileDigest,'Executor requests belong to another world/clock');}
            if(s.requiredTables.includes('native_mining_intent_state'))for(const {record} of NativeMiningIntentStore.read(db).entries)
                check(record.intent.owner.worldId===selected.worldId&&record.intent.owner.clockId===selected.clockId
                    &&record.intent.owner.clockProfileDigest===selected.clockProfileDigest,'Native mining demand belongs to another world/clock');
            if(s.requiredTables.includes('native_mining_coverage_selection')){
                const cohort=new NativeMiningCoverageStore(db).selection();
                check(cohort.worldId===selected.worldId&&cohort.clockId===selected.clockId&&cohort.clockProfileDigest===selected.clockProfileDigest,
                    'Native Mining cohort belongs to another world/clock');
                readNativeMiningCohortCoverage(db,{clockId:cohort.clockId,clockProfileDigest:cohort.clockProfileDigest,
                    fromSimulationTime:cohort.fromSimulationTime,toSimulationTime:cohort.toSimulationTime,actorAgentIds:cohort.actors.map(a=>a.actorId)},
                    cohort.worldId,cohort.actors.map(a=>({agentId:a.actorId,username:a.username,lifecycleId:a.lifecycleId})));
            }
            if(s.requiredTables.includes('business_work_binding'))readWorkBindings(db);
            if(s.requiredTables.includes('native_mining_dispatch'))for(const record of new NativeMiningDispatchStore(db).read())
                check(record.owner.worldId===selected.worldId&&record.owner.clockId===selected.clockId
                    &&record.owner.clockProfileDigest===selected.clockProfileDigest,'Native Mining dispatch belongs to another world/clock');
            if(s.role==='needs')check((db.query('SELECT version FROM needs_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported needs schema');
            if(s.role==='clock'){const clock=db.query('SELECT status,profile_digest FROM simulation_clock WHERE clock_id=?').get(selected.clockId) as {status:string;profile_digest:string}|null;
                check(clock?.status==='paused'&&clock.profile_digest===selected.clockProfileDigest,'Expanded baseline requires exact paused native clock');}
            const userVersion=(db.query('PRAGMA user_version').get() as {user_version:number}).user_version;
            if(s.role==='agent')check(userVersion===AGENT_STATE_SCHEMA_VERSION,'Unsupported expanded AgentState schema; migrate before preparing');
            if(s.role==='clock')check(userVersion===SIMULATION_CLOCK_STORE_SCHEMA_VERSION,'Unsupported expanded clock schema');
            result={role:s.role,path:s.path,userVersion,
                schemaDigest:digest(schema),stateDigest:ioHash(db.serialize())};
        }).deferred();return result;}finally{db.close(true);}
    });
}
const ioHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function environment(files:ArchiveManifest['files'],sourceTreeDigest:string){
    return{sourceTreeDigest,configurationDigest:digest(files.filter(f=>f.path.startsWith('config/')||f.path.startsWith('server/engine/data/config/')
        ||['.local/admin/llm-runtime.json','.local/admin/world-director.json','.local/admin/world-mod-state.json'].includes(f.path))),
        packedDigest:digest(files.filter(f=>f.path.startsWith('server/engine/data/pack/')))};
}
/** Explicit prepare, while offline: no migration, clock observation or missing-store initialization. */
export function prepareExpandedBaseline(root:string,input:ExpandedSelection){
    const selected=selection(input);
    const providerPath=['.local/admin/llm-runtime.json','config/llm-runtime.json'].map(p=>join(root,p)).find(p=>existsSync(p));
    check(providerPath,'Pinned provider configuration missing');io.ancestors(providerPath);
    const provider=JSON.parse(readFileSync(providerPath,'utf8'));
    check(provider.provider===selected.provider.provider&&provider.model===selected.provider.model
        &&(provider.reasoningEffort??null)===selected.provider.reasoningEffort,'Declared provider/model differs from native configuration');
    const sources=stores(root,selected),inventory=io.inventory(root);
    check(sources.every(s=>inventory.files.some(f=>f.path===s.path)),'Required source escapes archive coverage');
    if(selected.stores.some(s=>s.requiredTables.includes('native_lifecycle_policy_selection'))){
        const manifest=lifecycleRouteManifest(root),files=lifecyclePolicyFiles(root);
        check(manifest.sources.every(p=>inventory.sourceFiles.includes(p.path)&&inventory.files.some(f=>f.path===p.path&&f.sha256===p.sha256&&f.size===p.bytes))
            &&files.filter(p=>p.sha256!==null).every(p=>inventory.files.some(f=>f.path===p.path&&f.sha256===p.sha256&&f.size===p.bytes)),'Lifecycle policy pin escapes archive inventory');}
    const mutationSource=selected.stores.find(s=>s.requiredTables.includes('policy_mutation_selection'));
    if(mutationSource){const db=new OwnedDatabase(join(root,mutationSource.path),{readonly:true,strict:true});
        try{const selection=new PolicyMutationStore(db).selection(),pin=selection.environment,current=pinPolicyEnvironment(inventory,{bunVersion:Bun.version,platform:process.platform},!!selection.worldPolicyRuntimeContractDigest);
            check(digest(pin)===digest(current),'Policy mutation environment inventory differs');}
        finally{db.close(true);}}
    const definition={protocol:EXPANDED_BASELINE_PROTOCOL,selection:selected,environment:environment(inventory.files,inventory.sourceTreeDigest),stores:sources};
    return{...definition,digest:digest(definition)};
}
export type ExpandedBaselinePin=ReturnType<typeof prepareExpandedBaseline>;
interface ExpandedEvidence {protocol:typeof EXPANDED_BASELINE_PROTOCOL;pin:ExpandedBaselinePin;baselineDigest:string|null;stores:ReturnType<typeof stores>}
function evidence(manifest:ArchiveManifest):ExpandedEvidence {
    const e=manifest.baselineEvidence as ExpandedEvidence;check(e?.protocol===EXPANDED_BASELINE_PROTOCOL,'Expanded baseline evidence required');
    const {digest:hash,...definition}=e.pin;selection(e.pin.selection);check(hash===digest(definition)&&e.pin.protocol===EXPANDED_BASELINE_PROTOCOL,'Expanded pin digest differs');
    check(e.pin.selection.runId===manifest.plan.sessionId,'Expanded pin run differs');
    check(digest(environment(manifest.files,manifest.sourceTreeDigest))===digest(e.pin.environment),'Pinned source/config/cache differs');
    for(const s of e.pin.selection.stores)check(manifest.files.some(f=>f.path===s.path),'Required archived store missing');
    check(manifest.kind==='baseline'?e.baselineDigest===null&&digest(e.stores)===digest(e.pin.stores):/^[a-f0-9]{64}$/.test(e.baselineDigest??''),'Baseline/result link invalid');
    return e;
}
/** Reuse the strict v1 transport; evidence describes stronger, explicit SI-C06 coverage. */
export function captureExpandedArchive(options:{root:string;output:string;kind:'baseline'|'result';plan:LongExperimentPlan;pin:ExpandedBaselinePin;
    baselineBundle?:string;assertOffline():void;readReport?(root:string):unknown;validateBaseline?():void}){
    const selected=selection(options.pin.selection);
    check(selected.runId===options.plan.sessionId,'Expanded plan run differs');
    let baselineDigest:string|null=null;
    if(options.kind==='result'){check(options.baselineBundle,'Expanded result requires its baseline bundle');const baseline=verifyExpandedArchive(options.baselineBundle);
        check(baseline.kind==='baseline'&&digest(evidence(baseline).pin)===digest(options.pin)&&digest(baseline.plan)===digest(options.plan),'Result baseline/pin/plan differs');baselineDigest=baseline.digest;
    }
    return captureSocietyArchive({...options,readBaselineEvidence:root=>{
        const current=prepareExpandedBaseline(root,selected);
        check(digest(current.environment)===digest(options.pin.environment),'Pinned source/config/cache drift; prepare a new baseline');
        if(options.kind==='baseline')check(current.digest===options.pin.digest,'Dirty baseline state or schema differs');
        else check(digest(current.stores.map(({stateDigest,...s})=>s))===digest(options.pin.stores.map(({stateDigest,...s})=>s)),'Native store schema drift requires an explicit new baseline');
        const attestation:ExpandedEvidence={protocol:EXPANDED_BASELINE_PROTOCOL,pin:options.pin,baselineDigest,stores:current.stores};return attestation;
    }});
}
export function validateExpandedManifest(manifest:ArchiveManifest){evidence(manifest);return manifest;}
export function verifyExpandedArchive(bundle:string){return validateExpandedManifest(verifySocietyArchive(bundle));}
export function expandedArchiveSelection(manifest:ArchiveManifest){return evidence(manifest).pin.selection;}
/** Native store/schema/state re-read happens in unpublished staging, preserving both source and bundle. */
export function restoreExpandedArchive(bundle:string,output:string,readReport?:(root:string)=>unknown){
    return restoreSocietyArchive(bundle,output,(root,m)=>validateExpandedRestore(root,m,readReport));
}
export function validateExpandedRestore(root:string,m:ArchiveManifest,readReport?:(root:string)=>unknown){
    const e=evidence(m);check(digest(stores(root,e.pin.selection))===digest(e.stores),'Restored native state/schema differs');
    if(m.kind==='result'){check(readReport,'Expanded result restore requires native report reader');check(digest(readReport(root))===digest(m.report),'Restored native report differs');}
}
export function compareExpandedArchives(baselineBundle:string,resultBundle:string){
    const baseline=verifyExpandedArchive(baselineBundle),result=verifyExpandedArchive(resultBundle),b=evidence(baseline),r=evidence(result);
    check(baseline.kind==='baseline'&&result.kind==='result'&&r.baselineDigest===baseline.digest&&b.pin.digest===r.pin.digest
        &&digest(baseline.plan)===digest(result.plan),'Unrelated baseline/result archives');
    return{protocol:EXPANDED_BASELINE_PROTOCOL,baselineDigest:baseline.digest,resultDigest:result.digest,pinDigest:b.pin.digest,
        archiveEvidenceComparable:true,engineRandomStreamSeeded:false,externalResponsesReplayable:false,bitIdenticalWorldRerun:false,
        causalEffectEstablished:false,completeWorldCoverage:false,selectedSourceRoles:b.pin.selection.stores.map(s=>s.role),reportVersion:b.pin.selection.reportVersion};
}
