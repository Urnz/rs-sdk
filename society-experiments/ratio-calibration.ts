import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {NativeMiningIntentStore} from '../item-lifecycle/native-mining-intent.js';
import {nativeToolDigest} from '../item-lifecycle/native-tool.js';
import {NativeToolWorkStore} from '../production-workflow/native-tool-work.js';
import {readHousingSleep} from '../housing/native-sleep.js';
import {loadIntegrationFixture} from '../society-integration/fixture.js';
import {readFounderHousingResult} from './founder-housing-result.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {SimulationClockObservation} from '../simulation-clock/types.js';

function check(v:unknown,message:string):asserts v{if(!v)throw Error(`Ratio calibration: ${message}`);}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const normalized=(bytes:Uint8Array)=>Buffer.from(bytes).toString('utf8').replace(/\r\n?/g,'\n');
export function measureRatioInterval(start:SimulationClockObservation,end:SimulationClockObservation,rate:{simulationMilliseconds:number;wallMilliseconds:number}){
    check(Number.isSafeInteger(rate.simulationMilliseconds)&&rate.simulationMilliseconds>0&&Number.isSafeInteger(rate.wallMilliseconds)&&rate.wallMilliseconds>0,'invalid rate');
    check(start.clockId===end.clockId&&start.profileDigest===end.profileDigest&&start.revision===end.revision
        &&start.status==='running'&&end.status==='running','clock identity/revision differs');
    for(const c of [start,end])for(const s of [c.wallTime,c.simulationTime])check(Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s,'noncanonical timestamp');
    const wallMs=Date.parse(end.wallTime)-Date.parse(start.wallTime),simulationMs=Date.parse(end.simulationTime)-Date.parse(start.simulationTime),
        ticks=Number(end.engineTick)-Number(start.engineTick);
    check(start.engineTick!==null&&end.engineTick!==null&&Number.isSafeInteger(start.engineTick)&&Number.isSafeInteger(end.engineTick)
        &&start.engineTick>=0&&wallMs>0&&simulationMs>0&&ticks>0,'nonpositive or missing interval');
    check(BigInt(simulationMs)*BigInt(rate.wallMilliseconds)===BigInt(wallMs)*BigInt(rate.simulationMilliseconds),'observed clock rate differs');
    return{wallMs,simulationMs,engineTicks:ticks,wallMsPerTick:wallMs/ticks,simulationMsPerTick:simulationMs/ticks};
}

/** These are warnings, never a lower bound, a rate choice or a warmup PASS. */
export function projectWarmup(samples:readonly number[],uses:number,dayWallMs:number){
    check(samples.length>0&&samples.every(n=>Number.isFinite(n)&&n>0)&&Number.isSafeInteger(uses)&&uses>0&&dayWallMs>0,'invalid projection');
    const averageMs=samples.reduce((n,x)=>n+x,0)/samples.length;
    return{sampleCount:samples.length,requiredUses:uses,dayWallMs,minimumSampleMs:Math.min(...samples),maximumSampleMs:Math.max(...samples),
        meanSampleMs:averageMs,projectedSerialMs:averageMs*uses,exceedsDayAtSampleMean:averageMs*uses>dayWallMs,
        measuredWarmupUses:0,verdict:'unmeasured' as const,excludes:['initial travel','bank/inventory','changing Mining XP/chance','rest/food','orchestration']};
}

const clockPins=['simulation-clock/store.ts','simulation-clock/profile.ts','needs/survival.ts','server/engine/src/util/Environment.ts'];
function sourcePins(repository:string,workspace:string,expected:string,paths:string[]){
    const manifest=JSON.parse(readFileSync(join(workspace,'.local/simulation/integration-source.json'),'utf8'));
    check(manifest.digest===expected&&manifest.digest===digest(manifest.files),'frozen manifest differs');
    return paths.map(path=>{
        const pin=manifest.files.find((p:any)=>p.path===path),bytes=readFileSync(join(workspace,path)),current=readFileSync(join(repository,path));
        check(pin&&sha(bytes)===pin.sha256&&sha(normalized(bytes))===sha(normalized(current)),`producer drift: ${path}`);
        return{path,frozenSha256:pin.sha256,currentLfSha256:sha(normalized(current))};
    });
}
function fileHashes(paths:string[],repository:string){return paths.flatMap(path=>['','-wal'].flatMap(suffix=>{
    try{const bytes=readFileSync(path+suffix);if(suffix&&!bytes.length)return[];
        return[{path:path.slice(repository.length+1).replaceAll('\\','/'),suffix,sha256:sha(bytes)}];
    }catch(e){if(suffix&&(e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}
}));}
function read<T>(path:string,fn:(db:OwnedDatabase)=>T){const db=new OwnedDatabase(path,{readonly:true,strict:true});try{return fn(db);}finally{db.close(true);}}

/** Only the two explicitly reviewed local stages. Never enumerate historical backup databases. */
export function readNativeRatioCalibration(repository:string){
    repository=resolve(repository);
    const housingRelative='backups/si-c07-founder-housing-20261031-e/workspace',housingRoot=join(repository,housingRelative),
        review=JSON.parse(readFileSync(join(repository,'docs/project/SI_C07_FOUNDER_TRIAL_RESULT.json'),'utf8')),
        toolRelative='backups/si-c07-founder-trials-20261031-f/workspace',toolRoot=join(repository,toolRelative),
        expectedHousing=JSON.parse(readFileSync(join(repository,'docs/project/SI_C07_FOUNDER_HOUSING_RESULT.json'),'utf8')),
        {digest:reviewHash,...reviewBody}=review;
    check(review.workspace===toolRelative&&nativeToolDigest(reviewBody)===reviewHash,'review binding differs');
    const housingFixture=loadIntegrationFixture(join(housingRoot,'config/fixtures/society-lobster-four-v1.json')),
        toolFixture=loadIntegrationFixture(join(toolRoot,'config/fixtures/society-lobster-four-v1.json')),
        toolReceipt=JSON.parse(readFileSync(join(toolRoot,'.local/simulation/food-trial-fixture.json'),'utf8')),
        setup=JSON.parse(readFileSync(join(toolRoot,'.local/simulation/founder-procedure-setup.json'),'utf8')),{digest:setupHash,...setupBody}=setup;
    check(housingFixture.founderBaseline&&toolFixture.digest===review.fixtureDigest&&toolReceipt.worldId===review.worldId
        &&toolReceipt.acceptance==='draft-trial-only'&&toolReceipt.fixtureDigest===review.fixtureDigest&&nativeToolDigest(setupBody)===setupHash&&setupHash===review.setupDigest,'stage/fixture/setup binding differs');
    check(digest(housingFixture.clock.profile)===digest(toolFixture.clock.profile),'different timing profiles cannot be pooled');
    const housingProof=readFounderHousingResult(housingRoot);
    check(digest(housingProof)===digest(expectedHousing),'housing proof or DB changed');
    const pins={housing:sourcePins(repository,housingRoot,housingProof.sourceManifestDigest,[...clockPins,'agent-skills/society-travel.ts','server/engine/src/mods/NativeHousing.ts']),
        tool:sourcePins(repository,toolRoot,review.source.stageManifestDigest,[...clockPins,'server/engine/src/mods/NativeMiningTool.ts',
            'server/engine/src/mods/NativeToolWork.ts','item-lifecycle/native-mining-intent.ts','production-workflow/native-tool-work.ts','production-workflow/native-tool-work-policy.ts',
            'config/native-tool-work.json','config/item-repair-policies.json','config/production-workflows.json'])};
    const paths=[join(housingRoot,'server/engine/data/player-checkpoints.sqlite'),join(toolRoot,'server/engine/data/player-checkpoints.sqlite'),
        join(housingRoot,'.local/simulation/simulation-clock.sqlite'),join(toolRoot,'.local/simulation/simulation-clock.sqlite')],before=fileHashes(paths,repository),
        rate=housingFixture.clock.profile.rate;
    check(sha(readFileSync(paths[1]!))===review.sourceReadonlyDatabaseSha256,'tool checkpoint changed since the native review');
    for(const path of [paths[2]!,paths[3]!])read(path,db=>check((db.query('SELECT status,profile_digest FROM simulation_clock WHERE clock_id=?1').get(housingFixture.clock.clockId) as any)?.status==='paused'
        &&(db.query('SELECT profile_digest FROM simulation_clock WHERE clock_id=?1').get(housingFixture.clock.clockId) as any)?.profile_digest===housingProof.clock.profileDigest,'clock is not paused/exact'));
    const sleep=read(paths[0]!,db=>readHousingSleep(db)).sort((a,b)=>a.clock.wallTime.localeCompare(b.clock.wallTime));
    const housingInterval=measureRatioInterval(sleep[0]!.clock,sleep.at(-1)!.clock,rate);
    const live=JSON.parse(readFileSync(join(housingRoot,'.local/simulation/founder-housing-live.json'),'utf8'));
    const travel=live.routes.filter((r:any)=>r.username!=='silessor').map((r:any)=>{
        const run=JSON.parse(readFileSync(join(housingRoot,'.local/agent-skills/runs',`${r.runId}.json`),'utf8'));
        check(run.status==='completed'&&run.runId===r.runId&&run.username===r.username&&run.skill.id==='procedure.travel.native-sites'
            &&run.skill.version==='1.0.0'&&Number.isFinite(run.durationMs)&&run.durationMs>0,'travel run differs');
        return{username:r.username,runId:r.runId,wallMs:run.durationMs,simulationMs:run.durationMs*rate.simulationMilliseconds/rate.wallMilliseconds,
            bedArrivalWallMs:r.observation.durationMs,source:'SDK SkillRun duration; native arrival/payment/sleep independently verified'};
    });
    const native=read(paths[1]!,db=>{
        const {entries}=NativeMiningIntentStore.read(db),mining=[...new Set(entries.map(e=>e.record.intent.demandId))].map(id=>{
            const records=entries.filter(e=>e.record.intent.demandId===id).map(e=>e.record),first=records[0]!,last=records.at(-1)!;
            check(last.phase==='fulfilled'&&last.intent.owner.worldId===review.worldId&&last.intent.owner.clockProfileDigest===housingProof.clock.profileDigest,'foreign/incomplete Mining sample');
            const row=db.query('SELECT payload,digest FROM native_tool_event WHERE event_id=?1').get(last.completionEventId!) as any,event=row&&JSON.parse(row.payload);
            check(event&&nativeToolDigest(event)===row.digest&&event.kind==='mined'&&event.lifecycleAuditValid
                &&event.before.durability-event.after.durability===1&&event.source.outputQuantity===1,'Mining native output/wear differs');
            return{demandId:id,eventId:last.completionEventId,outputItemId:last.intent.outputItemId,...measureRatioInterval(first.sample.clock,last.sample.clock,rate)};
        });
        check((db.query('SELECT COUNT(*) n FROM native_tool_work_audit').get() as {n:number}).n<=100000,'work row bound exceeded');
        const work=NativeToolWorkStore.read(db).map(r=>{
            check(r.phase==='completed'&&r.result&&r.intent.owner.worldId===review.worldId&&r.intent.owner.clockProfileDigest===housingProof.clock.profileDigest,'foreign/incomplete work');
            const required=r.intent.kind==='repair'?600000:120000;
            check(r.progressMs===required&&r.workTicks>0&&(r.intent.kind!=='smelt'||r.workTicks>=3),'work policy/progress differs');
            return{operationId:r.intent.operationId,kind:r.intent.kind,...measureRatioInterval(r.started,r.last.clock,rate),
                creditedSimulationMs:r.progressMs,nativeWorkTicks:r.workTicks,qualifiesMaintenance:false,scope:'timing only; original declared trial inputs/damage'};
        });return{mining,work};
    });
    check(native.mining.length===2&&native.work.length===4&&travel.length===3&&sleep.length===4,'reviewed sample counts differ');
    const minimum=JSON.parse(readFileSync(join(repository,'config/society-minimum-policy.json'),'utf8')),
        candidate=JSON.parse(readFileSync(join(repository,'docs/project/SI_C07_FOUNDER_BASELINE.json'),'utf8')),
        dayWallMs=minimum.window.warmupSimulationMilliseconds*rate.wallMilliseconds/rate.simulationMilliseconds;
    check(minimum.window.warmupSimulationMilliseconds===86400000&&candidate.toolPlan.warmupRequiredSuccessfulUses===51,'original warmup plan differs');
    const after=fileHashes(paths,repository);check(digest(before)===digest(after),'readonly DB/WAL bytes changed');
    const body={protocol:'si-c07-native-ratio-calibration-v1',status:'incomplete' as const,readyForRunApproval:false,qualifiesMinimum:false,
        rate,dayWallMs,collectorPins:['society-experiments/ratio-calibration.ts','scripts/calibrate-society-ratio.ts'].map(path=>({path,currentLfSha256:sha(normalized(readFileSync(join(repository,path))))})),
        source:{housing:{workspace:housingRelative,worldId:housingProof.worldId,resultDigest:housingProof.digest},
            tool:{workspace:toolRelative,worldId:review.worldId,resultDigest:reviewHash,setupDigest:setupHash},pins},
        observations:{housingInterval,sleepWitnessCount:sleep.length,travel,...native},
        projection:projectWarmup(native.mining.map(m=>m.wallMs),51,dayWallMs),
        remainingEvidence:['actual-51-use-warmup-from-original-opening','native-food-harvest-cook-meal-timing','combined-needs-rest-work-credit-schedule'],
        nativeFiles:before,readonlyUnchanged:true,providerCalls:0,providerCostMicros:0,
        limits:['Selected current producer/config pins only; not the final transitive runtime/environment manifest.',
            'Independent worlds are timing samples, not a combined economic history. No ratio is selected or validated by extrapolation.',
            'SHM and zero-byte WAL metadata omitted; every DB and nonempty WAL is hashed.']};
    return{...body,digest:digest(body)};
}

/** Preflight consumes an explicit partial result without opening any trial database or granting execution. */
export function readRatioCalibrationSummary(repository:string,expectedRate?:{simulationMilliseconds:number;wallMilliseconds:number}){
    let report:any;try{report=JSON.parse(readFileSync(join(repository,'docs/project/SI_C07_RATIO_CALIBRATION_RESULT.json'),'utf8'));}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{status:'missing' as const,readyForRunApproval:false};throw e;}
    const {digest:hash,...body}=report;
    check(hash===digest(body)&&report.protocol==='si-c07-native-ratio-calibration-v1'&&report.status==='incomplete'
        &&report.readyForRunApproval===false&&report.qualifiesMinimum===false&&Array.isArray(report.collectorPins)
        &&Array.isArray(report.source?.pins?.housing)&&Array.isArray(report.source?.pins?.tool),'invalid summary artifact');
    if(expectedRate&&digest(expectedRate)!==digest(report.rate))return{status:'profile-mismatch' as const,readyForRunApproval:false};
    for(const pin of [...report.collectorPins,...report.source.pins.housing,...report.source.pins.tool]){
        check(typeof pin.path==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(pin.path)&&!pin.path.includes('..'),'unsafe source path');
        if(sha(normalized(readFileSync(join(repository,pin.path))))!==pin.currentLfSha256)return{status:'stale' as const,readyForRunApproval:false};
    }
    return{status:'incomplete' as const,digest:hash,readyForRunApproval:false,dayWallMs:report.dayWallMs,
        nativeMiningSamples:report.observations.mining.length,nativeWorkSamples:report.observations.work.length,
        projectedWarmupWallMs:report.projection.projectedSerialMs,remainingEvidence:report.remainingEvidence};
}
