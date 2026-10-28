import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {NativeLifecyclePolicyStore} from '../population-lifecycle/native-policy.js';
import {readLineageSnapshot,lineagePrefixMatches,lineageStreams} from '../production-workflow/lineage-coverage.js';
import {readNativeTradeLedger} from '../external-trade/source.js';
import {SocietyIntegrityStore} from '../society-integrity/store.js';
import {readStableOutcomeStore,type NativeFounderBaseline} from './population-outcomes.js';
import {readNativeExternalValue} from './external-value.js';
import {readLineageEvidence} from './lineage-evidence.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {foodDigest} from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeOutcomeOptions} from './native-outcomes.js';
import type {MortalityActor} from '../population-lifecycle/native-coverage.js';

export function readNativeInternalLineage(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,baseline:NativeFounderBaseline,founders:MortalityActor[],
    observedExternal?:(ReturnType<typeof readNativeExternalValue>&{sourceSnapshotDigest:string})){
    const gaps=new Set<string>(),genesisAt=baseline.genesisAppliedAtSimulationTime;
    const attempt=<T>(name:string,run:()=>T):T|null=>{try{return run();}catch{gaps.add(`${name}-unavailable`);return null;}};
    const external=observedExternal??attempt('external-value',()=>readNativeExternalValue(db,scope,options,baseline,founders));
    if(observedExternal&&observedExternal.sourceSnapshotDigest!==createHash('sha256').update(db.serialize()).digest('hex'))gaps.add('external-parent-checkpoint-changed');
    const bound=external&&external.worldId===options.worldId&&digest(external.scope)===digest(scope)&&external.genesisResultId===baseline.genesisResultId
        &&external.genesisResultDigest===baseline.genesisResultDigest&&external.fromSimulationTime===genesisAt&&external.toSimulationTime===scope.toSimulationTime;
    if(!bound||!external?.completeExternalValueCoverage||external.verdict!=='pass')gaps.add('reviewed-native-producer-window');
    const snapshot=attempt('lineage-snapshot',()=>readLineageSnapshot(db)),policy=attempt('policy',()=>new NativeLifecyclePolicyStore(db).read()),
        frames=policy?.entries.filter(e=>e.sample.position.simulationTime>=genesisAt&&e.sample.position.simulationTime<=scope.toSimulationTime)??[];
    for(const [i,{sample:e}] of frames.entries()){
        const c=e.lineageCursor,prior=frames[i-1]?.sample.lineageCursor;
        if(!c||!snapshot||!lineagePrefixMatches(c,snapshot))gaps.add('native-lineage-prefix');
        if(c&&prior&&(lineageStreams.some(k=>c.streams[k].count<prior.streams[k].count)
            ||(Object.keys(c.openingCounts) as Array<keyof typeof c.openingCounts>).some(k=>c.openingCounts[k]<prior.openingCounts[k])))gaps.add('native-lineage-prefix-regression');
    }
    const opening=frames[0]?.sample,closing=frames.at(-1)?.sample,c=opening?.lineageCursor;
    if(!frames.length||opening?.position.simulationTime!==genesisAt||opening.stage!=='after-terminal-guard'
        ||closing?.position.simulationTime!==scope.toSimulationTime||closing.stage!=='end-of-tick')gaps.add('native-lineage-boundaries');
    if(!c||Object.values(c.openingCounts).some(n=>n!==0))gaps.add('nonempty-or-unbound-lineage-opening');
    if(c&&snapshot){if(snapshot.tables.native_food_lineage!.slice(0,c.streams.native_food_lineage.count).some(r=>JSON.parse(r.entry_json).fact.kind!=='opening')
        ||snapshot.tables.native_tool_event!.slice(0,c.streams.native_tool_event.count).some(r=>JSON.parse(r.payload).kind!=='explicit-opening'))gaps.add('historical-lineage-opening');}
    if(!snapshot||closing?.lineageCursor?.stateDigest!==snapshot.cursor.stateDigest)gaps.add('unsealed-lineage-state-or-tail');
    const trades=attempt('trades',()=>{if(!options.tradePath)throw Error('Trade path absent');return readStableOutcomeStore(options,options.tradePath,()=>({entries:readNativeTradeLedger(options.tradePath!)}));});
    const evidence=trades?attempt('lineage-evidence',()=>readLineageEvidence(db,{...scope,fromSimulationTime:genesisAt},options.worldId,founders,trades.entries,
        options.population!.configDirectory,f=>{
            const store=new SocietyIntegrityStore(options.population!.integrityPath,true);try{const proof=store.foodMutationOrigin(f.mutation);
                return !!proof&&proof.runId===baseline.genesisResultId&&proof.resultDigest===baseline.genesisResultDigest&&foodDigest(proof)===foodDigest(f.proof);}finally{store.close();}
        })):null;
    const windowComplete=gaps.size===0;
    for(const gap of evidence?.gaps??[])gaps.add(gap);
    const finalUses=evidence?.food?.chains.filter(c=>c.at>scope.fromSimulationTime&&c.at<=scope.toSimulationTime)??[];
    if(!finalUses.length)gaps.add('no-positive-distinct-consumer-chain');
    const violations=(evidence?.violations??[]).filter(v=>{
        const table=v.source==='tool-production'?'native_tool_event':'native_food_lineage',rows=attempt('violation-prefix',()=>{
            const count=(db.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;if(count>100000)throw Error('Row budget');return db.query(`SELECT * FROM ${table} ORDER BY rowid`).all() as any[];
        });
        const index=rows?.findIndex(r=>table==='native_tool_event'?r.event_id===v.eventId:[`production:${v.eventId}`,`consumption:${v.eventId}`,`trade:${v.eventId}`].includes(r.source_key))??-1;
        const sealed=index>=0&&frames.some(({sample:e})=>{const p=e.lineageCursor?.streams[table];return e.worldId===options.worldId&&e.position.clockId===scope.clockId
            &&e.position.profileDigest===scope.clockProfileDigest&&p&&p.count>index&&p.digest===digest(rows!.slice(0,p.count));});
        if(!sealed)gaps.add('unsealed-lineage-violation');return sealed;
    }),body={protocol:'native-internal-lineage-assessment-v1',scope,worldId:options.worldId,
        fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,genesisResultId:baseline.genesisResultId,genesisResultDigest:baseline.genesisResultDigest,
        completeFoodLineageCoverage:windowComplete&&!!evidence?.completeFoodEvidence,completeToolLineageCoverage:windowComplete&&!!evidence?.completeToolEvidence,
        completeInternalLineageCoverage:gaps.size===0,finalUses,maintenanceCycles:evidence?.tools?.cycles??[],sourceHead:closing?.lineageCursor??null,
        externalValueDigest:bound?external.digest:null,evidenceDigest:evidence?digest(evidence):null,gaps:[...gaps].sort(),violations,verdict:violations.length?'fail' as const:gaps.size?'inconclusive' as const:'pass' as const,
        meaning:'Full sealed native producer history and verified original-cohort food/material custody. Only actual distinct-consumer chains earn final-use credit; numeric daily/cycle minima remain separate.'};
    return{...body,digest:digest(body)};
}
