import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import World from '../engine/World.js';
import {MarketStore} from '../engine/market/MarketStore.js';
import {PlayerLoading} from '../engine/entity/PlayerLoading.js';
import Packet from '../io/Packet.js';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import {PropertyStore} from './PropertyStore.js';
import {loadPropertyCatalog} from './Properties.js';
import {NativeToolStore,nativeToolCatalog,nativeToolCycles,nativeToolDigest as hash} from '../../../../item-lifecycle/native-tool.js';
import {NativeMiningDemandStore} from '../../../../item-lifecycle/native-mining-demand.js';
import {NativeMiningIntentStore} from '../../../../item-lifecycle/native-mining-intent.js';
import {NativeMiningDispatchStore} from '../../../../item-lifecycle/native-mining-dispatch.js';
import {NativeMaterialStore} from '../../../../production-workflow/native-material.js';
import {nativeToolWorkPolicy} from '../../../../production-workflow/native-tool-work-policy.js';
import {FOOD_TRIAL_STATE,INTEGRATION_STATE} from '../../../../society-integration/state-paths.js';

const SETUP='.local/simulation/founder-procedure-setup.json';
function trial(root:string){
    if(!existsSync(join(root,FOOD_TRIAL_STATE))||existsSync(join(root,INTEGRATION_STATE)))throw Error('Native founder setup requires a separate draft-trial world');
    const receipt=JSON.parse(readFileSync(join(root,FOOD_TRIAL_STATE),'utf8'));
    if(receipt.acceptance!=='draft-trial-only')throw Error('Native founder trial receipt differs');
    return receipt;
}
/** Offline, new-stage-only explicit trial allocations. No running avatar or existing baseline can be reset. */
export async function provisionFounderProcedureTrial(workspace:string,fixture:{digest:string;kitchen:{courierAgentId:string;ownerAgentId:string};clock:{clockId:string}}){
    const root=resolve(workspace),receipt=trial(root),stage=JSON.parse(readFileSync(join(root,'.integration-stage.json'),'utf8'));
    if(stage.fixtureDigest!==fixture.digest||receipt.fixtureDigest!==fixture.digest||existsSync(join(root,SETUP)))throw Error('Founder trial setup is not a fresh exact stage');
    for(const kind of ['smelt','repair'] as const){const site=nativeToolWorkPolicy[kind].source;
        if(!World.getLoc(site.x,site.z,site.level,LocType.getId(site.debugName)))throw Error(`Actual packed founder trial site absent: ${kind}`);}
    // Keep gateway orchestration outside the engine's static NodeNext module graph.
    const load=(p:string)=>import(pathToFileURL(join(root,p)).href);
    const {AgentStateStore}=await load('agent-state/store.ts'),{SimulationClockStore}=await load('simulation-clock/store.ts'),
        {BusinessManagerStore}=await load('server/gateway/admin/business-manager.ts'),{populationNeedsBinding}=await load('needs/population-binding.ts');
    const clock=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite')),
        agents=new AgentStateStore(join(root,'.local/agent-state/agents.sqlite'),undefined,true),market=new MarketStore(join(root,'server/engine/data/player-checkpoints.sqlite')),
        business=new BusinessManagerStore(join(root,'.local/economy/businesses.sqlite')),
        property=new PropertyStore(loadPropertyCatalog(join(root,'config/properties.json')),join(root,'.local/admin/properties.sqlite'));
    try{
        const stamp=clock.get(fixture.clock.clockId);if(stamp.status!=='paused')throw Error('Founder trial setup needs its paused offline clock');
        const member=agents.getPopulationMember(fixture.kitchen.courierAgentId),{playerId,actorId,lifecycleId,worldId,clockId,clockProfileDigest}=populationNeedsBinding(receipt.worldId,member),
            owner={actorId,username:playerId,lifecycleId,worldId,clockId,clockProfileDigest};
        const bytes=market.saved(playerId);if(!bytes)throw Error('Founder trial native checkpoint missing');
        const player=PlayerLoading.load(playerId,new Packet(bytes),null),inv=player.getInventory(InvType.INV)!;
        const slots=inv.items.flatMap((item,slot)=>item?.id===1265?[slot]:[]),tools=new NativeToolStore(market.db);
        if(slots.length!==1||inv.get(slots[0]!)?.count!==1||tools.binding(playerId))throw Error('Founder trial needs its one declared unbound bronze pickaxe');
        if(inv.getItemCount(436)!==2||inv.getItemCount(438)!==0||inv.getItemCount(2347)!==1)throw Error('Founder trial finite opening inventory differs');
        const businessId='si-c07-trial-workshop';business.create({businessId,name:'Founder procedure trial workshop',summary:'Separate procedure trial only; no C07 baseline claim.',ownerAgentId:fixture.kitchen.ownerAgentId,propertyId:'varrock.east-workshop'});
        business.hire(businessId,{workerAgentId:member.agentId,role:'worker',title:'Trial smith',wageGp:0});
        property.assignGenesis(`trial-workshop:${fixture.digest}`,'varrock.east-workshop',1,{kind:'business',id:businessId});
        const itemInstanceId=randomUUID(),openingEvidenceDigest=hash({scope:'declared-native-procedure-trial',receipt,username:playerId,itemId:1265,quantity:1});
        market.db.transaction(()=>{
            const item=tools.lifecycle.create({itemInstanceId,lifecycleTypeId:'bronze-pickaxe',ownerActorId:member.agentId,qualityBasisPoints:10000,provenanceDigest:openingEvidenceDigest,atSimulationTime:stamp.lastSimulationTime});
            new NativeMiningDemandStore(market.db);new NativeMiningIntentStore(market.db);new NativeMiningDispatchStore(market.db,true);new NativeMaterialStore(market.db,true);
            tools.put({schemaVersion:1,itemInstanceId,owner,position:{inventory:InvType.INV,slot:slots[0]!},status:'bound',reason:null,
                catalogDigest:nativeToolCatalog.digest,cycleDigest:nativeToolCycles.digest,checkpointDigest:hash([...bytes])});
            tools.append(`opening:${itemInstanceId}`,{kind:'explicit-opening',itemInstanceId,item,owner,evidenceDigest:openingEvidenceDigest});
        }).immediate();
        const body={schemaVersion:1,protocol:'si-c07-founder-procedure-trial-setup-v1',fixtureDigest:fixture.digest,worldId:receipt.worldId,
            username:playerId,owner,businessId,itemInstanceId,openingEvidenceDigest,declaredInitialDurability:100,sourceCheckpointDigest:hash([...bytes]),
            physicalSitesVerified:true,routeVerified:false,qualifiesMinimum:false,providerCalls:0};
        writeFileSync(join(root,SETUP),JSON.stringify({...body,digest:hash(body)},null,2)+'\n',{flag:'wx'});
    }finally{property.close();business.close();market.db.close(true);agents.close();clock.close();}
}

/** Explicit damaged-item trial precondition, never native Mining/warmup credit. Caller must prove the world offline. */
export async function damageFounderTrialTool(workspace:string){
    const root=resolve(workspace),receipt=trial(root),setup=JSON.parse(readFileSync(join(root,SETUP),'utf8')),{digest,...body}=setup;
    if(digest!==hash(body)||setup.worldId!==receipt.worldId||setup.fixtureDigest!==receipt.fixtureDigest||setup.qualifiesMinimum!==false)throw Error('Founder trial damage scope differs');
    const {SimulationClockStore}=await import(pathToFileURL(join(root,'simulation-clock/store.ts')).href),clock=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite'));
    const market=new MarketStore(join(root,'server/engine/data/player-checkpoints.sqlite'));
    try{const stamp=clock.get(setup.owner.clockId);if(stamp.status!=='paused')throw Error('Declared trial damage needs the paused offline clock');
        const tools=new NativeToolStore(market.db),binding=tools.binding(setup.username),item=tools.lifecycle.get(setup.itemInstanceId),bytes=market.saved(setup.username);
        if(!binding||!item||!bytes||binding.itemInstanceId!==item.itemInstanceId||item.ownerActorId!==setup.owner.actorId||item.durability<=0
            ||hash([...bytes])!==binding.checkpointDigest)throw Error('Founder trial tool cannot be damaged or reinterpreted');
        const operationId=randomUUID(),evidence={protocol:'declared-broken-trial-precondition-v1',qualifiesMinimum:false,setupDigest:digest,itemInstanceId:item.itemInstanceId,revision:item.revision,amount:item.durability};
        market.db.transaction(()=>{tools.lifecycle.use(operationId,item.itemInstanceId,item.revision,item.durability,hash(evidence),stamp.lastSimulationTime);
            tools.append(`trial-damage:${operationId}`,{kind:'declared-trial-damage',...evidence});}).immediate();
        return{...evidence,operationId,durability:0};
    }finally{market.db.close(true);clock.close();}
}
