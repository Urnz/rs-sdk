import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync,cpSync,mkdirSync,readFileSync,copyFileSync} from 'node:fs';
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

const roots:string[]=[],initial='2001-01-01T00:00:00.000Z',wall='2030-01-01T00:00:00.000Z';
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function sql(path:string,command:string){const db=new OwnedDatabase(path);try{db.run(command);}finally{db.close(true);}}
async function fixture(){
    const root=mkdtempSync(join(tmpdir(),'native-genesis-opening-'));roots.push(root);cpSync(join(import.meta.dir,'../../config'),join(root,'config'),{recursive:true});
    const configDirectory=join(root,'config'),agentPath=join(root,'.local/agent-state/agents.sqlite'),clockPath=join(root,'.local/simulation/simulation-clock.sqlite'),
        checkpointPath=join(root,'server/engine/data/checkpoints.sqlite'),healthPath=join(root,'server/engine/data/health.sqlite'),
        businessPath=join(root,'.local/economy/businesses.sqlite'),treasuryPath=join(root,'.local/economy/treasury.sqlite'),propertyPath=join(root,'server/engine/data/properties.sqlite'),
        genesisPath=join(root,'.local/admin/genesis.sqlite'),integrityPath=join(root,'.local/admin/integrity.sqlite');
    const clock=new SimulationClockStore(clockPath),created=clock.create({clockId:'world',status:'paused',profile:{schemaVersion:1,profileId:'opening-test',version:'1.0.0',seed:'opening',rate:{simulationMilliseconds:1,wallMilliseconds:1}},simulationTime:initial,wallTime:wall});
    const names=['ada','bea','cora','dora'],agents=new AgentStateStore(agentPath,{store:clock,clockId:'world'});
    for(const agentId of names)agents.createIdentity({agentId,playerUsername:agentId,displayName:agentId,background:'Local opening fixture',personalityTraits:['steady']},wall);agents.close();
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
    return{root,scope,options,opening,contract,outcomes,report,hashes};
}
const gate=(r:ReturnType<typeof projectNativeMinimumAssessment>)=>r.integrity.find(g=>g.gateId==='applied-genesis-baseline')!.verdict;
test('applied genesis joins real local bootstrap receipts to canonical native opening and rereads offline without writes',async()=>{
    const f=await fixture(),before=f.hashes(),outcomes=f.outcomes();
    const baseline=readNativeFounderBaseline(f.scope,{...f.options,population:f.options.population!});
    expect(readNativeGenesisOpening(f.scope,{...f.options,population:f.options.population!},baseline)).toMatchObject({verdict:'pass',mismatches:[]});
    expect(outcomes.sources.genesisOpening.status).toBe('available');
    const r=f.report();expect(gate(r)).toBe('pass');expect(r.integrity.filter(g=>g.verdict==='pass').map(g=>g.gateId)).toEqual(['applied-genesis-baseline','frozen-founder-roster']);
    expect(r.qualifiesMinimum).toBeFalse();expect(r.verdict).toBe('inconclusive');expect(f.report().digest).toBe(r.digest);expect(f.hashes()).toEqual(before);
});
for(const [label,key,command] of [
    ['player','checkpointPath',"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'"],
    ['business-stock','businessPath','UPDATE business_inventory SET count=count+1'],
    ['treasury','treasuryPath','UPDATE institution_treasury SET balance_gp=balance_gp+1'],
    ['property','propertyPath',"UPDATE property_state SET owner_id='foreign' WHERE status='owned'"]
] as const)test(`applied genesis reports verified ${label} opening mismatch as FAIL without a full run`,async()=>{
    const f=await fixture();sql(f.opening[key],command);const r=f.report();expect(gate(r)).toBe('fail');expect(r.verdict).toBe('fail');expect(r.qualifiesMinimum).toBeFalse();
    const short={...f.scope,toSimulationTime:'2001-01-03T00:00:00.000Z'},partial=projectNativeMinimumAssessment(f.contract,short,reportNativeOutcomes(short,f.options));
    expect(partial.bindingStatus).toBe('invalid');expect(gate(partial)).toBe('fail');
});
test('applied genesis requires explicit complete paused opening and exact receipt; missing, late and foreign sources never donate PASS',async()=>{
    const f=await fixture(),p=f.options.population!;
    for(const opening of [undefined,{...f.opening,checkpointPath:join(f.root,'server/engine/data/missing.sqlite')},
        {...f.opening,checkpointPath:join(f.root,'../outside.sqlite')}]){
        const o={...f.options,population:{...p,opening}};expect(gate(projectNativeMinimumAssessment(f.contract,f.scope,reportNativeOutcomes(f.scope,o)))).toBe('inconclusive');}
    sql(f.opening.clockPath,'UPDATE simulation_clock SET last_simulation_ms=last_simulation_ms+1000');expect(gate(f.report())).toBe('inconclusive');
    sql(f.opening.clockPath,'UPDATE simulation_clock SET last_simulation_ms=last_simulation_ms-1000');
    sql(p.genesisPath,"UPDATE world_genesis_application SET receipt_json='{\"fixture\":true}'");expect(gate(f.report())).toBe('inconclusive');
});
test('applied genesis snapshot paths can be restored separately; a foreign scope cannot donate its PASS or FAIL',async()=>{
    const f=await fixture(),frozen=join(f.root,'.local/opening');mkdirSync(frozen,{recursive:true});
    const opening={...f.opening};for(const key of Object.keys(opening) as (keyof typeof opening)[]){const target=join(frozen,`${key}.sqlite`);copyFileSync(opening[key],target);opening[key]=target;}
    f.options.population!.opening=opening;expect(gate(f.report())).toBe('pass');
    sql(f.opening.checkpointPath,"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'");expect(gate(f.report())).toBe('pass');
    const scope={...f.scope,clockId:'foreign'};expect(gate(projectNativeMinimumAssessment(f.contract,scope,f.outcomes()))).toBe('inconclusive');
});
test('verified physical opening FAIL survives a different missing source without claiming complete opening coverage',async()=>{
    const f=await fixture();sql(f.opening.checkpointPath,"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'");
    f.options.population!.opening={...f.opening,treasuryPath:join(f.root,'.local/missing.sqlite')};
    const source=f.outcomes().sources.genesisOpening;expect(source.status).toBe('available');
    if(source.status==='available')expect(source.value).toMatchObject({verdict:'fail',completeOpeningSources:false,mismatches:['player-opening-state']});
    expect(gate(f.report())).toBe('fail');
});
for(const [label,key,command,expected] of [
    ['native property receipt','propertyPath','DELETE FROM property_genesis_assignment','fail'],
    ['native stock receipt','businessPath',"UPDATE business_genesis_inventory SET count=count+1",'fail'],
    ['native treasury receipt','treasuryPath',"UPDATE institution_treasury_genesis SET amount_gp=amount_gp+1",'fail'],
    ['bootstrap permit','integrityPath',"UPDATE integrity_permit SET consumed=0",'inconclusive'],
    ['opening snapshot','integrityPath',"DELETE FROM integrity_event WHERE event_id LIKE 'opening:player:ada:%'",'inconclusive']
] as const)test(`applied genesis checks ${label} instead of trusting the application status`,async()=>{
    const f=await fixture(),path=key==='integrityPath'?f.options.population!.integrityPath:f.opening[key];sql(path,command);expect(gate(f.report())).toBe(expected);
});
