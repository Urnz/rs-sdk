import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import ObjType from '../cache/config/ObjType.js';
import ParamType from '../cache/config/ParamType.js';
import { ParamHelper } from '../cache/config/ParamHelper.js';
import type Loc from '../engine/entity/Loc.js';
import Player, { getLevelByExp } from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import World from '../engine/World.js';
import { PlayerInventoryEscrowStore, type PlayerInventoryEscrowWallet } from './PlayerInventoryEscrowStore.js';
import { nativeMiningToolForWork, type NativeMiningPorts } from './NativeMiningTool.js';
import { nativeToolDigest, NativeToolStore, type NativeToolOwner } from '../../../../item-lifecycle/native-tool.js';
import { ItemRepairService } from '../../../../item-lifecycle/repair-policy.js';
import { validateCompetenceSnapshot } from '../../../../character-attributes/competence.js';
import { NativeToolWorkStore, type NativeToolWorkKind, type NativeToolWorkRecord, type ToolWorkAccess } from '../../../../production-workflow/native-tool-work.js';
import { nativeRepairPolicies, nativeRepairPolicy, nativeSmeltRecipe, nativeToolWorkPolicy, TOOL_WORK_SKILLS } from '../../../../production-workflow/native-tool-work-policy.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

export interface NativeToolWorkCommand {operationId:string;kind:NativeToolWorkKind;username:string;businessId:string|null;contextDigest:string}
export interface NativeToolWorkPorts extends NativeMiningPorts {
    clock():SimulationClockObservation;
    source(kind:NativeToolWorkKind):Loc|null;
    authorize(player:Player,kind:NativeToolWorkKind,businessId:string|null,clock:SimulationClockObservation,actor:NativeToolOwner,command:NativeToolWorkCommand):ToolWorkAccess;
}
function owner(p:NativeToolWorkPorts,player:Player,id:string):NativeToolOwner{
    const context=p.identity(player.username,id,0,World.currentTick);
    if(!context||context.clock.status!=='running'||context.clock.clockId!==context.action.clockId
        ||context.clock.profileDigest!==context.action.clockProfileDigest)throw new Error('Native tool worker lifecycle/clock unavailable');
    const{actorId,username,lifecycleId,worldId,clockId,clockProfileDigest}=context.action;
    return{actorId,username,lifecycleId,worldId,clockId,clockProfileDigest};
}
function inputs(kind:NativeToolWorkKind){return kind==='smelt'?[{id:436,count:1},{id:438,count:1}]:[{id:2349,count:1}];}
export class NativeToolWorkExecutor {
    readonly sessionId=randomUUID();
    readonly work:NativeToolWorkStore;
    constructor(readonly ports:NativeToolWorkPorts){this.work=new NativeToolWorkStore(ports.market.db);}
    private validate(player:Player,command:NativeToolWorkCommand,clock:SimulationClockObservation){
        const p=this.ports,actual=owner(p,player,command.operationId),minimum=command.kind==='repair'
            ?nativeRepairPolicy.competence.minimumLevel:nativeSmeltRecipe.requirements.personalSkills[0]!.minimumLevel;
        if(player.populationTerminal||player.levels[PlayerStat.HITPOINTS]<=0||clock.status!=='running'
            ||clock.clockId!==actual.clockId||clock.profileDigest!==actual.clockProfileDigest||clock.engineTick!==World.currentTick
            ||player.levels[PlayerStat.SMITHING]<minimum||getLevelByExp(player.stats[PlayerStat.SMITHING])<minimum)throw new Error('Native tool work needs a live skilled worker and exact engine clock');
        const source=p.source(command.kind),expected=nativeToolWorkPolicy[command.kind].source;
        if(!source||LocType.get(source.type).debugname!==expected.debugName||source.x!==expected.x||source.z!==expected.z||source.level!==expected.level
            ||player.level!==source.level||Math.max(Math.abs(player.x-source.x),Math.abs(player.z-source.z))>1)
            throw new Error('Native tool work facility is absent/unreachable');
        const access=p.authorize(player,command.kind,command.businessId,clock,actual,command),skill=TOOL_WORK_SKILLS[command.kind];
        if(access.skill.id!==skill.id||(access.trialRunId?access.skill.version!=='0.1.0'||!/^[a-f0-9-]{36}$/.test(access.trialRunId):access.skill.version!==skill.version)||!/^([a-f0-9]{64})$/.test(access.skill.checksum)
            ||!/^([a-f0-9]{64})$/.test(access.digest)||(command.kind==='repair'&&!access.facility))throw new Error('Native tool work lacks verified procedure/facility access');
        return{owner:actual,access};
    }
    start(command:NativeToolWorkCommand,player:Player):NativeToolWorkRecord{
        if(this.ports.market.db.inTransaction)throw new Error('Native tool start needs the engine tick commit boundary');
        if(Object.keys(command).sort().join(',')!=='businessId,contextDigest,kind,operationId,username'
            ||!['smelt','repair'].includes(command.kind)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(command.operationId)
            ||!/^[a-f0-9]{64}$/.test(command.contextDigest)||player.username!==command.username
            ||(command.kind==='smelt'?command.businessId!==null:typeof command.businessId!=='string'||!/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(command.businessId)))
            throw new Error('Invalid typed native tool work command');
        const prior=this.work.get(command.operationId);
        if(prior){if(prior.intent.kind!==command.kind||prior.intent.owner.username!==command.username
            ||prior.intent.contextDigest!==command.contextDigest||prior.intent.businessId!==command.businessId)throw new Error('Native tool work operation identity conflict');return prior;}
        if(player.activeScript||player.protect||player.target)throw new Error('Native tool worker is busy');
        const clock=this.ports.clock(),verified=this.validate(player,command,clock),store=new NativeToolStore(this.ports.market.db);
        const tool=command.kind==='repair'?nativeMiningToolForWork(player,command.operationId):null;
        if(tool&&(tool.item.status!=='broken'||tool.item.ownerActorId!==verified.owner.actorId))throw new Error('Native repair requires the owned broken tool');
        const intent={...command,owner:verified.owner,itemInstanceId:tool?.item.itemInstanceId??null,expectedRevision:tool?.item.revision??null,
            escrowId:randomUUID(),policyDigest:nativeToolWorkPolicy.digest,authorityDigest:verified.access.digest,skill:verified.access.skill};
        delete (intent as Partial<NativeToolWorkCommand>).username;
        const intentDigest=nativeToolDigest(intent),inv=player.getInventory(InvType.INV)!;
        const original=[...inv.items],counts=original.map(item=>item?.count);
        const restore=()=>original.forEach((item,slot)=>{if(item)item.count=counts[slot]!;inv.set(slot,item);});let result!:NativeToolWorkRecord;
        try{this.ports.market.db.transaction(()=>{
            const escrow=new PlayerInventoryEscrowStore(this.ports.market),wallet=this.wallet(player);
            const account={owner:player.username,save:()=>this.save(player),rollback:restore};
            escrow.mutateWithCheckpoint({operation:'hold',escrowId:intent.escrowId,username:player.username,assets:{gp:0,items:inputs(command.kind)}},wallet,account,clock.wallTime,intentDigest);
            if(command.kind==='repair')escrow.mutateWithCheckpoint({operation:'consume',escrowId:intent.escrowId,username:player.username},wallet,account,clock.wallTime,intentDigest);
            const capability=verified.access.facility;
            const competence=command.kind==='repair'?validateCompetenceSnapshot({schemaVersion:1,snapshotId:`repair:${command.operationId}`,
                characterAgentId:verified.owner.actorId,observedAtSimulationTime:clock.simulationTime,
                personalSkills:[{kind:'personal-rs-skill',characterAgentId:verified.owner.actorId,skillId:'smithing',level:getLevelByExp(player.stats[PlayerStat.SMITHING])}],
                learnedProcedures:verified.access.trialRunId?[]:[{kind:'verified-agent-skill',characterAgentId:verified.owner.actorId,skill:verified.access.skill,
                    learnedAtSimulationTime:clock.simulationTime,status:'verified',executable:true}],
                providedCapabilities:[{kind:'provided-capability',characterAgentId:verified.owner.actorId,capabilityId:'work-surface',
                    provider:{kind:'facility',providerId:capability!.providerId},grantId:capability!.grantId}]}):null;
            result=this.work.write({schemaVersion:1,intent,intentDigest,phase:'working',reason:null,progressMs:0,workTicks:0,revision:1,
                started:clock,last:{clock,sessionId:this.sessionId,valid:true},competence,materialDigest:nativeToolDigest(escrow.get(intent.escrowId)),result:null});
            this.save(player);
        }).immediate();}catch(error){restore();throw error;}
        player.nativeToolWorkOperationId=command.operationId;return result;
    }
    private wallet(player:Player):PlayerInventoryEscrowWallet{return{count:id=>player.getInventory(InvType.INV)!.getItemCount(id),
        remove:(id,count)=>player.invDel(InvType.INV,id,count),add:(id,count)=>player.invAdd(InvType.INV,id,count)};}
    private save(player:Player):Uint8Array{this.ports.checkpoint([player]);const bytes=player.save(false);this.ports.market.checkpoint(player.username,bytes,true);return bytes;}
    advance(id:string,player:Player|null):NativeToolWorkRecord{
        const prior=this.work.get(id);if(!prior)throw new Error('Native tool work missing');if(prior.phase==='completed')return prior;
        if(this.ports.market.db.inTransaction)throw new Error('Native tool work needs the engine tick commit boundary');
        const clock=this.ports.clock();
        if(prior.last.sessionId===this.sessionId&&prior.last.clock.engineTick===clock.engineTick)return prior;
        let verified:ReturnType<NativeToolWorkExecutor['validate']>|null=null,reason:string|null=null;
        try{
            if(!player)throw new Error('Native tool worker is offline');
            verified=this.validate(player,{operationId:id,kind:prior.intent.kind,username:prior.intent.owner.username,businessId:prior.intent.businessId,contextDigest:prior.intent.contextDigest},clock);
            if(nativeToolDigest(verified.owner)!==nativeToolDigest(prior.intent.owner)||verified.access.digest!==prior.intent.authorityDigest
                ||nativeToolDigest(verified.access.skill)!==nativeToolDigest(prior.intent.skill)||prior.intent.policyDigest!==nativeToolWorkPolicy.digest)
                throw new Error('Native tool work authority/policy changed');
            if(player.activeScript||player.protect||player.target)throw new Error('Native tool worker is busy');
            if(Date.parse(clock.simulationTime)<Date.parse(prior.last.clock.simulationTime)
                ||Date.parse(clock.wallTime)<Date.parse(prior.last.clock.wallTime))throw new Error('Native tool work clock regressed');
            if(prior.intent.kind==='repair'){
                const tool=nativeMiningToolForWork(player,id);
                if(tool.item.itemInstanceId!==prior.intent.itemInstanceId||tool.item.revision!==prior.intent.expectedRevision||tool.item.status!=='broken')
                    throw new Error('Repair tool identity/revision changed');
            }else if(player.getInventory(InvType.INV)!.freeSlotCount<2)throw new Error('Native smelting projection has no capacity');
        }catch(error){reason=error instanceof Error?error.message:String(error);verified=null;}
        const consecutive=verified&&prior.last.valid&&prior.last.sessionId===this.sessionId
            &&clock.clockId===prior.intent.owner.clockId&&clock.profileDigest===prior.intent.owner.clockProfileDigest
            &&clock.engineTick===Number(prior.last.clock.engineTick)+1&&Date.parse(clock.simulationTime)>=Date.parse(prior.last.clock.simulationTime)
            &&Date.parse(clock.wallTime)>Date.parse(prior.last.clock.wallTime)&&Date.parse(clock.wallTime)-Date.parse(prior.last.clock.wallTime)<=1200;
        const duration=prior.intent.kind==='repair'?nativeRepairPolicy.durationSeconds*1000:nativeSmeltRecipe.durationSimulationMinutes*60000;
        const progressMs=consecutive?Math.min(duration,prior.progressMs+Date.parse(clock.simulationTime)-Date.parse(prior.last.clock.simulationTime)):prior.progressMs;
        const record:NativeToolWorkRecord={...prior,phase:verified?'working':'paused',reason,progressMs,
            workTicks:prior.workTicks+(consecutive?1:0),revision:prior.revision+1,last:{clock,sessionId:this.sessionId,valid:!!verified}};
        if(player)player.nativeToolWorkOperationId=verified?id:null;
        const inv=player?.getInventory(InvType.INV),original=inv?[...inv.items]:null;
        const counts=original?.map(item=>item?.count);
        const stats=player?.stats.slice(),levels=player?.levels.slice(),base=player?.baseLevels.slice(),xp=player?[...player.nativeAttributeXpReceipts]:null;
        try{this.ports.market.db.transaction(()=>{
            if(verified&&player&&progressMs>=duration&&(prior.intent.kind==='repair'||record.workTicks>=nativeToolWorkPolicy.smelt.durationTicks)){
                const escrow=new PlayerInventoryEscrowStore(this.ports.market),held=escrow.get(prior.intent.escrowId);
                if(!held||nativeToolDigest(held.assets)!==nativeToolDigest({gp:0,items:inputs(prior.intent.kind)})
                    ||held.status!==(prior.intent.kind==='repair'?'committed':'held')||held.username!==player.username
                    ||nativeToolDigest(held)!==prior.materialDigest)throw new Error('Native tool work material custody differs');
                const store=new NativeToolStore(this.ports.market.db);
                if(prior.intent.kind==='repair'){
                    const access=verified.access.facility!;
                    const tool=new ItemRepairService(store.lifecycle,nativeRepairPolicies).repair({operationId:id,
                        policyId:nativeRepairPolicy.policyId,itemInstanceId:prior.intent.itemInstanceId!,actorId:prior.intent.owner.actorId,
                        expectedRevision:prior.intent.expectedRevision!,startedAtSimulationTime:prior.started.simulationTime,finishedAtSimulationTime:clock.simulationTime,
                        materialReceipt:{receiptId:prior.intent.escrowId,actorId:prior.intent.owner.actorId,itemInstanceId:prior.intent.itemInstanceId!,
                            consumedItems:nativeRepairPolicy.materials,consumedAtSimulationTime:prior.started.simulationTime,sourceEvidenceDigest:prior.materialDigest},
                        competenceSnapshot:prior.competence!,facilityReceipt:{receiptId:`facility:${id}`,actorId:prior.intent.owner.actorId,
                            capabilityId:'work-surface',providerId:access.providerId,grantId:access.grantId,
                            validFromSimulationTime:prior.started.simulationTime,validUntilSimulationTime:clock.simulationTime,sourceEvidenceDigest:access.sourceEvidenceDigest}});
                    record.result={kind:'repair',inputItems:inputs('repair'),outputItems:[],tool,checkpointDigest:nativeToolDigest([...this.save(player)]),script:null};
                }else{
                    const before={copper:inv!.getItemCount(436),tin:inv!.getItemCount(438),bar:inv!.getItemCount(2349)};
                    for(const item of inputs('smelt'))if(inv!.add(item.id,item.count)!==item.count)throw new Error('Native smelting input projection overflow');
                    const struct=ParamHelper.getIntParam(ParamType.getId('smelting_struct'),ObjType.get(2349),-1),script=ScriptProvider.getByName('[queue,smelting_ore]');
                    if(!script||struct<0)throw new Error('Packed bronze smelting procedure is absent');
                    const state=ScriptRunner.init(script,player,null,[struct,1]);state.nativeToolWorkOperationId=id;
                    state.execution=player.runScript(state,true);
                    if(state.execution!==ScriptState.FINISHED||inv!.getItemCount(436)!==before.copper||inv!.getItemCount(438)!==before.tin
                        ||inv!.getItemCount(2349)!==before.bar+1)throw new Error('Packed bronze smelting did not consume exact input/output');
                    escrow.mutateWithCheckpoint({operation:'consume',escrowId:prior.intent.escrowId,username:player.username},this.wallet(player),
                        {owner:player.username,save:()=>this.save(player),rollback:()=>{}},clock.wallTime,prior.intentDigest);
                    record.result={kind:'smelt',inputItems:inputs('smelt'),outputItems:[{id:2349,count:1}],tool:null,
                        checkpointDigest:nativeToolDigest([...this.save(player)]),script:script.name};
                }
                record.phase='completed';record.reason=null;
                store.append(`work:${id}`,{kind:prior.intent.kind==='repair'?'repaired':'smelted',intent:prior.intent,clock,workSimulationMs:progressMs,
                    nativeWorkTicks:record.workTicks,materialDigest:prior.materialDigest,result:record.result});
            }
            this.work.write(record);
        }).immediate();}catch(error){
            if(inv&&original&&counts)original.forEach((item,slot)=>{if(item)item.count=counts[slot]!;inv.set(slot,item);});
            if(player&&stats&&levels&&base&&xp){player.stats.set(stats);player.levels.set(levels);player.baseLevels.set(base);player.nativeAttributeXpReceipts=xp;}
            throw error;
        }
        if(player&&record.phase==='completed')player.nativeToolWorkOperationId=null;
        return record;
    }
}
