import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runScript} from '../sdk/runner.js';
import {SkillRegistry} from '../agent-skills/registry.js';
import {SkillLibrary} from '../agent-skills/library.js';
import {FileSkillStore} from '../agent-skills/store.js';
import {FileSkillRunJournal} from '../agent-skills/journal.js';
import {SkillExecutor} from '../agent-skills/executor.js';
import {RsSdkSkillRuntime} from '../agent-skills/rs-sdk-runtime.js';
import {loadIntegrationFixture} from '../society-integration/fixture.js';
import {founderHousingAssignments,checkHousing,FOUNDER_HOUSING_LIMITS,reachableFounderBedApproach,settleFounderBedApproach} from '../society-experiments/founder-housing.js';

// Started only by the owned live orchestrator; credentials stay in its environment.
const root=resolve(import.meta.dir,'..'),[username,runId,output]=process.argv.slice(2),fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-v1.json')),
    assignment=founderHousingAssignments(fixture).find(a=>a.username===username);
checkHousing(assignment&&username===process.env.BOT_USERNAME&&runId&&/^[a-f0-9-]{36}$/.test(runId)&&output,'Exact founder route arguments required');
if(process.env.HOUSING_BED_DIAGNOSTIC==='true'){
    checkHousing(assignment.kind==='owner','The isolated bed movement diagnostic uses only the property owner');
    assignment.bed=fixture.founderBaseline!.beds[3]!;
}
const trace:unknown[]=[],started=Date.now();
const result=await runScript(async({bot,sdk})=>{
    const state=()=>{const s=sdk.getState(),p=s?.player;checkHousing(p&&!p.isDead&&p.hp>0&&sdk.getStateAge()<5000,'Founder SDK state unavailable');
        return{x:p.worldX,z:p.worldZ,level:p.level,hp:p.hp,lifeId:p.lifeId,gp:sdk.getInventory().filter(i=>i.id===995).reduce((n,i)=>n+i.count,0)};};
    const initial=state();trace.push({phase:'route-opening',state:initial});
    checkHousing(initial.x===assignment.opening.x&&initial.z===assignment.opening.z&&initial.level===assignment.opening.level&&initial.gp===assignment.openingGp,
        'Actual SDK opening differs from the unchanged founder fixture');
    checkHousing(process.env.HOUSING_READY_PATH&&process.env.HOUSING_GO_PATH,'Owned route barrier missing');
    writeFileSync(process.env.HOUSING_READY_PATH,JSON.stringify({username,initial,at:new Date().toISOString()}),{flag:'wx'});
    while(!existsSync(process.env.HOUSING_GO_PATH)){await Bun.sleep(100);state();}
    if(assignment.kind==='paid'){
        const registry=new SkillRegistry(),library=new SkillLibrary(registry,new FileSkillStore(join(root,'.local/agent-skills')));
        await library.loadReviewedCatalog(join(root,'agent-skills/catalog'));
        const registered=registry.get({id:'procedure.travel.native-sites',version:'1.0.0'},username!);
        checkHousing(registered?.definition.status==='verified','Exact published travel skill absent');
        const journal=new FileSkillRunJournal(join(root,'.local/agent-skills/runs')),parameters={site:'housing'},
            parametersDigest=createHash('sha256').update(JSON.stringify(Object.entries(parameters))).digest('hex');
        checkHousing(await journal.start({runId:runId!,username:username!,skill:{id:registered.definition.id,version:registered.definition.version},
            checksum:registered.checksum,parameters,parametersDigest}),'Earlier travel admission must not replay');
        const markerRoot=join(root,'.local/admin/active-skills'),markerPath=join(markerRoot,`${username}.json`);mkdirSync(markerRoot,{recursive:true});
        const marker={username,skillId:registered.definition.id,version:registered.definition.version,runId,startedAt:new Date().toISOString(),
            heartbeatAt:new Date().toISOString(),progressAt:new Date().toISOString(),progressSequence:0,pid:process.pid};
        const persist=()=>{marker.heartbeatAt=new Date().toISOString();writeFileSync(markerPath,JSON.stringify(marker));};persist();
        const heartbeat=setInterval(persist,5000);
        try{
            const outcome=await new SkillExecutor(new RsSdkSkillRuntime(bot,sdk,{operations:['travel-to-site'],itemNames:[],partners:[],
                maxQuantity:1,maxUnitPriceGp:0,maxGpPerRun:assignment.expectedFareGp})).execute(registered.definition,{runId,parameters,
                onEvent:e=>{marker.progressAt=e.timestamp;marker.progressSequence++;persist();console.log(JSON.stringify({phase:e.type,step:e.stepId,elapsedMs:Date.now()-started}));}});
            outcome.username=username;await journal.save(outcome);trace.push({phase:'published-travel',status:outcome.status,reason:outcome.reason});
            checkHousing(outcome.status==='completed',`Native founder travel failed: ${outcome.reason}`);
        }finally{clearInterval(heartbeat);unlinkSync(markerPath);}
    }
    const beforeBed=state(),target=await reachableFounderBedApproach(assignment.bed,beforeBed,async(x,z)=>{
        const path=await sdk.sendFindPath(x,z,500),end=path.waypoints.at(-1);
        return path.success&&path.reachedDestination===true&&end?.x===x&&end.z===z&&end.level===assignment.bed.level;
    });
    trace.push({phase:'bed-approach',before:beforeBed,target});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const approached=await Promise.race([(async()=>{
        const result=await bot.walkTo(target.x,target.z,0);checkHousing(result.success,'Final bed walk failed');
        const stopped=await settleFounderBedApproach(sdk,target,initial.lifeId);trace.push({phase:'stable-bed-stop',stopped});return result;
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Exact bed approach timed out')),FOUNDER_HOUSING_LIMITS.bedMs);})])
        .finally(()=>clearTimeout(timer));const arrived=state();
    trace.push({phase:'bed-arrival',result:approached,state:arrived});
    checkHousing(approached.success&&arrived.lifeId===initial.lifeId&&arrived.level===assignment.bed.level
        &&Math.max(Math.abs(arrived.x-assignment.bed.x),Math.abs(arrived.z-assignment.bed.z))<=1,'Founder did not reach its exact physical bed');
    return{username,runId,assignment,initial,beforeBed,arrived,trace};
},{timeout:FOUNDER_HOUSING_LIMITS.travelMs+FOUNDER_HOUSING_LIMITS.bedMs,printState:false});
writeFileSync(output!,JSON.stringify({success:result.success,durationMs:result.duration,error:result.error?.message,result:result.result,trace},null,2)+'\n');
process.exitCode=result.success?0:1;
