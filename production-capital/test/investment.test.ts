import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FacilityCapabilityAuthorization } from '../../facility-capability/index.js';
import { ItemLifecycleStore, loadItemLifecycleCatalog } from '../../item-lifecycle/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { loadDefaultProductionCapitalCatalog, ProductionCapitalInvestmentStore, ProductionCapitalService } from '../index.js';

const directories:string[]=[],root=join(import.meta.dir,'..','..','config');
afterEach(()=>{directories.splice(0).forEach(directory=>rmSync(directory,{recursive:true,force:true}))});
const authorization:FacilityCapabilityAuthorization={subjectAgentId:'owner',facilityId:'varrock.east-workshop.forge',
    capabilityId:'smithing.basic-forging',at:'2030-01-01T00:00:00.000Z',propertyId:'varrock.east-workshop',businessId:null,
    capacityUnits:1,grantId:'forge-grant',accessKind:'employment',sourceEvidenceId:'facility-proof',catalogDigest:'a'.repeat(64)};
function fixture(){const directory=mkdtempSync(join(tmpdir(),'capital-investment-'));directories.push(directory);
    const businessPath=join(directory,'business.sqlite'),itemPath=join(directory,'items.sqlite'),manager=new BusinessManagerStore(businessPath);
    manager.create({businessId:'varrock-smiths',name:'Varrock Smiths',summary:'Capital investor.',ownerAgentId:'owner',
        propertyId:'varrock.east-workshop'});manager.creditGenesisInventory('produced-bellows','varrock-smiths',65000,1);manager.close();
    const lifecycleCatalog=loadItemLifecycleCatalog(join(root,'item-lifecycle.json'));
    return{businessPath,itemPath,lifecycleCatalog,investments:new ProductionCapitalInvestmentStore(businessPath,
        loadDefaultProductionCapitalCatalog(),lifecycleCatalog)}}
const request={operationId:'invest-bellows-1',businessId:'varrock-smiths',actorAgentId:'owner',
    capitalAssetTypeId:'workshop.bronze-bellows',itemInstanceId:'bellows-from-production-1',sourceStorageId:null,
    qualityBasisPoints:10_000,productionEvidenceDigest:'b'.repeat(64),installationEvidenceId:'install-bellows-1',
    facilityAuthorization:authorization,atSimulationTime:'2030-01-01T00:00:00.000Z'};

describe('audited Business production-capital investment',()=>{
    test('consumes one produced asset and measurably improves later production',()=>{const fixtureValue=fixture(),
        {businessPath,itemPath,lifecycleCatalog,investments}=fixtureValue;try{const committed=investments.commit(request,()=>true);
            expect(investments.commit(request,()=>true)).toEqual(committed);
            const manager=new BusinessManagerStore(businessPath);try{expect(manager.listInventory('varrock-smiths')
                .find(item=>item.itemId===65000)?.count).toBe(0)}finally{manager.close()}
            const lifecycle=new ItemLifecycleStore(itemPath,lifecycleCatalog);try{const item=investments.materialize(
                    request.operationId,lifecycle,()=>true);expect(item).toMatchObject({ownerActorId:'varrock-smiths',
                    lifecycleTypeId:'workshop-bellows',durability:200});
                expect(investments.materialize(request.operationId,lifecycle,()=>true)).toEqual(item);
                const projection=new ProductionCapitalService(lifecycle,loadDefaultProductionCapitalCatalog()).project(
                    request.capitalAssetTypeId,request.itemInstanceId,request.businessId,committed.installation,
                    {durationSimulationMinutes:100,qualityBasisPoints:8_000,failureBasisPoints:2_000,capacityUnits:2},10,()=>true);
                expect(projection.effective).toEqual({durationSimulationMinutes:80,qualityBasisPoints:8_500,
                    failureBasisPoints:1_000,capacityUnits:3});expect(investments.verifyAuditChain()).toBeTrue();
            }finally{lifecycle.close()}
        }finally{investments.close()}});
    test('rejects untrusted facility authority and changed replay without consuming another asset',()=>{const{businessPath,investments}=fixture();
        try{expect(()=>investments.commit(request,()=>false)).toThrow('authority');
            let manager=new BusinessManagerStore(businessPath);expect(manager.listInventory('varrock-smiths')
                .find(item=>item.itemId===65000)?.count).toBe(1);manager.close();investments.commit(request,()=>true);
            expect(()=>investments.commit({...request,qualityBasisPoints:9_000},()=>true)).toThrow('reused');
            manager=new BusinessManagerStore(businessPath);expect(manager.listInventory('varrock-smiths')
                .find(item=>item.itemId===65000)?.count).toBe(0);manager.close();
        }finally{investments.close()}});
});
