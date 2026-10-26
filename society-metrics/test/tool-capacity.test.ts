import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { NativeToolStore,nativeToolDigest } from '../../item-lifecycle/native-tool.js';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { assessSocietyMinimum } from '../../society-minimum/assessment.js';
import { readToolCapacityLedger } from '../tool-capacity-ledger.js';
import { projectToolCapacity,toolCapacityCells } from '../tool-capacity.js';
const config=join(import.meta.dir,'../../config'),contract=loadSocietyMinimumContract(config),initial='2001-01-01T00:00:00.000Z';
const scope={clockId:'world',clockProfileDigest:'a'.repeat(64),actorAgentIds:['ada','bea','cora','dora'],fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
function ledger(){const db=new OwnedDatabase(':memory:'),store=new NativeToolStore(db);store.lifecycle.create({itemInstanceId:'pick',lifecycleTypeId:'bronze-pickaxe',ownerActorId:'ada',qualityBasisPoints:10000,
    provenanceDigest:'b'.repeat(64),atSimulationTime:initial});return{db,store,read:()=>readToolCapacityLedger(db,contract,config,scope.toSimulationTime)};}
test('native borrowed schema, wear and transfers replay without resetting capacity or depending on shared user_version',()=>{
    const f=ledger();try{f.db.run('PRAGMA user_version=42');f.store.lifecycle.use('wear','pick',1,30,'c'.repeat(64),scope.fromSimulationTime);
        f.store.lifecycle.transfer('trade','pick',2,'ada','bea','d'.repeat(64),scope.toSimulationTime);
        expect(f.read().instances).toEqual([{itemInstanceId:'pick',lifecycleTypeId:'bronze-pickaxe',durability:70,retired:false}]);
        f.db.run('UPDATE item_instance SET durability=100');expect(f.read).toThrow();
    }finally{f.db.close(true);}
});
test('replacement retires the predecessor; unmatched audit, future state and unknown schema cannot become capacity',()=>{
    const f=ledger();try{
        f.store.lifecycle.use('wear','pick',1,100,'c'.repeat(64),scope.fromSimulationTime);
        f.store.lifecycle.replace({operationId:'replace',replacedItemInstanceId:'pick',replacementItemInstanceId:'successor',expectedRevision:2,ownerActorId:'ada',qualityBasisPoints:10000,
            provenanceDigest:'d'.repeat(64),evidenceDigest:'e'.repeat(64),atSimulationTime:scope.toSimulationTime});
        expect(f.read().instances.map(i=>[i.itemInstanceId,i.durability,i.retired])).toEqual([['pick',0,true],['successor',100,false]]);
        expect(()=>readToolCapacityLedger(f.db,contract,config,scope.fromSimulationTime)).toThrow();
        f.db.run('UPDATE item_lifecycle_schema SET version=99');expect(f.read).toThrow();
    }finally{f.db.close(true);}
});
function point(at:string,lower='100',upper=lower):any{return{at,worldId:'world',clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,contractDigest:contract.digest,
    cohort:scope.actorAgentIds.map(actorId=>({binding:{actorId},admission:{kind:'genesis'},initializedAt:initial})),
    cycles:[{cycleId:'bronze-pickaxe-mining',lifecycleTypeId:'bronze-pickaxe',capabilityId:'mining.copper-tin',outputItemIds:[436,438],outputQuantityPerAction:1,lower,upper}],auditDigests:['b'.repeat(64)],events:[]};}
function projection(a:any,b:any){return projectToolCapacity(scope,'world',{status:'available',digest:'d'.repeat(64),value:{boundaries:[a,b].map(value=>({at:value.at,source:{status:'available',digest:nativeToolDigest(value),value}}))}});}
function verdict(a:any,b:any,original=()=>true){const report=projection(a,b);return assessSocietyMinimum(contract,{...scope,worldId:'world',contractDigest:contract.digest,founderAgentIds:scope.actorAgentIds,
    genesisAppliedAtSimulationTime:initial},toolCapacityCells(contract,report,original),[]).requirements.find(r=>r.requirementId==='tool-service-capacity-retention')!.verdict;}
test('capacity retention compares remaining output, not tool count:50 after repair is below100 opening',()=>{
    expect(verdict(point(scope.fromSimulationTime),point(scope.toSimulationTime,'50'))).toBe('fail');
    expect(verdict(point(scope.fromSimulationTime),point(scope.toSimulationTime))).toBe('pass');
    expect(verdict(point(scope.fromSimulationTime),point(scope.toSimulationTime,'50','150'))).toBe('inconclusive');
    expect(verdict(point(scope.fromSimulationTime,'0','100'),point(scope.toSimulationTime))).toBe('inconclusive');
});
test('missing closing, changed capability, foreign original admission and a truncated/divergent lifecycle prefix stay inconclusive',()=>{
    const a=point(scope.fromSimulationTime);
    for(const change of [(b:any)=>{b.at='2001-01-08T00:00:00.000Z';},(b:any)=>{b.cycles[0].capabilityId='other';},
        (b:any)=>{b.auditDigests=[];},(b:any)=>{b.auditDigests[0]='e'.repeat(64);},(b:any)=>{b.worldId='foreign';}]){
        const b=point(scope.toSimulationTime,'50');change(b);expect(verdict(a,b)).toBe('inconclusive');
    }
    expect(verdict(a,point(scope.toSimulationTime),()=>false)).toBe('inconclusive');
    a.events=[{id:'opening:pick',digest:'e'.repeat(64)}];expect(verdict(a,point(scope.toSimulationTime))).toBe('inconclusive');
});
