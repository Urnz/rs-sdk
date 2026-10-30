import World from '../engine/World.js';
import {afterEach,beforeAll,expect,test} from 'bun:test';
import {copyFileSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadPackedContent} from './native-food-skill-fixture.js';
import {fixture,closeNativeMiningFixtures} from './native-mining-tool-fixture.js';
import {miningSourceFixture} from '../../../../agent-skills/test/mining-demand-fixture.js';
import {BusinessManagerStore} from '../../../gateway/admin/business-manager.js';
import {PropertyStore} from './PropertyStore.js';
import {loadPropertyCatalog} from './Properties.js';
import {NativeToolWorkExecutor,type NativeToolWorkCommand} from './NativeToolWork.js';
import {NativeToolWorkAccessSource} from '../../../../production-workflow/native-tool-work-source.js';
import {nativeToolWorkPolicy} from '../../../../production-workflow/native-tool-work-policy.js';
import {toolSkillOperationId} from '../../../../production-workflow/native-tool-work-invocation.js';
import {executeToolSkillRequest} from '../../../gateway/admin/native-tool-skills.js';
import {prepareFounderProcedureTrials} from '../../../../society-experiments/founder-procedure-trials.js';
import {reviewSkillTrial,readSkillTrialReview} from '../../../../agent-skills/trial-review.js';
import {SkillTrialStore} from '../../../../agent-skills/trials.js';
import {SkillRegistry} from '../../../../agent-skills/registry.js';
import {FileSkillRunJournal} from '../../../../agent-skills/journal.js';
import {toolTrialAuthorization} from '../../../../agent-skills/tool-trials.js';
import {SkillExecutor} from '../../../../agent-skills/executor.js';
import {RsSdkSkillRuntime} from '../../../../agent-skills/rs-sdk-runtime.js';
import {nativeToolDigest as hash} from '../../../../item-lifecycle/native-tool.js';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import LocType from '../cache/config/LocType.js';
import Loc from '../engine/entity/Loc.js';
import {EntityLifeCycle} from '../engine/entity/EntityLifeCycle.js';
import {PlayerStat} from '../engine/entity/PlayerStat.js';
import type {SocietyToolRequest} from '../../../../sdk/society-tools.js';
beforeAll(loadPackedContent);
const sources:ReturnType<typeof miningSourceFixture>[]=[];
afterEach(()=>{closeNativeMiningFixtures();for(const s of sources.splice(0))s.close();});

test('SI-C07 persisted full smelt and repair trials use real population/Business/Property authorities and survive readonly review',async()=>{
    const started=performance.now(),phase=(name:string)=>console.info('[founder-tool-trials]',JSON.stringify({phase:name,elapsedMs:Math.round(performance.now()-started)}));
    const s=miningSourceFixture();sources.push(s);const root=s.root;
    mkdirSync(join(root,'config'),{recursive:true});
    for(const name of ['properties.json','facility-capabilities.json'])copyFileSync(resolve(import.meta.dir,'../../../../config',name),join(root,'config',name));
    for(const id of ['procedure.mining.gather-tin','procedure.metallurgy.smelt-bronze','procedure.tools.repair-bronze-pickaxe']){
        const name=`${id}@0.1.0.skill.json`;copyFileSync(resolve(import.meta.dir,'../../../../agent-skills/catalog',name),join(root,'agent-skills/catalog',name));
    }
    writeFileSync(join(root,'.local/simulation/food-trial-fixture.json'),JSON.stringify({schemaVersion:1,acceptance:'draft-trial-only',worldId:s.owner.worldId,fixtureDigest:'a'.repeat(64)}));
    const checkpointPath=join(root,'server/engine/data/player-checkpoints.sqlite');mkdirSync(join(root,'server/engine/data'),{recursive:true});
    const f=fixture(undefined,{username:'worker',checkpointPath,identity:(username,actionId,slot,tick)=>({action:{...s.owner,username,actionId,slot,itemId:379,quantity:1,policyDigest:'a'.repeat(64)},clock:s.clock.observeNow(s.owner.clockId,tick)})});
    f.miner.setLevel(PlayerStat.MINING,1);f.miner.setLevel(PlayerStat.SMITHING,1);f.miner.invAdd(InvType.INV,2347,1);
    const businessPath=join(root,'.local/economy/businesses.sqlite'),propertyPath=join(root,'.local/admin/properties.sqlite');
    const business=new BusinessManagerStore(businessPath),property=new PropertyStore(loadPropertyCatalog(join(root,'config/properties.json')),propertyPath);
    try{
        business.create({businessId:'trial-workshop',name:'Trial workshop',summary:'Explicit disposable trial only.',ownerAgentId:s.owner.actorId,propertyId:'varrock.east-workshop'});
        property.assignGenesis('declared-trial-genesis','varrock.east-workshop',1,{kind:'business',id:'trial-workshop'});
    }finally{business.close();property.close();}
    const access=new NativeToolWorkAccessSource({workspace:root,agentsPath:join(root,'.local/agent-state/agents.sqlite'),businessPath,propertyPath});
    const sites=Object.fromEntries((['smelt','repair'] as const).map(kind=>{const p=nativeToolWorkPolicy[kind].source;
        return[kind,new Loc(p.level,p.x,p.z,1,1,EntityLifeCycle.FOREVER,LocType.getId(p.debugName),10,0)];}));
    const executor=new NativeToolWorkExecutor({...f.p,clock:()=>s.clock.observeNow(s.owner.clockId,World.currentTick),source:kind=>sites[kind]!,
        authorize:(_player,kind,businessId,clock,owner,invocation)=>access.authorize(owner,kind,businessId,clock,invocation)});
    const prepared=await prepareFounderProcedureTrials(root,'worker','trial-workshop'),again=await prepareFounderProcedureTrials(root,'worker','trial-workshop');
    expect(again.prepared.map(p=>p.trialId)).toEqual(prepared.prepared.map(p=>p.trialId));expect(prepared.executionStarted).toBeFalse();
    const trials=new SkillTrialStore(join(root,'.local/agent-skills/trials.json')),journal=new FileSkillRunJournal(join(root,'.local/agent-skills/runs'));
    const options={workspace:root,worldId:s.owner.worldId,checkpointPath,binding:()=>s.owner,dispatch:async(command:NativeToolWorkCommand)=>executor.start(command,f.miner)};
    for(const kind of ['smelt','repair'] as const){
        const planned=prepared.prepared.find(p=>p.kind===kind)!;let trial=(await trials.get(planned.trialId))!;
        trial=await trials.transition(trial.trialId,trial.revision,'running');
        const definition=new SkillRegistry().register(JSON.parse(readFileSync(join(root,'agent-skills/catalog',`${trial.draft.id}@0.1.0.skill.json`),'utf8'))).definition;
        for(let i=0;i<2;i++){
            if(kind==='smelt'){f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);}
            else{const item=f.store.lifecycle.get('tool-worker')!;f.store.lifecycle.use(randomUUID(),item.itemInstanceId,item.revision,item.durability,'e'.repeat(64),s.clock.observeNow(s.owner.clockId,World.currentTick).simulationTime);}
            const runId=randomUUID(),parameters=trial.parameters,registered=new SkillRegistry().register(definition),parametersDigest=hash(Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b)));
            await journal.start({runId,username:'worker',skill:trial.draft,checksum:registered.checksum,parameters,parametersDigest});
            writeFileSync(s.markerPath,JSON.stringify({username:'worker',runId,skillId:definition.id,version:definition.version,heartbeatAt:new Date().toISOString(),
                nativeToolTrial:{checksum:registered.checksum,runtimeAuthorization:toolTrialAuthorization(definition)}}));
            const sdk={getInventory:()=>f.miner.getInventory(InvType.INV)!.items.filter(Boolean).map(item=>({id:item!.id,name:ObjType.get(item!.id).name,count:item!.count})),
                getSkill:()=>({baseLevel:f.miner.baseLevels[PlayerStat.SMITHING]}),sendSocietyTool:async(request:SocietyToolRequest)=>{
                    const id=toolSkillOperationId(request),prior=executor.work.get(id);if(prior&&prior.phase!=='completed'){World.currentTick++;executor.advance(id,f.miner);}
                    return executeToolSkillRequest(options,'worker',request);
                }};
            // Only movement is controlled; the complete draft, access reader, escrow, packed smelt and repair are real.
            const runtime=new RsSdkSkillRuntime({walkTo:async(x:number,z:number)=>{f.miner.x=x;f.miner.z=z;f.miner.level=0;return{success:true,message:'controlled trial placement'};}} as any,sdk as any,toolTrialAuthorization(definition));
            const run=await new SkillExecutor(runtime).execute(definition,{allowDraft:true,parameters,runId});run.username='worker';
            expect(run.status).toBe('completed');expect(run.operations).toBe(2);await journal.save(run);phase(`${kind}-${i+1}-persisted`);
        }
        const reviewOptions={workspace:root,trialId:trial.trialId,selected:{worldId:s.owner.worldId,checkpointPath}},review=await reviewSkillTrial(reviewOptions);
        expect(review.report.passed).toBeTrue();expect(review.approval).not.toBeNull();
        expect((await readSkillTrialReview(reviewOptions)).approval.digest).toBe(review.approval!.digest);phase(`${kind}-review-reopened`);
        expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(kind==='smelt'?2:0);
    }
    expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(50);
    const repair=prepared.prepared.find(p=>p.kind==='repair')!,repairTrial=(await trials.get(repair.trialId))!;
    const path=join(root,'.local/agent-skills/runs',`${repairTrial.runIds[0]}.json`),changed=JSON.parse(readFileSync(path,'utf8'));changed.message+=' changed';writeFileSync(path,JSON.stringify(changed));
    await expect(readSkillTrialReview({workspace:root,trialId:repair.trialId,selected:{worldId:s.owner.worldId,checkpointPath}})).rejects.toThrow('changed');
    // Rewriting the procedure and admission cannot relabel effects executed under an older native skill checksum.
    const definitionPath=join(root,'agent-skills/catalog',`${repairTrial.draft.id}@0.1.0.skill.json`),definition=JSON.parse(readFileSync(definitionPath,'utf8'));
    definition.name+=' changed';writeFileSync(definitionPath,JSON.stringify(definition));const checksum=new SkillRegistry().register(definition).checksum;
    for(const runId of repairTrial.runIds){const admissionPath=join(root,'.local/agent-skills/runs',`${runId}.admission.json`),admission=JSON.parse(readFileSync(admissionPath,'utf8'));
        admission.checksum=checksum;writeFileSync(admissionPath,JSON.stringify(admission));}
    await expect(reviewSkillTrial({workspace:root,trialId:repair.trialId,selected:{worldId:s.owner.worldId,checkpointPath}})).rejects.toThrow('different draft checksum');
    phase('tamper-rejected');
},20000);
