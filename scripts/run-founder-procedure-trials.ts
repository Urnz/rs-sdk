import {parseArgs} from 'node:util';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,symlinkSync,unlinkSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {founderTrialSource,prepareFounderProcedureTrials} from '../society-experiments/founder-procedure-trials.js';
import {FOUNDER_TRIAL_PROCEDURES} from '../society-experiments/founder-procedure-trials.js';
import {SkillTrialStore} from '../agent-skills/trials.js';
import {SkillRegistry} from '../agent-skills/registry.js';
import {draftTrialAuthorization} from '../agent-skills/food-trials.js';
import {reviewSkillTrial,readSkillTrialReview} from '../agent-skills/trial-review.js';
import {SimulationClockStore} from '../simulation-clock/store.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';

const {values}=parseArgs({strict:true,options:{root:{type:'string'},phase:{type:'string',default:'tin'},runs:{type:'string',default:'1'}}});
if(!values.root||!['tin','all','inspect'].includes(values.phase!)||!['1','2'].includes(values.runs!))throw Error('Usage: --root NEW_FOUNDER_TRIAL_WORKSPACE --phase tin|all|inspect --runs 1|2');
const source=founderTrialSource(values.root),root=source.workspace,sourceRoot=resolve(import.meta.dir,'..');
if(root===sourceRoot||!relative(sourceRoot,root).replaceAll('\\','/').startsWith('backups/'))throw Error('Live procedure trials require their own new backups/ workspace');
const setup=JSON.parse(readFileSync(join(root,'.local/simulation/founder-procedure-setup.json'),'utf8')),{digest,...setupBody}=setup;
if(digest!==hash(setupBody)||setup.worldId!==source.worldId||setup.qualifiesMinimum!==false)throw Error('Founder trial setup differs');
const config=JSON.parse(readFileSync(join(root,'config/llm-runtime.json'),'utf8'));
if(config.enabled||config.automaticReplanning||config.autonomousExecution.enabled||config.skillBuilder.enabled)throw Error('Live procedure trials require provider and autonomy off');
const logs=join(root,'.local/verification',`founder-live-${Date.now()}`);mkdirSync(logs,{recursive:true});
const started=Date.now(),maximumMs=values.phase==='all'?480000:90000;
const phases:{phase:string;elapsedMs:number;[key:string]:unknown}[]=[],phase=(name:string,extra:Record<string,unknown>={})=>{
    const row={phase:name,elapsedMs:Date.now()-started,...extra};phases.push(row);console.log(JSON.stringify(row));
    writeFileSync(join(logs,'phases.json'),JSON.stringify(phases,null,2));
};
const leases=Array.from({length:6},()=>Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(null,{status:503})}));
const ports=leases.map(s=>s.port!);for(const s of leases)s.stop(true); // Release all handles before spawning Windows workers.
const key=generateKeyPairSync('rsa',{modulusLength:1024}),jwk=key.publicKey.export({format:'jwk'}),decimal=(s:string)=>BigInt(`0x${Buffer.from(s,'base64url').toString('hex')}`).toString();
const publicKeyPath=join(root,'server/engine/data/config/public.pem');
if(existsSync(publicKeyPath))throw Error('Trial runtime public key already exists; preserve and reconcile it');
writeFileSync(publicKeyPath,key.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
const token=randomBytes(32).toString('hex'),generation=randomUUID(),password=randomBytes(8).toString('hex'); // Native login accepts at most20 characters.
const env={...process.env,CONTROL_PLANE_SERVER_ID:source.worldId,MANAGED_WORKSPACE:root,MANAGED_GENERATION:generation,MANAGED_CONTROL_TOKEN:token,ENGINE_ADMIN_TOKEN:token,
    AGENT_PORT:String(ports[0]),WEB_PORT:String(ports[1]),WEB_MANAGEMENT_PORT:String(ports[2]),NODE_PORT:String(ports[3]),
    ENGINE_ADMIN_URL:`http://127.0.0.1:${ports[1]}`,ENGINE_PUBLIC_URL:`http://127.0.0.1:${ports[1]}/mapview/`,GATEWAY_URL:`ws://127.0.0.1:${ports[0]}`,SERVER:`127.0.0.1:${ports[1]}`,
    LOGIN_RSAN:decimal(jwk.n!),LOGIN_RSAE:decimal(jwk.e!),RS_SDK_LITE_CACHE_DIR:join(root,'.local/lite-cache'),
    PLAYER_CHECKPOINT_DATABASE:'data/player-checkpoints.sqlite',GE_DATABASE:'data/player-checkpoints.sqlite',TRADE_EVIDENCE_DB:'data/mods/trade-evidence.sqlite',PLAYER_ESCROW_SHARED_CHECKPOINT:'true',
    LOGIN_SERVER:'false',FRIEND_SERVER:'false',LOGGER_SERVER:'false',EASY_STARTUP:'false',WEBSITE_REGISTRATION:'false',BUILD_STARTUP:'false',BUILD_LIVE_RELOAD:'false',
    NODE_SHOP_ECONOMY_MODE:'closed-society',NODE_XPRATE:'1',BOT_USERNAME:setup.username,PASSWORD:password,SHOW_CHAT:'false',AUTONOMY_STARTUP_GRACE_MS:'900000'};
type Child=ReturnType<typeof Bun.spawn>;
const workers=new Map<string,Child>(),links:string[]=[];let client:Child|undefined,epoch=0,clean=true;
function spawn(name:string,args:string[],cwd:string,extra:Record<string,string>={}){
    return Bun.spawn([process.execPath,'--no-env-file',...args],{cwd,env:{...env,...extra},stdout:Bun.file(join(logs,`${epoch}-${name}.out.log`)),stderr:Bun.file(join(logs,`${epoch}-${name}.err.log`))});
}
async function bounded(child:Child,ms:number){
    const remaining=Math.min(ms,maximumMs-(Date.now()-started));if(remaining<=0){
        if(child.exitCode===null){child.kill();await child.exited;}
        throw Error('Founder live trial total wall budget exhausted');
    }
    let expired=false;const timer=setTimeout(()=>{expired=true;child.kill();},remaining);
    try{const exit=await child.exited;if(expired||exit!==0)throw Error(`Trial subprocess ${expired?'timed out':`failed (${exit})`}; outcome retained, no blind replay`);}finally{clearTimeout(timer);}
}
function clock(action:'pause'|'resume'){
    const store=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite'));
    try{const s=store.get(setup.owner.clockId)!;if(s.status!==({pause:'paused',resume:'running'} as const)[action])store[action](s.clockId,s.revision,new Date(Math.max(Date.now(),Date.parse(s.lastObservedWallTime))).toISOString());}finally{store.close();}
}
async function control(role:string,stop=false){
    const port=ports[role==='engine'?4:5];try{const response=await fetch(`http://127.0.0.1:${port}/${stop?'stop':''}`,{method:stop?'POST':'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});
        const data=await response.json();return response.ok&&data.id===source.worldId&&data.generation===generation?data:null;
    }catch{return null;}
}
async function stop(){
    for(const role of ['gateway','engine']){const child=workers.get(role);if(!child)continue;
        if(child.exitCode===null){await control(role,true);const until=Date.now()+20000;
            while(child.exitCode===null&&Date.now()<until)await Bun.sleep(100);
            if(child.exitCode===null){clean=false;child.kill();}}
        await child.exited;workers.delete(role);
    }
    if(client){if(client.exitCode===null)client.kill();await client.exited;client=undefined;}
    if(!clean)throw Error('Trial shutdown was forced; preserved workspace requires reconciliation');
    clock('pause');phase('stopped-and-paused');
}
async function start(){
    epoch++;clock('resume');
    for(const role of ['engine','gateway']){
        const child=spawn(role,[join(root,'server/control-plane/managed-worker.ts')],join(root,'server',role),{MANAGED_ROLE:role,MANAGED_CONTROL_PORT:String(ports[role==='engine'?4:5]),...(role==='engine'?{ENGINE_LOGIN_PRIVATE_KEY:key.privateKey.export({type:'pkcs1',format:'pem'}).toString()}:{})});workers.set(role,child);
        const until=Math.min(Date.now()+60000,started+maximumMs);while(!(await control(role))?.ready){
            if(child.exitCode!==null){
                if(role==='engine'){
                    // The managed host intentionally hides import errors. Reproduce only that failed import in a private bounded log.
                    const diagnostic=spawn('engine-import-diagnostic',['-e',"try{await import('./src/app.ts')}catch(e){console.error(e);process.exit(1)}"],join(root,'server/engine'),{ENGINE_LOGIN_PRIVATE_KEY:key.privateKey.export({type:'pkcs1',format:'pem'}).toString()});
                    try{await bounded(diagnostic,10000);}catch{/* Original failure and private diagnostic are retained. */}
                }
                throw Error(`Trial ${role} failed to become ready; inspect private phase logs`);
            }
            if(Date.now()>until)throw Error(`Trial ${role} readiness limit`);await Bun.sleep(200);
        }
    }
    client=spawn('lite',['src/lite/runner.ts',setup.username],join(root,'server/webclient'));
    const until=Math.min(Date.now()+60000,started+maximumMs);while(true){
        if(client.exitCode!==null)throw Error('Trial Lite client exited before readiness');
        const status=await fetch(`http://127.0.0.1:${ports[0]}/status`,{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
        const bot=status.bots?.[setup.username];
        if(bot?.inGame)break;
        if(Date.now()>until)throw Error('Trial Lite client readiness limit; inspect phase logs');await Bun.sleep(300);
    }
    phase('native-client-ready',{ports});
}
function priorRuns(draftId:string){
    const path=join(root,'.local/agent-skills/runs');if(!existsSync(path))return[];
    const names=readdirSync(path),runs=names.filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n)).map(n=>JSON.parse(readFileSync(join(path,n),'utf8')))
        .filter(r=>r.skill?.id===draftId&&r.username===setup.username);
    for(const name of names.filter(n=>/^[a-f0-9-]{36}\.admission\.json$/i.test(n))){const admission=JSON.parse(readFileSync(join(path,name),'utf8'));
        if(admission.skill?.id===draftId&&!runs.some(r=>r.runId===admission.runId))throw Error('Unresolved earlier trial admission; reconcile instead of repeating');}
    if(runs.some(r=>r.status!=='completed'))throw Error('Earlier trial failed; inspect and reconcile before repeating');return runs;
}
async function run(kind:string,trialId:string){
    const trials=new SkillTrialStore(join(root,'.local/agent-skills/trials.json'));let trial=(await trials.get(trialId))!;
    if(trial.status==='ready'||trial.status==='verification-failed')trial=await trials.transition(trial.trialId,trial.revision,'running');
    const registered=new SkillRegistry().register(JSON.parse(readFileSync(join(root,'agent-skills/catalog',`${trial.draft.id}@${trial.draft.version}.skill.json`),'utf8')));
    const authorization=Buffer.from(JSON.stringify(draftTrialAuthorization(registered.definition))).toString('base64url'),runId=randomUUID();
    phase(`${kind}-run-start`,{runId});
    await bounded(spawn(`${kind}-${runId}`,[join(root,'agent-skills/run.ts'),setup.username,`${trial.draft.id}@${trial.draft.version}`,'--allow-draft',`--run-id=${runId}`,`--runtime-authorization=${authorization}`,
        ...Object.entries(trial.parameters).map(([k,v])=>`--param=${k}=${v}`)],root),150000);
    const outcome=JSON.parse(readFileSync(join(root,'.local/agent-skills/runs',`${runId}.json`),'utf8'));if(outcome.status!=='completed')throw Error(`Actual ${kind} trial did not complete: ${outcome.reason}`);
    phase(`${kind}-run-completed`,{runId,operations:outcome.operations,durationMs:outcome.durationMs});
}
let result:Record<string,unknown>|undefined;
try{
    for(const name of ['node_modules','server/engine/node_modules','server/webclient/node_modules'])if(!existsSync(join(root,name))&&existsSync(join(sourceRoot,name))){symlinkSync(join(sourceRoot,name),join(root,name),process.platform==='win32'?'junction':'dir');links.push(join(root,name));}
    const prepared=await prepareFounderProcedureTrials(root,setup.username,setup.businessId),selected=values.phase==='all'?FOUNDER_TRIAL_PROCEDURES:values.phase==='tin'?FOUNDER_TRIAL_PROCEDURES.filter(p=>p.kind==='tin'):[];
    await start();
    if(values.phase==='inspect'){
        await bounded(spawn('sdk-observation',['-e',"import {runScript} from './sdk/runner.ts'; const r=await runScript(async({sdk})=>{console.log(JSON.stringify({player:sdk.getState()?.player,target:sdk.findNearbyLoc(/^Rocks tin ore$/i,{withOption:'mine'}),locations:sdk.getNearbyLocs().filter(l=>/rocks|door|gate/i.test(l.name))},null,2));},{timeout:15000,printState:false});process.exitCode=r.success?0:1;"],root),60000);
        phase('readonly-sdk-observation');
    }
    for(const p of selected){const trial=prepared.prepared.find(t=>t.kind===p.kind)!,target=values.phase==='all'?2:Number(values.runs);
        for(let i=priorRuns(p.id).length;i<target;i++){
            if(p.kind==='repair'){
                await stop();
                const probe=Bun.spawn(['pwsh','-NoProfile','-File',join(sourceRoot,'scripts/assert-society-offline.ps1'),'-Root',root,'-CallerPid',String(process.pid)],
                    {cwd:sourceRoot,env:process.env,stdout:Bun.file(join(logs,`${epoch}-offline.out.log`)),stderr:Bun.file(join(logs,`${epoch}-offline.err.log`))});
                await bounded(probe,15000);
                await bounded(spawn('declared-trial-damage',[join(root,'scripts/integration-native-bootstrap.ts'),'--damage-founder-trial'],join(root,'server/engine'),{ENGINE_LOGIN_PRIVATE_KEY:key.privateKey.export({type:'pkcs1',format:'pem'}).toString()}),30000);
                phase('declared-broken-trial-precondition',{qualifiesMinimum:false});await start();
            }
            await run(p.kind,trial.trialId);
        }
    }
    await stop();
    const reviews=[];for(const p of selected){const trial=prepared.prepared.find(t=>t.kind===p.kind)!;
        if(priorRuns(p.id).length>=2){const reviewOptions={workspace:root,trialId:trial.trialId,selected:source},review=await reviewSkillTrial(reviewOptions);
            if(!review.report.passed)throw Error(`${p.kind} native review failed`);const reopened=await readSkillTrialReview(reviewOptions);
            reviews.push({kind:p.kind,trialId:trial.trialId,reportId:review.report.id,approvalDigest:reopened.approval.digest});}
    }
    result={protocol:'si-c07-founder-live-trials-v1',status:'completed',worldId:source.worldId,phase:values.phase,reviews,publicationExecuted:false,qualifiesMinimum:false,providerCalls:0,elapsedMs:Date.now()-started};
}finally{
    try{if(workers.size||client)await stop();}finally{for(const link of links.reverse())unlinkSync(link);unlinkSync(publicKeyPath);}
    writeFileSync(join(logs,'result.json'),JSON.stringify(result??{status:'failed',qualifiesMinimum:false,providerCalls:0,elapsedMs:Date.now()-started},null,2));
}
console.log(JSON.stringify(result,null,2));
