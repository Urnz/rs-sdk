import { describe,expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadBatchExpiryPolicyCatalog,loadItemLifecycleCatalog,loadItemStatePolicyCatalog,
    resolvePreparedBatchExpiryContract,validateBatchExpiryPolicyCatalog } from '../index.js';

const root=join(import.meta.dir,'..','..','config');
const lifecycle=()=>loadItemLifecycleCatalog(join(root,'item-lifecycle.json'));
const states=()=>loadItemStatePolicyCatalog(join(root,'item-state-policies.json'),lifecycle());
const expiry=()=>loadBatchExpiryPolicyCatalog(join(root,'batch-expiry-policies.json'),states());
describe('prepared batch expiry contract',()=>{
    test('binds every perishable food batch to simulation-time shelf life and configurable storage quality',()=>{
        const stateCatalog=states(),catalog=expiry(),raw=resolvePreparedBatchExpiryContract(catalog,stateCatalog,377),
            cooked=resolvePreparedBatchExpiryContract(catalog,stateCatalog,379);
        expect(catalog.activation).toBe('prepared');expect(raw).toMatchObject({activation:'prepared',
            policy:{policyId:'perishable-food-v1',expiryClock:'simulation-time',defaultStorageProfileId:'ambient'},
            item:{itemId:377,shelfLifeSimulationMinutes:720}});
        expect(cooked.item).toEqual({itemId:379,shelfLifeSimulationMinutes:1440});
        expect(raw.policy.storageProfiles).toEqual([
            {storageProfileId:'ambient',label:'Ambient storage',shelfLifeMultiplierBasisPoints:10_000,requiredCapabilityId:null},
            {storageProfileId:'private-dry-storage',label:'Protected private storage',shelfLifeMultiplierBasisPoints:12_500,
                requiredCapabilityId:'storage.private'},
            {storageProfileId:'cold-storage',label:'Cold storage',shelfLifeMultiplierBasisPoints:30_000,
                requiredCapabilityId:'storage.cold'}]);
    });
    test('cannot accidentally activate expiry before persistent batch runtime exists',()=>{
        const configured=expiry(),{digest,...definition}=configured;
        expect(()=>validateBatchExpiryPolicyCatalog({...definition,activation:'active'},states())).toThrow('invalid');
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });
    test('requires exact two-way bindings between batch classifications and expiry items',()=>{
        const configured=expiry(),policy=configured.policies[0]!;
        expect(()=>validateBatchExpiryPolicyCatalog({schemaVersion:1,activation:'prepared',policies:[{...policy,
            items:policy.items.filter(item=>item.itemId!==379)}]},states())).toThrow('has no expiry policy');
        expect(()=>validateBatchExpiryPolicyCatalog({schemaVersion:1,activation:'prepared',policies:[{...policy,
            items:[...policy.items,{itemId:995,shelfLifeSimulationMinutes:60}]}]},states())).toThrow('no matching batch binding');
    });
    test('rejects ambiguous storage profiles and tampered catalogs',()=>{const configured=expiry(),policy=configured.policies[0]!;
        expect(()=>validateBatchExpiryPolicyCatalog({schemaVersion:1,activation:'prepared',policies:[{...policy,
            storageProfiles:[policy.storageProfiles[0]!,policy.storageProfiles[0]!]}]},states())).toThrow('unique');
        expect(()=>resolvePreparedBatchExpiryContract({...configured,digest:'0'.repeat(64)},states(),377)).toThrow('digest mismatch');
        expect(()=>resolvePreparedBatchExpiryContract(configured,states(),995)).toThrow('no batch expiry contract');
    });
});
