import {parsePlayerSaveBytes} from '../../server/gateway/admin/save-reader.js';
import {expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import type {OwnedDatabase} from '../../server/engine/src/io/OwnedDatabase.js';
import type {SimulationClockStore} from '../../simulation-clock/store.js';
import type {SimulationClockObservation} from '../../simulation-clock/types.js';
import type {NeedsStore} from '../../needs/store.js';
import type {NativeIntegrationOptions} from '../integration-sources.js';
import type {NativeOutcomeOptions} from '../native-outcomes.js';
import {NativeToolStore,nativeToolDigest as hash,nativeToolCatalog,nativeToolCycles} from '../../item-lifecycle/native-tool.js';
import {NativeToolWorkStore,type NativeToolWorkRecord} from '../../production-workflow/native-tool-work.js';
import {NativeMaterialStore} from '../../production-workflow/native-material.js';
import {nativeToolWorkPolicy,nativeRepairPolicies,nativeRepairPolicy,TOOL_WORK_SKILLS} from '../../production-workflow/native-tool-work-policy.js';
import {ItemRepairService} from '../../item-lifecycle/repair-policy.js';
import {validateCompetenceSnapshot} from '../../character-attributes/index.js';
import {PlayerInventoryEscrowStore} from '../../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import {NativeRentCoordinator} from '../../housing/native-rent-runtime.js';
import {nativeHousingCatalogs,rentIds,writeRentJournal} from '../../housing/native-rent.js';
import {createSaveData} from '../../sdk/test/utils/save-generator.js';
import {foodDigest} from '../../server/engine/src/mods/NativeFoodConsumptionStore.js';
import {populationNeedsBinding} from '../../needs/population-binding.js';
import type {AgentStateStore} from '../../agent-state/store.js';
import {NativeFoodConsumptionProjection} from '../../food-loop/native-consumption-store.js';
import {loadFoodLoopCatalog} from '../../food-loop/catalog.js';
import {NativeFoodSource} from '../../food-loop/native-source.js';
import {closeFoodDeliveryTick} from '../../server/engine/src/mods/NativeFoodDeliveryStore.js';
import {miningGatherArgs} from '../../sdk/mining-demand.js';
import {recordMiningExecutorAdmission} from '../../agent-skills/mining-request-source.js';

interface Fixture {
    root:string;db:OwnedDatabase;clock:SimulationClockStore;agents:AgentStateStore;clockPath:string;
    scope:{clockId:string;clockProfileDigest:string;actorAgentIds:string[];fromSimulationTime:string;toSimulationTime:string};
    actors:Array<{actorId:string;username:string;lifecycleId:string}>;options:NativeOutcomeOptions;
    produce(variant?:string,consumer?:string):void;
}

/** Component-producer integration fixture, not an autonomous/packed-engine economic run.
 * Every result is read from actual native SQLite stores; no assessment cells are supplied.
 * The warmup deliberately wears the original tool down to one use. Evaluation repairs
 * restore its capacity without pretending that a 50-use repair replaces a virgin100.
 */
export function createMinimumActions(f:Fixture,integration:NativeIntegrationOptions,needs:NeedsStore,needsDb:Database){
    const tool=new NativeToolStore(f.db),materials=new NativeMaterialStore(f.db),work=new NativeToolWorkStore(f.db),
        initial='2001-01-01T00:00:00.000Z',opening=f.clock.observe('world','2030-01-01T00:00:00.000Z',0),
        binding=(id:string)=>populationNeedsBinding('fixture',f.agents.getPopulationMember(id)!),
        b=binding('ada'),owner={actorId:b.actorId,username:b.playerId,lifecycleId:b.lifecycleId,worldId:b.worldId,clockId:b.clockId,clockProfileDigest:b.clockProfileDigest},
        itemId='minimum-original-pick',projection=new NativeFoodConsumptionProjection(needsDb,needs,loadFoodLoopCatalog(join(f.root,'config/food-loops.json'))),
        rent=new NativeRentCoordinator({workspace:f.root,worldId:'fixture',housingPath:integration.housingPath,
            propertyPath:f.options.population!.opening!.propertyPath,checkpointPath:f.options.checkpointPath!});
    const actor=(id:string)=>({agentId:id,username:id,lifecycleId:binding(id).lifecycleId});
    const catalogs=nativeHousingCatalogs(f.root);
    // Three paid tenants and the original owner share four distinct physical slots.
    // No external landlord or post-genesis grant is needed.
    for(const [index,id] of ['bea','cora','dora'].entries()){
        const order=rent.reserve({operationId:`minimum-rent-${id}`,worldId:'fixture',clockId:opening.clockId,clockProfileDigest:opening.profileDigest,
            tenant:actor(id),landlord:actor('ada'),housingUnitId:catalogs.native.housingUnitId,bedSlotId:catalogs.native.beds[index]!.bedSlotId,
            startsAt:initial,endsAt:'2001-01-10T00:00:00.000Z',expiresAt:'2030-01-01T00:05:00.000Z',amountGp:500,propertyVersion:2,catalogs},opening);
        const ids=rentIds(order.binding.intent.operationId),escrow=new PlayerInventoryEscrowStore({db:f.db,checkpoint(){}}),
            wallet=(gp:number)=>({count:()=>gp,remove:(_id:number,n:number)=>{gp-=n;return n;},add:(_id:number,n:number)=>{gp+=n;return n;}}),
            account=(name:string)=>({owner:name,save:()=>createSaveData({}),rollback(){}});
        escrow.mutateWithCheckpoint({operation:'hold',escrowId:ids.escrowId,username:id,assets:{gp:500,items:[]}},wallet(1000),account(id),opening.wallTime,order.binding.digest);
        escrow.mutateWithCheckpoint({operation:'commit',escrowId:ids.escrowId,username:id,payeeUsername:'ada'},wallet(0),account('ada'),opening.wallTime,order.binding.digest);
        const facts={binding:order.binding,phase:'paid' as const,clock:opening,before:{tenant:1000,landlord:0},after:{tenant:500,landlord:500},
            checkpoints:{tenant:'a'.repeat(64),landlord:'b'.repeat(64)}};
        f.db.transaction(()=>writeRentJournal(f.db,'native_rent',{...facts,digest:foodDigest(facts)})).immediate();rent.finalize(order.binding.intent.operationId);
    }
    rent.close();
    const item=tool.lifecycle.create({itemInstanceId:itemId,lifecycleTypeId:'bronze-pickaxe',ownerActorId:'ada',qualityBasisPoints:10000,provenanceDigest:'a'.repeat(64),atSimulationTime:initial});
    tool.append(`opening:${itemId}`,{kind:'explicit-opening',itemInstanceId:itemId,item,owner,evidenceDigest:'b'.repeat(64)});
    const mine=(clock:SimulationClockObservation,outputItemId=436)=>{
        const actionId=randomUUID(),before=tool.lifecycle.get(itemId)!,source={actionId,owner,toolPosition:{inventory:93,slot:0},
            source:{kind:'loc',typeId:1,x:3230,z:3149,level:0},outputItemId,outputQuantity:1,clock,checkpointDigest:'c'.repeat(64)},
            after=tool.cycle.recordUse({receiptId:actionId,cycleId:'bronze-pickaxe-mining',itemInstanceId:itemId,actorId:'ada',expectedRevision:before.revision,
                skillName:'Mining',successfulActions:1,outputItemId,outputQuantity:1,sourceEvidenceDigest:hash(source),atSimulationTime:clock.simulationTime});
        tool.append(actionId,{kind:'mined',source,before,after,lifecycleAuditValid:tool.lifecycle.verifyAuditChain()});
        materials.append({kind:'mining',lotId:`mine:${actionId}`,itemId:outputItemId,owner,clock,nativeEventId:actionId,nativeEventDigest:hash(tool.event(actionId))});return`mine:${actionId}`;
    };
    let copper='',tin='';
    let pending:NativeToolWorkRecord|null=null,bar='';
    const startWork=(kind:'smelt'|'repair',clock:SimulationClockObservation)=>{
        const operationId=randomUUID(),escrowId=randomUUID(),instance=tool.lifecycle.get(itemId)!,
            intent={operationId,kind,owner,businessId:kind==='repair'?'fixture-workshop':null,itemInstanceId:kind==='repair'?itemId:null,
                expectedRevision:kind==='repair'?instance.revision:null,escrowId,policyDigest:nativeToolWorkPolicy.digest,
                authorityDigest:'a'.repeat(64),skill:{...TOOL_WORK_SKILLS[kind],checksum:'b'.repeat(64)},contextDigest:'c'.repeat(64)},intentDigest=hash(intent),
            inputs=kind==='smelt'?[{itemId:436,slot:1,lotId:copper},{itemId:438,slot:2,lotId:tin}]:[{itemId:2349,slot:1,lotId:bar}],
            escrow=new PlayerInventoryEscrowStore({db:f.db,checkpoint(){}}),balances=new Map(inputs.map(i=>[i.itemId,1])),wallet={count:(id:number)=>balances.get(id)??0,remove:(id:number,n:number)=>{balances.set(id,(balances.get(id)??0)-n);return n;},add:(id:number,n:number)=>{balances.set(id,(balances.get(id)??0)+n);return n;}},
            account={owner:'ada',save:()=>createSaveData({}),rollback(){}};
        f.db.transaction(()=>{
            escrow.mutateWithCheckpoint({operation:'hold',escrowId,username:'ada',assets:{gp:0,items:inputs.map(i=>({id:i.itemId,count:1}))}},wallet,account,clock.wallTime,intentDigest);
            if(kind==='repair')escrow.mutateWithCheckpoint({operation:'consume',escrowId,username:'ada'},wallet,account,clock.wallTime,intentDigest);
            materials.append({kind:'hold',operationId,workKind:kind,intentDigest,escrowId,owner,clock,inputs});
            const competence=kind==='repair'?validateCompetenceSnapshot({schemaVersion:1,snapshotId:`repair:${operationId}`,characterAgentId:'ada',observedAtSimulationTime:clock.simulationTime,
                personalSkills:[{kind:'personal-rs-skill',characterAgentId:'ada',skillId:'smithing',level:1}],learnedProcedures:[],
                providedCapabilities:[{kind:'provided-capability',characterAgentId:'ada',capabilityId:'work-surface',provider:{kind:'facility',providerId:'workshop'},grantId:'grant'}]}):null;
            pending=work.write({schemaVersion:1,intent,intentDigest,phase:'working',reason:null,progressMs:0,workTicks:0,revision:1,started:clock,
                last:{clock,sessionId:'minimum-work',valid:true},competence,materialDigest:hash(escrow.get(escrowId)),result:null});
        }).immediate();
    };
    const finishWork=(clock:SimulationClockObservation)=>{expect(pending).not.toBeNull();const p=pending!,i=p.intent,kind=i.kind,
        progressMs=kind==='repair'?nativeRepairPolicy.durationSeconds*1000:120000;
        f.db.transaction(()=>{
            let repaired=null;if(kind==='repair')repaired=new ItemRepairService(tool.lifecycle,nativeRepairPolicies).repair({operationId:i.operationId,policyId:nativeRepairPolicy.policyId,
                itemInstanceId:itemId,actorId:'ada',expectedRevision:i.expectedRevision!,startedAtSimulationTime:p.started.simulationTime,finishedAtSimulationTime:clock.simulationTime,
                materialReceipt:{receiptId:i.escrowId,actorId:'ada',itemInstanceId:itemId,consumedItems:nativeRepairPolicy.materials,consumedAtSimulationTime:p.started.simulationTime,sourceEvidenceDigest:p.materialDigest},
                competenceSnapshot:p.competence!,facilityReceipt:{receiptId:`facility:${i.operationId}`,actorId:'ada',capabilityId:'work-surface',providerId:'workshop',grantId:'grant',
                    validFromSimulationTime:p.started.simulationTime,validUntilSimulationTime:clock.simulationTime,sourceEvidenceDigest:'d'.repeat(64)}});
            else new PlayerInventoryEscrowStore({db:f.db,checkpoint(){}}).mutateWithCheckpoint({operation:'consume',escrowId:i.escrowId,username:'ada'},
                {count:()=>1,remove:(_id,n)=>n,add:(_id,n)=>n},{owner:'ada',save:()=>createSaveData({}),rollback(){}},clock.wallTime,p.intentDigest);
            const result={kind,inputItems:kind==='smelt'?[{id:436,count:1},{id:438,count:1}]:[{id:2349,count:1}],outputItems:kind==='smelt'?[{id:2349,count:1}]:[],
                tool:repaired,checkpointDigest:'e'.repeat(64),script:kind==='smelt'?'[queue,smelting_ore]':null},
                done=work.write({...p,phase:'completed',progressMs,workTicks:3,revision:2,last:{clock,sessionId:'minimum-work',valid:true},result});
            tool.append(`work:${i.operationId}`,{kind:kind==='smelt'?'smelted':'repaired',intent:i,clock,workSimulationMs:progressMs,nativeWorkTicks:done.workTicks,materialDigest:p.materialDigest,result});
            if(kind==='smelt'){bar=`smelt:${i.operationId}`;materials.append({kind:'smelt',lotId:bar,itemId:2349,operationId:i.operationId,owner,clock,
                nativeEventId:`work:${i.operationId}`,nativeEventDigest:hash(tool.event(`work:${i.operationId}`))});}
        }).immediate();pending=null;
    };
    // Keep the original physical binding synchronized with canonical bytes, never infer an instance from an item count.
    const bind=()=>{const row=f.db.query('SELECT save FROM accounts WHERE owner=?').get('ada') as {save:Uint8Array};
        // The actual slot is found in the canonical save by the test producer below.
        tool.put({schemaVersion:1,itemInstanceId:itemId,owner,position:{inventory:93,slot:parsePlayerSaveBytes(row.save,initial,true,true).inventory.find(i=>i.id===1265)!.slot!},status:'bound',reason:null,
            catalogDigest:nativeToolCatalog.digest,cycleDigest:nativeToolCycles.digest,checkpointDigest:hash([...row.save])});};
    return{beforeAdvance(n:number,c:SimulationClockObservation){
        for(const id of f.scope.actorAgentIds){if(n%12===3)f.clock.startPlayerSleep('world',id,{sleeperKind:'npc-agent',sleepPlaceId:`fixture-${id}`,
                access:{kind:'physical-presence',evidenceId:`fixture-presence-${id}`,sourceDigest:hash([id,c]),validUntilSimulationTime:null}},c.wallTime,c.engineTick!);
            if(n>0&&n%12===0)f.clock.recordPlayerRest('world',id,'awake',c.wallTime,c.engineTick!);}
    },afterAdvance(n:number,c:SimulationClockObservation){
        if(n>0&&n%12===0){for(const id of f.scope.actorAgentIds)f.produce('normal',id);closeFoodDeliveryTick(f.db,c);
            const source=new NativeFoodSource({workspace:f.root,worldId:'fixture',checkpointPath:f.options.checkpointPath!});
            try{source.snapshot(()=>{const entries=source.current().entries;for(let sequence=(projection.cursor()?.sequence??0)+1;sequence<=entries.length;sequence++){
                const delivered=source.delivery(sequence),id=delivered.result.action.actorId,b=binding(id);
                projection.apply(source,sequence,{binding:b,clock:c,history:f.clock.getPlayerTimeHistory('world',id),playerTime:f.clock.getPlayerTimeState('world',id),expectedRevision:needs.get(b)!.revision});
            }});}finally{source.close();}}
        if(n===1)f.db.transaction(()=>{for(let k=0;k<99;k++){const lot=mine(c,k===98?438:436);if(k===97)copper=lot;if(k===98)tin=lot;}}).immediate();
        if(n===25)f.db.transaction(()=>mine(c)).immediate();if(n===26)startWork('smelt',c);if(n===27)finishWork(c);
        if(n===28)startWork('repair',c);if(n===29)finishWork(c);if(n===30)f.db.transaction(()=>mine(c)).immediate();
        if(n===40){const body={schemaVersion:1 as const,username:'ada',checksum:'a'.repeat(64),args:miningGatherArgs({name:'copper',item:'copper ore',skill:'Mining',timeoutMs:1000}),
            context:{runId:randomUUID(),skill:{id:'mining.fixture',version:'1.0.0'},stepId:'gather',parametersDigest:'b'.repeat(64),operationSequence:1},
            admittedAt:c.wallTime,expiresAtWallTime:new Date(Date.parse(c.wallTime)+1000).toISOString()},admission={...body,digest:hash(body)};
            recordMiningExecutorAdmission(f.root,admission,'requested');recordMiningExecutorAdmission(f.root,admission,'closed');}
        bind();
    },close(){}};
}
