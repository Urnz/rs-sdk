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
import {NativeToolStore,nativeToolCatalog,nativeToolCycles,nativeToolDigest as hash} from '../../../../item-lifecycle/native-tool.js';
import {NativeMiningDemandStore} from '../../../../item-lifecycle/native-mining-demand.js';
import {NativeMiningIntentStore} from '../../../../item-lifecycle/native-mining-intent.js';
import {NativeMiningDispatchStore} from '../../../../item-lifecycle/native-mining-dispatch.js';
import {NativeMaterialStore} from '../../../../production-workflow/native-material.js';
import {nativeToolWorkPolicy} from '../../../../production-workflow/native-tool-work-policy.js';
import {societyMinimumDigest as digest} from '../../../../society-minimum/policy.js';
import type {IntegrationFixture} from '../../../../society-integration/fixture.js';
import {INTEGRATION_STATE,FOOD_TRIAL_STATE} from '../../../../society-integration/state-paths.js';

const SETUP='.local/simulation/founder-baseline-setup.json';
/** Binds the one pickaxe already applied by genesis; never inserts items, damage or warmup credit. */
export async function provisionCommonFounderTool(workspace:string,fixture:IntegrationFixture){
    const root=resolve(workspace),stage=JSON.parse(readFileSync(join(root,'.integration-stage.json'),'utf8'));
    if(!fixture.founderBaseline||stage.fixtureDigest!==fixture.digest||existsSync(join(root,SETUP))
        ||existsSync(join(root,FOOD_TRIAL_STATE))||existsSync(join(root,'.local/simulation/integration-native-seal.json')))
        throw Error('Common founder tool requires its fresh unpublished integration stage');
    const receipt=JSON.parse(readFileSync(join(root,INTEGRATION_STATE),'utf8'));
    if(receipt.fixtureDigest!==fixture.digest||receipt.acceptance!=='not-run')throw Error('Common founder genesis receipt differs');
    for(const site of [nativeToolWorkPolicy.smelt.source,nativeToolWorkPolicy.repair.source,
        ...fixture.founderBaseline.beds.map(b=>({...b,debugName:'brownbed'}))])
        if(!World.getLoc(site.x,site.z,site.level,LocType.getId(site.debugName)))throw Error('Common founder packed site absent');
    const load=(p:string)=>import(pathToFileURL(join(root,p)).href),{SimulationClockStore}=await load('simulation-clock/store.ts'),
        {AgentStateStore}=await load('agent-state/store.ts'),{populationNeedsBinding}=await load('needs/population-binding.ts');
    const clock=new SimulationClockStore(join(root,'.local/simulation/simulation-clock.sqlite')),
        agents=new AgentStateStore(join(root,'.local/agent-state/agents.sqlite'),undefined,true),market=new MarketStore(join(root,'server/engine/data/player-checkpoints.sqlite'));
    try{
        const stamp=clock.get(fixture.clock.clockId);
        if(stamp.status!=='paused'||stamp.lastSimulationTime!==fixture.clock.initialSimulationTime)throw Error('Common founder clock moved before tool opening');
        const member=agents.getPopulationMember(fixture.kitchen.courierAgentId),{actorId,playerId,lifecycleId,worldId,clockId,clockProfileDigest}=populationNeedsBinding(receipt.worldId,member),
            owner={actorId,username:playerId,lifecycleId,worldId,clockId,clockProfileDigest},bytes=market.saved(playerId);
        if(!bytes)throw Error('Common founder native save missing');
        const player=PlayerLoading.load(playerId,new Packet(bytes),null),inv=player.getInventory(InvType.INV)!,slots=inv.items.flatMap((i,s)=>i?.id===1265?[s]:[]);
        if(slots.length!==1||inv.get(slots[0]!)?.count!==1||inv.getItemCount(2347)!==1
            ||[436,438,2349].some(id=>inv.getItemCount(id)!==0)||NativeToolStore.present(market.db))throw Error('Common founder tool/material opening differs');
        const itemInstanceId=randomUUID(),openingEvidenceDigest=hash({scope:'common-founder-genesis',fixtureDigest:fixture.digest,
            genesisResultDigest:receipt.resultDigest,owner,sourceCheckpointDigest:hash([...bytes]),itemId:1265,quantity:1});
        market.db.transaction(()=>{
            const tools=new NativeToolStore(market.db),item=tools.lifecycle.create({itemInstanceId,lifecycleTypeId:'bronze-pickaxe',ownerActorId:actorId,
                qualityBasisPoints:10000,provenanceDigest:openingEvidenceDigest,atSimulationTime:stamp.lastSimulationTime});
            new NativeMiningDemandStore(market.db);new NativeMiningIntentStore(market.db);new NativeMiningDispatchStore(market.db,true);new NativeMaterialStore(market.db,true);
            tools.put({schemaVersion:1,itemInstanceId,owner,position:{inventory:InvType.INV,slot:slots[0]!},status:'bound',reason:null,
                catalogDigest:nativeToolCatalog.digest,cycleDigest:nativeToolCycles.digest,checkpointDigest:hash([...bytes])});
            tools.append(`opening:${itemInstanceId}`,{kind:'explicit-opening',itemInstanceId,item,owner,evidenceDigest:openingEvidenceDigest});
        }).immediate();
        const body={schemaVersion:1,protocol:'si-c07-common-founder-native-setup-v1',fixtureDigest:fixture.digest,
            specificationDigest:fixture.founderBaseline.specificationDigest,sourceFixtureDigest:fixture.founderBaseline.sourceFixtureDigest,
            worldId:receipt.worldId,genesisResultDigest:receipt.resultDigest,owner,itemInstanceId,openingEvidenceDigest,
            declaredInitialDurability:100,inventoryTypeId:InvType.INV,sourceCheckpointDigest:hash([...bytes]),packedSitesVerified:true,
            housingRouteVerified:false,housingSleepVerified:false,warmupUses:0,liveStartAuthorized:false,providerCalls:0};
        writeFileSync(join(root,SETUP),JSON.stringify({...body,digest:digest(body)},null,2)+'\n',{flag:'wx'});
    }finally{market.db.close(true);agents.close();clock.close();}
}
