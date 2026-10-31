import {parseArgs} from 'node:util';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {inspectFreshFounderHousing,checkHousing,FOUNDER_HOUSING_LIMITS,founderHousingParentEnvironment} from '../society-experiments/founder-housing.js';
import {SimulationClockStore} from '../simulation-clock/store.js';
import {AgentStateStore} from '../agent-state/store.js';
import {reservePopulationRental,reservePopulationOwnerBed,requestNativeHousing,finalizePopulationRental} from '../server/gateway/admin/native-housing.js';
import {NativeRentSource} from '../housing/native-rent-source.js';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {readHousingSleep} from '../housing/native-sleep.js';

const {values}=parseArgs({strict:true,options:{root:{type:'string'},inspect:{type:'boolean',default:false},'bed-diagnostic':{type:'boolean',default:false}}}),root=resolve(import.meta.dir,'..'),repository=resolve(process.cwd());
checkHousing(values.root&&resolve(values.root)===root,'Run the frozen stage scripts/run-founder-housing.ts with its exact --root from the repository cwd');
const opening=inspectFreshFounderHousing(root,repository);
const diagnostic=values['bed-diagnostic'],activeAssignments=diagnostic?opening.assignments.filter(a=>a.kind==='owner'):opening.assignments;
const trialLimits=diagnostic?{...FOUNDER_HOUSING_LIMITS,maximumWallMs:90000}:FOUNDER_HOUSING_LIMITS;
if(values.inspect){console.log(JSON.stringify({worldId:opening.receipt.worldId,fixtureDigest:opening.fixture.digest,sourceManifestDigest:opening.sourceManifestDigest,
    sealDigest:opening.sealDigest,assignments:opening.assignments,limits:FOUNDER_HOUSING_LIMITS},null,2));process.exit(0);}
const started=Date.now(),logs=join(root,'.local/verification',`housing-live-${Date.now()}`);mkdirSync(logs,{recursive:true});
const recordPath=join(root,'.local/simulation',diagnostic?'founder-housing-bed-diagnostic.json':'founder-housing-live.json'),record:any={protocol:'si-c07-founder-housing-live-v1',status:'running',mode:diagnostic?'owner-bed-4-movement-diagnostic':'four-founder-housing',
    fixtureDigest:opening.fixture.digest,worldId:opening.receipt.worldId,sourceManifestDigest:opening.sourceManifestDigest,inputSourceDigest:opening.inputSourceDigest,
    openingSealDigest:opening.sealDigest,openingSetupDigest:opening.setupDigest,assignments:opening.assignments,limits:trialLimits,
    phases:[],routes:[],reservations:[],sleepWitnesses:[],providerCalls:0,providerCostMicros:0,qualifiesMinimum:false};
writeFileSync(recordPath,JSON.stringify(record,null,2),{flag:'wx'});
const phase=(name:string,extra:Record<string,unknown>={})=>{const row={phase:name,elapsedMs:Date.now()-started,...extra};record.phases.push(row);
    writeFileSync(recordPath,JSON.stringify(record,null,2));console.log(JSON.stringify(row));};
const leases=Array.from({length:6},()=>Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(null,{status:503})})),ports=leases.map(s=>s.port!);
for(const s of leases)s.stop(true);
const key=generateKeyPairSync('rsa',{modulusLength:1024}),jwk=key.publicKey.export({format:'jwk'}),decimal=(s:string)=>BigInt(`0x${Buffer.from(s,'base64url').toString('hex')}`).toString(),
    publicPath=join(root,'server/engine/data/config/public.pem'),token=randomBytes(32).toString('hex'),password=randomBytes(8).toString('hex'),generation=randomUUID();
checkHousing(!existsSync(publicPath),'Existing runtime key must be reconciled');writeFileSync(publicPath,key.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
const env={...process.env,CONTROL_PLANE_SERVER_ID:record.worldId,MANAGED_WORKSPACE:root,MANAGED_GENERATION:generation,MANAGED_CONTROL_TOKEN:token,ENGINE_ADMIN_TOKEN:token,
    AGENT_PORT:String(ports[0]),WEB_PORT:String(ports[1]),WEB_MANAGEMENT_PORT:String(ports[2]),NODE_PORT:String(ports[3]),
    ENGINE_ADMIN_URL:`http://127.0.0.1:${ports[1]}`,ENGINE_PUBLIC_URL:`http://127.0.0.1:${ports[1]}/mapview/`,GATEWAY_URL:`ws://127.0.0.1:${ports[0]}`,SERVER:`127.0.0.1:${ports[1]}`,
    LOGIN_RSAN:decimal(jwk.n!),LOGIN_RSAE:decimal(jwk.e!),RS_SDK_LITE_CACHE_DIR:join(root,'.local/lite-cache'),
    PLAYER_CHECKPOINT_DATABASE:'data/player-checkpoints.sqlite',GE_DATABASE:'data/player-checkpoints.sqlite',TRADE_EVIDENCE_DB:'data/mods/trade-evidence.sqlite',PLAYER_ESCROW_SHARED_CHECKPOINT:'true',
    LOGIN_SERVER:'false',FRIEND_SERVER:'false',LOGGER_SERVER:'false',EASY_STARTUP:'false',WEBSITE_REGISTRATION:'false',BUILD_STARTUP:'false',BUILD_LIVE_RELOAD:'false',
    NODE_SHOP_ECONOMY_MODE:'closed-society',NODE_XPRATE:'1',PASSWORD:password,SHOW_CHAT:'false',AUTONOMY_STARTUP_GRACE_MS:'900000'};
Object.assign(process.env,founderHousingParentEnvironment(env));
type Child=ReturnType<typeof Bun.spawn>;
const workers=new Map<string,Child>(),clients:Child[]=[],routes=new Map<string,{child:Child;runId:string;ready:string;go:string;output:string}>(),links:string[]=[];
let clean=true,error:unknown,stopping=false;let parallel:Promise<void>[]=[];
// Reserve the two existing 20-second owned-service shutdown windows inside the total limit.
const remaining=()=>Math.max(0,trialLimits.maximumWallMs-40000-(Date.now()-started));
function spawn(label:string,args:string[],cwd:string,extra:Record<string,string>={}){return Bun.spawn([process.execPath,'--no-env-file',...args],{cwd,env:{...env,...extra},
    stdout:Bun.file(join(logs,`${label}.out.log`)),stderr:Bun.file(join(logs,`${label}.err.log`))});}
async function waitFor(test:()=>Promise<boolean>|boolean,label:string,max:number){const until=Date.now()+Math.min(max,remaining());while(!(await test())){
    checkHousing(Date.now()<until,`Housing ${label} limit reached`);await Bun.sleep(200);}}
async function control(role:string,stop=false){try{const response=await fetch(`http://127.0.0.1:${ports[role==='engine'?4:5]}/${stop?'stop':''}`,
    {method:stop?'POST':'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)}),data=await response.json();
    return response.ok&&data.id===record.worldId&&data.generation===generation?data:null;}catch{return null;}}
const housing={workspace:root,worldId:record.worldId,housingPath:join(root,'.local/economy/housing.sqlite'),propertyPath:join(root,'.local/admin/properties.sqlite'),
    checkpointPath:join(root,'server/engine/data/player-checkpoints.sqlite')};
function clock(){const store=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite'));try{const s=store.get(opening.fixture.clock.clockId)!;
    return{clockId:s.clockId,profileDigest:s.profileDigest,simulationTime:s.lastSimulationTime,wallTime:s.lastObservedWallTime,status:s.status,revision:s.revision,engineTick:null};}finally{store.close();}}
async function stop(){
    stopping=true;
    for(const {child} of routes.values())if(child.exitCode===null){child.kill();await child.exited;}
    for(const role of ['gateway','engine']){const child=workers.get(role);if(!child)continue;
        if(child.exitCode===null){await control(role,true);const until=Date.now()+20000;
            while(child.exitCode===null&&Date.now()<until)await Bun.sleep(100);if(child.exitCode===null){clean=false;child.kill();}}
        await child.exited;workers.delete(role);
    }
    for(const child of clients){if(child.exitCode===null)child.kill();await child.exited;}clients.length=0;
    const store=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite'));try{const s=store.get(opening.fixture.clock.clockId)!;
        if(s.status==='running')store.pause(s.clockId,s.revision,new Date(Math.max(Date.now(),Date.parse(s.lastObservedWallTime))).toISOString());}finally{store.close();}
    checkHousing(clean,'Housing shutdown was forced; preserved outcome requires reconciliation');phase('stopped-and-paused');
}
function checkSources(){checkHousing(!stopping,'Housing trial is stopping');for(const role of workers.keys())checkHousing(workers.get(role)!.exitCode===null,`Owned ${role} exited`);
    for(const child of clients)checkHousing(child.exitCode===null,'Owned Lite client exited');}
async function sleepActor(username:string){const reservation=record.reservations.find((r:any)=>r.username===username),assignment=opening.assignments.find(a=>a.username===username)!;
    checkHousing(remaining()>=8000,'Insufficient remaining wall budget for a native sleep admission');
    await requestNativeHousing({operation:assignment.kind==='owner'?'owner-sleep':'sleep',operationId:reservation.operationId});
    const source=new NativeRentSource(housing),db=new OwnedDatabase(housing.checkpointPath,{readonly:true,strict:true});try{
        if(assignment.kind==='owner')source.ownerBed(reservation.operationId,clock());else source.entitlement(reservation.operationId,clock());
        const w=readHousingSleep(db).find(w=>w.operationId===reservation.operationId&&w.username===username);
        checkHousing(w,'Native sleep ACK without an actual witness');record.sleepWitnesses.push({username,witnessId:w.id,operationId:w.operationId});
    }finally{source.close();db.close(true);}phase('native-sleep-confirmed',{username});}
try{
    for(const p of ['node_modules','server/engine/node_modules','server/webclient/node_modules'])if(!existsSync(join(root,p))&&existsSync(join(repository,p))){
        symlinkSync(join(repository,p),join(root,p),process.platform==='win32'?'junction':'dir');links.push(join(root,p));}
    const store=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite'));try{const s=store.get(opening.fixture.clock.clockId)!;store.resume(s.clockId,s.revision,new Date().toISOString());}finally{store.close();}
    for(const role of ['engine','gateway']){
        const child=spawn(role,[join(root,'server/control-plane/managed-worker.ts')],join(root,'server',role),{MANAGED_ROLE:role,MANAGED_CONTROL_PORT:String(ports[role==='engine'?4:5]),
            ...(role==='engine'?{ENGINE_LOGIN_PRIVATE_KEY:key.privateKey.export({type:'pkcs1',format:'pem'}).toString()}:{})});workers.set(role,child);
        await waitFor(async()=>{checkHousing(child.exitCode===null,`Owned ${role} failed before readiness`);return!!(await control(role))?.ready;},`${role} readiness`,60000);
        phase(`${role}-ready`);
    }
    for(const a of activeAssignments)clients.push(spawn(`lite-${a.username}`,['src/lite/runner.ts',a.username],join(root,'server/webclient'),{BOT_USERNAME:a.username}));
    await waitFor(async()=>{checkSources();const status=await fetch(`http://127.0.0.1:${ports[0]}/status`,{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
        return activeAssignments.every(a=>status.bots?.[a.username]?.inGame);},'Lite logins',60000);phase(diagnostic?'owner-lite-ready':'four-lite-clients-ready');
    for(const a of activeAssignments){const runId=randomUUID(),ready=join(logs,`${a.username}.ready.json`),go=join(logs,`${a.username}.go`),output=join(logs,`${a.username}.route.json`),
        child=spawn(`route-${a.username}`,[join(root,'scripts/founder-housing-client.ts'),a.username,runId,output],root,
            {BOT_USERNAME:a.username,HOUSING_READY_PATH:ready,HOUSING_GO_PATH:go,HOUSING_BED_DIAGNOSTIC:String(diagnostic)});routes.set(a.username,{child,runId,ready,go,output});}
    await waitFor(()=>{checkSources();for(const r of routes.values())checkHousing(r.child.exitCode===null,'SDK opening process failed');return[...routes.values()].every(r=>existsSync(r.ready));},'four SDK openings',90000);
    record.openings=[...routes.values()].map(r=>JSON.parse(readFileSync(r.ready,'utf8')));phase(diagnostic?'owner-original-opening-verified':'four-original-openings-verified');
    if(!diagnostic){
    const agents=new AgentStateStore(join(root,'.local/agent-state/agents.sqlite'),undefined,true);try{
        const owner=agents.getPopulationMember(opening.fixture.housing.landlordAgentId)!;
        for(const a of opening.assignments){const operationId=randomUUID(),member=agents.getPopulationMember(a.agentId)!,at=clock();
            if(a.kind==='owner')reservePopulationOwnerBed(housing,member,at,{operationId,bedSlotId:a.bed.bedSlotId});
            else{checkHousing(remaining()>=8000,'Insufficient remaining wall budget for native rent');reservePopulationRental(housing,member,owner,at,{operationId,bedSlotId:a.bed.bedSlotId});
                await requestNativeHousing({operation:'pay',operationId});checkHousing(finalizePopulationRental(housing,operationId).phase==='active','Paid rent did not activate');}
            record.reservations.push({username:a.username,kind:a.kind,operationId,bedSlotId:a.bed.bedSlotId});phase('native-housing-admitted',{username:a.username,kind:a.kind});
        }
    }finally{agents.close();}
    }
    const owner=opening.assignments.find(a=>a.kind==='owner')!,ownerRoute=routes.get(owner.username)!;writeFileSync(ownerRoute.go,'go',{flag:'wx'});
    async function finish(username:string){const r=routes.get(username)!;await waitFor(()=>{checkSources();return r.child.exitCode!==null;},`${username} route`,FOUNDER_HOUSING_LIMITS.travelMs+FOUNDER_HOUSING_LIMITS.bedMs);
        checkHousing(r.child.exitCode===0&&existsSync(r.output),`Actual route failed for ${username}; preserve its SDK/native logs`);
        const result=JSON.parse(readFileSync(r.output,'utf8'));checkHousing(result.success,`SDK route outcome failed for ${username}`);
        record.routes.push({username,runId:r.runId,path:r.output,observation:result});phase('actual-bed-arrival',{username,durationMs:result.durationMs});if(!diagnostic)await sleepActor(username);}
    await finish(owner.username);
    for(const a of activeAssignments.filter(a=>a.kind==='paid'))writeFileSync(routes.get(a.username)!.go,'go',{flag:'wx'});
    parallel=activeAssignments.filter(a=>a.kind==='paid').map(a=>finish(a.username));await Promise.all(parallel);
    record.status='completed';phase(diagnostic?'stable-bed-four-movement-confirmed':'four-native-sleep-witnesses-confirmed');
}catch(e){error=e;record.status='failed';record.error=e instanceof Error?e.message:String(e);phase('failed',{error:record.error});
}finally{
    try{await stop();}catch(e){record.status='failed';record.shutdownError=String(e);error??=e;}
    await Promise.allSettled(parallel);
    for(const link of links.reverse())unlinkSync(link);unlinkSync(publicPath);
    record.elapsedMs=Date.now()-started;record.cleanShutdown=clean;
    if(record.elapsedMs>trialLimits.maximumWallMs){record.status='failed';record.budgetError='Total housing wall limit exceeded';error??=Error(record.budgetError);}
    writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');
}
console.log(JSON.stringify({status:record.status,worldId:record.worldId,witnesses:record.sleepWitnesses.length,elapsedMs:record.elapsedMs,cleanShutdown:clean}));
if(error)throw error;
