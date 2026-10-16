import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { BusinessAssetStore } from '../index.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'business-assets-'));directories.push(directory);
    const path=join(directory,'business.sqlite');
    const manager=new BusinessManagerStore(path);manager.create({businessId:'lumbridge-store',name:'Store',
        summary:'Finite stock.',ownerAgentId:'owner',propertyId:'lumbridge-general-store'});
    manager.creditGenesisInventory('opening-hammers','lumbridge-store',2347,10);
    manager.hire('lumbridge-store',{workerAgentId:'manager',role:'manager',title:'Manager',wageGp:10});
    manager.hire('lumbridge-store',{workerAgentId:'clerk',roleDefinitionId:'business.shop-clerk.v1',
        title:'Clerk',wageGp:5});manager.close();return {path,assets:new BusinessAssetStore(path)}}

describe('Business-owned inventory and storage',()=>{
    test('keeps storage separate and moves stock atomically with an immutable audit receipt',()=>{const {assets}=fixture();
        try{const storage=assets.createStorage({storageId:'back-room',businessId:'lumbridge-store',actorAgentId:'manager',
            name:'Back room',propertyId:'lumbridge-general-store',capacityUnits:20});expect(storage.usedUnits).toBe(0);
            const move={operationId:'stock-hammers-1',businessId:'lumbridge-store',actorAgentId:'clerk',itemId:2347,
                count:6,sourceStorageId:null,targetStorageId:'back-room'};
            expect(assets.move(move)).toMatchObject(move);expect(assets.move(move)).toEqual(assets.listMovements('lumbridge-store')[0]);
            expect(assets.listAssets('lumbridge-store',null).find(item=>item.itemId===2347)?.count).toBe(4);
            expect(assets.listAssets('lumbridge-store','back-room')).toMatchObject([{storageId:'back-room',itemId:2347,count:6}]);
        }finally{assets.close()}});
    test('rolls back insufficient and over-capacity moves without an audit entry',()=>{const {assets}=fixture();try{
        assets.createStorage({storageId:'tiny',businessId:'lumbridge-store',actorAgentId:'owner',name:'Tiny',capacityUnits:2});
        assets.createStorage({storageId:'warehouse',businessId:'lumbridge-store',actorAgentId:'owner',
            name:'Warehouse',capacityUnits:20});
        const base={businessId:'lumbridge-store',actorAgentId:'owner',itemId:2347,sourceStorageId:null,targetStorageId:'tiny'};
        expect(()=>assets.move({...base,operationId:'too-large',count:3})).toThrow('capacity');
        expect(()=>assets.move({...base,targetStorageId:'warehouse',operationId:'too-many',count:11}))
            .toThrow('insufficient');
        expect(assets.listMovements('lumbridge-store')).toEqual([]);
        expect(assets.listAssets('lumbridge-store',null).find(item=>item.itemId===2347)?.count).toBe(10);
    }finally{assets.close()}});
    test('requires exact employment permissions and rejects changed operation replay',()=>{const {assets}=fixture();try{
        assets.createStorage({storageId:'vault',businessId:'lumbridge-store',actorAgentId:'owner',name:'Vault',capacityUnits:20});
        expect(()=>assets.createStorage({storageId:'other',businessId:'lumbridge-store',actorAgentId:'clerk',
            name:'Other',capacityUnits:20})).toThrow('storage.assign');
        const move={operationId:'owner-move',businessId:'lumbridge-store',actorAgentId:'owner',itemId:2347,count:1,
            sourceStorageId:null,targetStorageId:'vault'};assets.move(move);
        expect(()=>assets.move({...move,count:2})).toThrow('reused');
    }finally{assets.close()}});
});
