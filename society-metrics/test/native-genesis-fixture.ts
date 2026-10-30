import {expect} from 'bun:test';
import {mkdtempSync,rmSync,cpSync,mkdirSync,readFileSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {OwnedDatabase} from '../../server/engine/src/io/OwnedDatabase.js';
import {SimulationClockStore} from '../../simulation-clock/store.js';
import {AgentStateStore} from '../../agent-state/store.js';
import {PlayerHealthEvidenceStore} from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import {PropertyStore} from '../../server/engine/src/mods/PropertyStore.js';
import {loadPropertyCatalog} from '../../server/engine/src/mods/Properties.js';
import {BusinessManagerStore} from '../../server/gateway/admin/business-manager.js';
import {InstitutionTreasuryStore} from '../../server/gateway/admin/institution-treasury.js';
import {LocalLostCityWorldGenesisAdapter,type LocalGenesisDependencies} from '../../server/gateway/admin/local-world-genesis-adapter.js';
import {startAdminWorldGenesis} from '../../server/gateway/admin/world-genesis.js';
import {buildWorldGenesisResult} from '../../world-genesis/result.js';
import {businessGenesisInventoryDigest} from '../../world-genesis/provenance.js';
import {loadWorldGenesisProfileCatalog} from '../../world-genesis/config.js';
import type {GenesisAssetAllocation} from '../../world-genesis/types.js';
import {SocietyIntegrityStore,saveValueSnapshot} from '../../society-integrity/store.js';
import {createSaveData} from '../../sdk/test/utils/save-generator.js';
import {parsePlayerSaveBytes} from '../../server/gateway/admin/save-reader.js';
import {nativeIntegrationOptions} from '../integration-sources.js';
import {reportNativeOutcomes,type NativeOutcomeOptions} from '../native-outcomes.js';
import {projectNativeMinimumAssessment} from '../minimum-assessment.js';
import {loadSocietyMinimumContract} from '../../society-minimum/contract.js';
import {readNativeFounderBaseline} from '../population-outcomes.js';
import {readNativeGenesisOpening} from '../genesis-opening.js';

export const genesisFixtureRoots:string[]=[],initial='2001-01-01T00:00:00.000Z',wall='2030-01-01T00:00:00.000Z';
export async function createNativeGenesisFixture(fullPolicy=false,register:(root:string)=>void=root=>genesisFixtureRoots.push(root),minimumScenario=false){
    const root=mkdtempSync(join(tmpdir(),'native-genesis-opening-'));register(root);cpSync(join(import.meta.dir,'../../config'),join(root,'config'),{recursive:true});
    if(minimumScenario){
        const unitsPath=join(root,'config/housing-units.json'),units=JSON.parse(readFileSync(unitsPath,'utf8')),nativePath=join(root,'config/native-housing.json'),native=JSON.parse(readFileSync(nativePath,'utf8'));
        const unit=units.units[0];unit.capacity=4;unit.rentPeriodSimulationMinutes=9*1440;
        for(let n=3;n<=4;n++){const bedSlotId=`falador.south-house.bed-${n}`;unit.bedSlots.push({bedSlotId,label:`Fixture bed ${n}`});native.beds.push({bedSlotId,x:2971,z:3330,level:n-3});}
        writeFileSync(unitsPath,JSON.stringify(units));writeFileSync(nativePath,JSON.stringify(native));
    }
    const configDirectory=join(root,'config'),agentPath=join(root,'.local/agent-state/agents.sqlite'),clockPath=join(root,'.local/simulation/simulation-clock.sqlite'),
        checkpointPath=join(root,'server/engine/data/checkpoints.sqlite'),healthPath=join(root,'server/engine/data/health.sqlite'),
        businessPath=join(root,'.local/economy/businesses.sqlite'),treasuryPath=join(root,'.local/economy/treasury.sqlite'),propertyPath=join(root,'server/engine/data/properties.sqlite'),
        genesisPath=join(root,'.local/admin/genesis.sqlite'),integrityPath=join(root,'.local/admin/integrity.sqlite');
    const clock=new SimulationClockStore(clockPath),created=clock.create({clockId:'world',status:'paused',profile:{schemaVersion:1,profileId:'opening-test',version:'1.0.0',seed:'opening',rate:{simulationMilliseconds:fullPolicy?3600000:1,wallMilliseconds:fullPolicy?600:1}},simulationTime:initial,wallTime:wall});
    const names=['ada','bea','cora','dora'],agents=new AgentStateStore(agentPath,{store:clock,clockId:'world'});
    for(const agentId of names){agents.createIdentity({agentId,playerUsername:agentId,displayName:agentId,background:'Local opening fixture',personalityTraits:['steady']},wall);
        if(fullPolicy)agents.setCharacterBirth(agentId,agents.getCharacterLifecycle(agentId)!.revision,initial,'born',wall);
    }agents.close();
    mkdirSync(dirname(checkpointPath),{recursive:true});const checkpoints=new OwnedDatabase(checkpointPath);checkpoints.run('CREATE TABLE accounts(owner TEXT PRIMARY KEY,save BLOB NOT NULL)');
    const summaries=new Map<string,any>();
    const put=(username:string,data:Uint8Array,savedAt:string)=>{checkpoints.run('INSERT OR REPLACE INTO accounts VALUES(?,?)',[username,data]);
        const parsed=parsePlayerSaveBytes(data,savedAt,true,true);expect(parsed.valid).toBeTrue();
        const items=(v:any[])=>v.filter(a=>a.id!==995).map(a=>({id:a.id,count:a.count}));
        const summary={savedAt,coins:parsed.coins,coinPlacement:'bank' as const,skills:parsed.skills.map(s=>({name:s.name,experience:s.experience})),
            position:parsed.position,inventory:items(parsed.inventory),bank:items(parsed.bank),equipment:parsed.equipment.map(a=>({id:a.id,count:a.count,slot:a.slot}))};
        summaries.set(username,summary);return summary;};
    for(const name of names)put(name,createSaveData({inventory:[{id:2347,count:1}]}),wall);
    const boundary={path:integrityPath,observe:()=>({clockId:'world',profileDigest:created.profileDigest,simulationTime:initial,wallTime:wall})};
    const business=new BusinessManagerStore(businessPath,undefined,boundary),treasury=new InstitutionTreasuryStore(treasuryPath,boundary),
        catalog=loadPropertyCatalog(join(configDirectory,'properties.json')),properties=new PropertyStore(catalog,propertyPath,initial),propertyId=catalog.properties[0]!.propertyId;
    const assets:GenesisAssetAllocation[]=[{allocationId:'ada-gp',kind:'currency',owner:{kind:'player',id:'ada'},amountGp:30},
        {allocationId:'ada-food',kind:'item',owner:{kind:'player',id:'ada'},container:'inventory',itemId:379,count:3,slot:null},
        {allocationId:'ada-bank',kind:'item',owner:{kind:'player',id:'ada'},container:'bank',itemId:436,count:2,slot:null},
        {allocationId:'forge-stock',kind:'item',owner:{kind:'business',id:'forge'},container:'business-stock',itemId:438,count:4,slot:null}];
    assets.push({allocationId:'forge',kind:'business',owner:{kind:'player',id:'ada'},businessId:'forge',openingCapitalGp:20,openingInventoryDigest:businessGenesisInventoryDigest(assets,'forge')},
        {allocationId:'forge-title',kind:'property',owner:{kind:'business',id:'forge'},propertyId},
        {allocationId:'faction-gp',kind:'currency',owner:{kind:'faction',id:'council'},amountGp:5});
    if(minimumScenario){
        assets.splice(assets.findIndex(a=>a.allocationId==='forge-title'),1,{allocationId:'founder-house',kind:'property',owner:{kind:'player',id:'ada'},propertyId:'falador.south-house'});
        for(const id of names)assets.push({allocationId:`reserve-${id}`,kind:'item',owner:{kind:'player',id},container:'inventory',itemId:379,count:8,slot:null},
            {allocationId:`rent-${id}`,kind:'currency',owner:{kind:'player',id},amountGp:1000});
        assets.push({allocationId:'mining-tool',kind:'item',owner:{kind:'player',id:'ada'},container:'inventory',itemId:1265,count:1,slot:null});
    }
    const profile=loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json')).profiles.find(p=>p.profileId==='mature-society')!;
    const result=buildWorldGenesisResult({schemaVersion:1,seed:'opening',profile:{profileId:profile.profileId,version:profile.version,digest:profile.digest},worldBuild:'local-fixture',
        simulationClock:{clockId:'world',profileDigest:created.profileDigest,initialSimulationTime:initial},parameters:{}},
        {assets,populationMembers:names.map(agentId=>({agentId,playerUsername:agentId}))},wall);
    const deps:LocalGenesisDependencies={
        async inspectPlayer(username){return{backups:[],readiness:{editable:true,code:'ready'},state:summaries.get(username)} as any;},
        async editPlayer(username,draft,commandId){const before=summaries.get(username),afterSavedAt='2030-01-01T00:00:01.000Z';
            const integrity=new SocietyIntegrityStore(integrityPath);try{integrity.before({source:'engine.offline-save',operationId:`offline-save:${commandId}`,actor:`player:${username}`,
                payload:{before:saveValueSnapshot(before),after:saveValueSnapshot({...draft,equipment:draft.equipment!,position:draft.position!})}},boundary.observe());}finally{integrity.close();}
            // The local adapter controls the draft; canonical bytes are the actual reader input.
            const after=put(username,createSaveData({inventory:draft.inventory,bank:[...draft.bank,...draft.coins?[{id:995,count:draft.coins}]:[]],equipment:draft.equipment as any,position:draft.position}),afterSavedAt);
            return{ok:true,operation:'edit',commandId,username,backupId:'fixture-backup',before,after};},
        async listProperties(){return{enabled:true,pendingPurchases:[],properties:properties.listProperties().map(p=>({...catalog.properties.find(c=>c.propertyId===p.propertyId)!,state:p}))} as any;},
        async assignProperty(r){return{ok:true,commandId:r.commandId,tick:1,assignment:properties.assignGenesis(r.allocationId,r.propertyId,r.expectedVersion,r.owner,initial)};},
        async resetProperty(){throw Error('Not used');},getBusiness:id=>business.get(id),getBusinessInventory:id=>business.listInventory(id),
        createBusiness:(id,input,now)=>business.createGenesis(id,input,now),resetBusiness:()=>{throw Error('Not used');},
        creditBusinessItem:(id,b,item,count,now)=>business.creditGenesisInventory(id,b,item,count,now),resetBusinessItem:()=>{throw Error('Not used');},
        getTreasury:(kind,id)=>treasury.get(kind,id),creditTreasury:(kind,id,allocationId,gp,now)=>treasury.creditGenesis(kind,id,allocationId,gp,now),resetTreasury:()=>{throw Error('Not used');}
    };
    const needs={...nativeIntegrationOptions(root),worldId:'fixture'},adapter=new LocalLostCityWorldGenesisAdapter(deps,{agentPath,simulationClock:{store:clock,clockId:'world'},
        profileCatalogPath:join(configDirectory,'world-genesis-profiles.json'),policyCatalogPath:join(configDirectory,'population-lifecycle-policies.json'),
        bindingCatalogPath:join(configDirectory,'population-world-profile-bindings.json'),integrityDbPath:integrityPath,needs});
    try{await startAdminWorldGenesis(result,result.resultDigest,adapter,{runDbPath:genesisPath,integrityDbPath:integrityPath,
        provenanceDbPath:join(root,'.local/admin/provenance.sqlite'),integrityPolicyPath:join(configDirectory,'society-integrity-policy.json')},wall);
        const a=new AgentStateStore(agentPath,undefined,true),health=new PlayerHealthEvidenceStore(healthPath);try{for(const id of names)health.bindFiniteAvatar(a.getPopulationMember(id)!);}finally{a.close();health.close();}
    }finally{checkpoints.close(true);business.close();treasury.close();properties.close();clock.close();}
    const scope={clockId:'world',clockProfileDigest:created.profileDigest,actorAgentIds:names,fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
    const opening={checkpointPath,clockPath,agentPath,healthPath,needsPath:needs.databasePath,businessPath,treasuryPath,propertyPath};
    const options:NativeOutcomeOptions={workspace:root,worldId:'fixture',agentPath,clockPath,allowedActorAgentIds:names,allowedObserverAgentIds:[],
        population:{genesisPath,integrityPath,healthPath,configDirectory,genesisResultId:result.resultId,genesisResultDigest:result.resultDigest,opening}};
    const contract=loadSocietyMinimumContract(configDirectory),outcomes=()=>reportNativeOutcomes(scope,options),report=()=>projectNativeMinimumAssessment(contract,scope,outcomes()),
        paths=[genesisPath,integrityPath,...Object.values(opening)],hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex'));
    return{root,scope,options,opening,contract,outcomes,report,hashes,agentPath,clockPath,genesisPath,integrityPath,healthPath};
}
