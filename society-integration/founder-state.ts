import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {AgentStateStore} from '../agent-state/store.js';
import {readFounderStageReceipt} from '../society-experiments/founder-stage.js';
import {nativeHousingCatalogs} from '../housing/native-rent.js';
import {nativeToolDigest,nativeToolCatalog,nativeToolCycles,type NativeToolBinding} from '../item-lifecycle/native-tool.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {check,integrationGenesis,type IntegrationFixture} from './fixture.js';
import {inspectPackedFounderBeds} from '../society-experiments/packed-housing-sites.js';
import {parsePlayerSaveBytes} from '../server/gateway/admin/save-reader.js';

/** Read-only checks for the additive 1.4 opening. No migrations or implicit native tool adoption. */
export function verifyCommonFounderOpening(root:string,fixture:IntegrationFixture,receipt:{worldId:string;resultDigest:string;lifecycles:any[]}){
    const plan=fixture.founderBaseline;check(plan,'Founder definition missing');
    check(digest(inspectPackedFounderBeds(root))===plan.packedBedsDigest,'Founder packed housing source changed');
    const setup=readFounderStageReceipt(root);
    check(setup.fixtureDigest===fixture.digest&&setup.specificationDigest===plan.specificationDigest&&setup.sourceFixtureDigest===plan.sourceFixtureDigest
        &&setup.worldId===receipt.worldId&&setup.genesisResultDigest===receipt.resultDigest&&integrationGenesis(root,fixture).resultDigest===receipt.resultDigest
        &&setup.declaredInitialDurability===100&&setup.packedSitesVerified===true&&setup.warmupUses===0
        &&setup.housingRouteVerified===false&&setup.housingSleepVerified===false&&setup.liveStartAuthorized===false&&setup.providerCalls===0,
        'Founder setup/genesis/authority differs');
    const runtime=JSON.parse(readFileSync(join(root,'config/llm-runtime.json'),'utf8'));
    check(!runtime.enabled&&!runtime.automaticReplanning&&!runtime.autonomousExecution.enabled&&!runtime.skillBuilder.enabled
        &&runtime.dailyBudget.maxCostMicros===0,'Founder opening must keep providers and autonomy off');
    const housing=nativeHousingCatalogs(root),unit=housing.units.units.find(u=>u.housingUnitId===housing.native.housingUnitId)!;
    check(unit.capacity===4&&digest(housing.native.beds)===digest(plan.beds),'Founder four-slot housing configuration differs');
    const agents=new AgentStateStore(join(root,'.local/agent-state/agents.sqlite'),undefined,true);
    try{
        check(agents.listAutonomyEnrollments().length===0,'Founder opening has an unapproved autonomy enrollment');
        for(const a of fixture.avatars){
            const knowledge=agents.listSkillKnowledge(a.agentId),expected=fixture.skills.filter(s=>a.knownSkills.includes(s.id));
            check(knowledge.length===expected.length&&expected.every(s=>knowledge.some(k=>k.skill.id===s.id&&k.skill.version===s.version&&k.status==='known')),
                `Founder exact knowledge differs: ${a.agentId}`);
        }
    }finally{agents.close();}
    function read<T>(path:string,work:(db:OwnedDatabase)=>T){const db=new OwnedDatabase(join(root,path),{readonly:true,strict:true});
        try{return work(db);}finally{db.close(true);}}
    read('.local/economy/businesses.sqlite',db=>{
        const b=db.query('SELECT * FROM business WHERE business_id=?1').get('si-c07-workshop') as any,
            workers=db.query('SELECT * FROM business_employment WHERE business_id=?1').all('si-c07-workshop') as any[],
            grants=db.query('SELECT * FROM business_facility_entitlement WHERE business_id=?1').all('si-c07-workshop') as any[];
        check(b?.owner_agent_id===fixture.kitchen.ownerAgentId&&b.property_id==='varrock.east-workshop'&&b.status==='active'
            &&workers.length===1&&workers[0].worker_agent_id===fixture.kitchen.courierAgentId&&workers[0].status==='active'&&workers[0].wage_gp===0
            &&workers[0].role_definition_id==='business.worker.v1'&&workers[0].required_skill_id==='procedure.tools.repair-bronze-pickaxe'
            &&workers[0].required_skill_version==='1.0.0','Founder workshop/employment authority differs');
        check(grants.length===1&&grants[0].property_id==='varrock.east-workshop'&&grants[0].facility_capability==='work-surface'
            &&grants[0].valid_from===fixture.clock.initialSimulationTime&&grants[0].valid_until===null,'Founder work-surface grant differs');
        check((db.query('SELECT COUNT(*) AS n FROM business_inventory WHERE business_id=?1 AND count>0').get('si-c07-workshop') as any).n===0,
            'Founder workshop has undeclared opening stock');
    });
    read('.local/economy/institution-treasury.sqlite',db=>{const t=db.query("SELECT * FROM institution_treasury WHERE actor_kind='business' AND actor_id=?1").get('si-c07-workshop') as any;
        // Normal genesis emits no treasury allocation/row for zero capital.
        check(!t||(t.balance_gp===0&&t.reserved_gp===0),'Founder workshop opening money differs');});
    read('.local/admin/properties.sqlite',db=>{const p=db.query('SELECT * FROM property_state WHERE property_id=?1').get('varrock.east-workshop') as any;
        check(p?.status==='owned'&&p.owner_kind==='business'&&p.owner_id==='si-c07-workshop','Founder workshop title differs');});
    read('server/engine/data/player-checkpoints.sqlite',db=>{
        const rows=db.query('SELECT payload,digest FROM native_tool_binding').all() as {payload:string;digest:string}[];
        check(rows.length===1,'Founder opening requires exactly one native tool binding');
        const row=rows[0]!,binding=JSON.parse(row.payload) as NativeToolBinding,
            life=receipt.lifecycles.find(l=>l.agentId===fixture.kitchen.courierAgentId)?.binding;
        check(life&&nativeToolDigest(binding)===row.digest&&binding.itemInstanceId===setup.itemInstanceId&&binding.status==='bound'&&binding.reason===null
            &&binding.catalogDigest===nativeToolCatalog.digest&&binding.cycleDigest===nativeToolCycles.digest
            &&digest(binding.owner)===digest(setup.owner)&&binding.owner.actorId===life.actorId&&binding.owner.username===life.playerId
            &&binding.owner.lifecycleId===life.lifecycleId&&binding.owner.worldId===receipt.worldId&&binding.owner.clockId===life.clockId
            &&binding.owner.clockProfileDigest===life.clockProfileDigest,'Founder native tool identity differs');
        const item=db.query('SELECT * FROM item_instance WHERE item_instance_id=?1').get(setup.itemInstanceId) as any,
            opening=db.query('SELECT payload,digest FROM native_tool_event WHERE event_id=?1').get(`opening:${setup.itemInstanceId}`) as any;
        check(item?.durability===100&&item.max_durability===100&&item.revision===1&&item.status==='usable'&&item.owner_actor_id===fixture.kitchen.courierAgentId
            &&item.provenance_digest===setup.openingEvidenceDigest&&item.created_at===fixture.clock.initialSimulationTime
            &&opening&&nativeToolDigest(JSON.parse(opening.payload))===opening.digest&&JSON.parse(opening.payload).evidenceDigest===setup.openingEvidenceDigest,
            'Founder tool opening/provenance differs');
        const bytes=(db.query('SELECT save FROM accounts WHERE owner=?1').get(binding.owner.username) as {save:Uint8Array}).save;
        const save=parsePlayerSaveBytes(bytes,fixture.clock.initialSimulationTime,true);
        check(Number.isSafeInteger(setup.inventoryTypeId)&&setup.inventoryTypeId>=0&&binding.position.inventory===setup.inventoryTypeId
            &&save.inventory.some(i=>i.slot===binding.position.slot&&i.id===1265&&i.count===1),
            'Founder tool binding is outside its actual native inventory slot');
        check(nativeToolDigest([...bytes])===setup.sourceCheckpointDigest&&binding.checkpointDigest===setup.sourceCheckpointDigest,
            'Founder native checkpoint changed after binding');
    });
    return{setupDigest:setup.digest,genesisResultDigest:receipt.resultDigest,itemInstanceId:setup.itemInstanceId,
        housingCapacity:4,paidTenancies:0,provenSleeps:0,warmupUses:0,providerCalls:0};
}
