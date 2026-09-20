import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCompetenceSnapshot } from '../../character-attributes/index.js';
import { ItemLifecycleStore,ItemRepairService,loadItemLifecycleCatalog,loadItemRepairPolicyCatalog,
    loadProductionToolCycleCatalog,ProductionToolCycleService,validateItemRepairPolicyCatalog } from '../index.js';
import type { CompetenceSnapshot } from '../../character-attributes/index.js';
import type { ItemRepairRequest,RepairFacilityReceipt,RepairMaterialReceipt } from '../index.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function path(){const directory=mkdtempSync(join(tmpdir(),'item-repair-'));directories.push(directory);return join(directory,'items.sqlite');}
const root=join(import.meta.dir,'..','..','config');
const lifecycle=()=>loadItemLifecycleCatalog(join(root,'item-lifecycle.json'));
const policies=()=>loadItemRepairPolicyCatalog(join(root,'item-repair-policies.json'),lifecycle());
const cycles=()=>loadProductionToolCycleCatalog(join(root,'production-tool-cycles.json'),lifecycle());
function broken(store:ItemLifecycleStore){store.create({itemInstanceId:'pickaxe-1',lifecycleTypeId:'bronze-pickaxe',
    ownerActorId:'ada',qualityBasisPoints:10_000,provenanceDigest:'a'.repeat(64),atSimulationTime:'2030-01-01T00:00:00.000Z'});
    return store.use('mining-1','pickaxe-1',1,100,'b'.repeat(64),'2030-01-01T01:00:00.000Z');}
function competence(level:number|null=1,withFacility=true):CompetenceSnapshot{return validateCompetenceSnapshot({schemaVersion:1,
    snapshotId:`competence:ada:${level??'none'}:${withFacility?'facility':'none'}`,characterAgentId:'ada',
    observedAtSimulationTime:'2030-01-01T01:30:00.000Z',personalSkills:level===null?[]:[{kind:'personal-rs-skill',characterAgentId:'ada',
        skillId:'smithing',level}],learnedProcedures:[],providedCapabilities:withFacility?[{kind:'provided-capability',
        characterAgentId:'ada',capabilityId:'work-surface',provider:{kind:'facility',providerId:'workshop-1'},grantId:'grant-1'}]:[]});}
function material(overrides:Partial<RepairMaterialReceipt>={}):RepairMaterialReceipt{return{receiptId:'materials-1',actorId:'ada',
    itemInstanceId:'pickaxe-1',consumedItems:[{itemId:2349,quantity:1}],consumedAtSimulationTime:'2030-01-01T02:00:00.000Z',
    sourceEvidenceDigest:'c'.repeat(64),...overrides};}
function facility(overrides:Partial<RepairFacilityReceipt>={}):RepairFacilityReceipt{return{receiptId:'facility-1',actorId:'ada',
    capabilityId:'work-surface',providerId:'workshop-1',grantId:'grant-1',validFromSimulationTime:'2030-01-01T01:45:00.000Z',
    validUntilSimulationTime:'2030-01-01T03:00:00.000Z',sourceEvidenceDigest:'d'.repeat(64),...overrides};}
function request(overrides:Partial<ItemRepairRequest>={}):ItemRepairRequest{return{operationId:'repair-1',
    policyId:'bronze-pickaxe-workshop-repair',itemInstanceId:'pickaxe-1',actorId:'ada',expectedRevision:2,
    startedAtSimulationTime:'2030-01-01T02:00:00.000Z',finishedAtSimulationTime:'2030-01-01T02:10:00.000Z',
    materialReceipt:material(),competenceSnapshot:competence(),facilityReceipt:facility(),...overrides};}

describe('evidence-gated item repair',()=>{
    test('loads a bounded repair policy with material, time, competence and facility requirements',()=>{
        expect(policies().policies[0]).toEqual({policyId:'bronze-pickaxe-workshop-repair',lifecycleTypeId:'bronze-pickaxe',
            requiredStatus:'broken',restoredDurability:50,durationSeconds:600,materials:[{itemId:2349,quantity:1}],
            competence:{skillId:'smithing',minimumLevel:1},facility:{capabilityId:'work-surface'}});});
    test('repairs a broken pickaxe only after every exact requirement is evidenced',()=>{const store=new ItemLifecycleStore(path(),lifecycle());
        broken(store);const service=new ItemRepairService(store,policies());
        expect(service.repair(request())).toMatchObject({durability:50,status:'usable',revision:3});
        expect(new ProductionToolCycleService(store,cycles()).utility('bronze-pickaxe-mining','pickaxe-1','ada'))
            .toMatchObject({capabilityAvailable:true,remainingSuccessfulActions:50,remainingOutputCapacity:50,status:'available'});
        expect(store.verifyAuditChain()).toBeTrue();store.close();});
    test('rejects free, short, unskilled and facility-less repair attempts without mutation',()=>{const store=new ItemLifecycleStore(path(),lifecycle());
        broken(store);const service=new ItemRepairService(store,policies());
        expect(()=>service.repair(request({materialReceipt:material({consumedItems:[]})}))).toThrow('consumedItems');
        expect(()=>service.repair(request({finishedAtSimulationTime:'2030-01-01T02:09:59.000Z'}))).toThrow('duration');
        expect(()=>service.repair(request({competenceSnapshot:competence(null,true)}))).toThrow('competence');
        expect(()=>service.repair(request({competenceSnapshot:competence(1,false)}))).toThrow('facility');
        expect(store.get('pickaxe-1')).toMatchObject({durability:0,status:'broken',revision:2});store.close();});
    test('replays the exact repair and rejects changed evidence under the same operation id',()=>{const store=new ItemLifecycleStore(path(),lifecycle());
        broken(store);const service=new ItemRepairService(store,policies()),first=service.repair(request());
        expect(service.repair(request())).toEqual(first);
        expect(()=>service.repair(request({materialReceipt:material({sourceEvidenceDigest:'e'.repeat(64)})}))).toThrow('reused');
        store.use('mining-2','pickaxe-1',3,50,'f'.repeat(64),'2030-01-01T03:00:00.000Z');
        expect(()=>service.repair(request({operationId:'repair-2',expectedRevision:4,
            startedAtSimulationTime:'2030-01-01T04:00:00.000Z',finishedAtSimulationTime:'2030-01-01T04:10:00.000Z',
            materialReceipt:material({consumedAtSimulationTime:'2030-01-01T04:00:00.000Z'}),
            facilityReceipt:facility({validUntilSimulationTime:'2030-01-01T05:00:00.000Z'})}))).toThrow('already consumed');
        expect(store.get('pickaxe-1')).toMatchObject({durability:0,revision:4});store.close();});
    test('rejects tampered catalogs and unrepairable lifecycle bindings',()=>{const configured=policies(),definition=configured.policies[0]!;
        expect(()=>validateItemRepairPolicyCatalog({schemaVersion:1,policies:[{...definition,lifecycleTypeId:'unknown'}]},lifecycle()))
            .toThrow('invalid');const store=new ItemLifecycleStore(path(),lifecycle()),service=new ItemRepairService(store,configured);
        configured.policies[0]!.durationSeconds=1;expect(()=>service.repair(request())).toThrow('catalog digest mismatch');store.close();});
});
