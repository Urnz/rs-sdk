import { describe,expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadItemLifecycleCatalog,loadItemStatePolicyCatalog,resolveItemStateRule,
    validateItemStatePolicyCatalog } from '../index.js';

const root=join(import.meta.dir,'..','..','config');
const lifecycle=()=>loadItemLifecycleCatalog(join(root,'item-lifecycle.json'));
const policy=()=>loadItemStatePolicyCatalog(join(root,'item-state-policies.json'),lifecycle());
describe('item state classification policy',()=>{
    test('classifies durable tools, fungible stacks and provenance batches explicitly',()=>{
        const configured=policy();
        expect(resolveItemStateRule(configured,1265)).toMatchObject({mode:'instance',lifecycleTypeId:'bronze-pickaxe'});
        expect(resolveItemStateRule(configured,995)).toMatchObject({mode:'stack',lifecycleTypeId:null,batchPolicyId:null});
        expect(resolveItemStateRule(configured,377)).toMatchObject({mode:'batch',batchPolicyId:'perishable-food-v1'});
        expect(configured.digest).toMatch(/^[0-9a-f]{64}$/);
    });
    test('fails closed for an unclassified item or tampered policy',()=>{
        const configured=policy();expect(()=>resolveItemStateRule(configured,2347)).toThrow('no state policy');
        expect(()=>resolveItemStateRule({...configured,digest:'0'.repeat(64)},1265)).toThrow('digest mismatch');
    });
    test('requires exact lifecycle and batch bindings for each mode',()=>{
        const configured=policy();
        expect(()=>validateItemStatePolicyCatalog({schemaVersion:1,rules:[{...configured.rules[4]!,
            lifecycleTypeId:'unknown-tool'}]},lifecycle())).toThrow('instance binding');
        expect(()=>validateItemStatePolicyCatalog({schemaVersion:1,rules:[{...configured.rules[0]!,
            batchPolicyId:'unexpected'}]},lifecycle())).toThrow('stack binding');
        expect(()=>validateItemStatePolicyCatalog({schemaVersion:1,rules:[{...configured.rules[2]!,
            batchPolicyId:null}]},lifecycle())).toThrow('batch binding');
    });
    test('rejects duplicate item decisions and arbitrary extra fields',()=>{
        const configured=policy();
        expect(()=>validateItemStatePolicyCatalog({schemaVersion:1,
            rules:[configured.rules[0]!,configured.rules[0]!]},lifecycle())).toThrow('unique item ids');
        expect(()=>validateItemStatePolicyCatalog({schemaVersion:1,rules:configured.rules,defaultMode:'stack'},lifecycle()))
            .toThrow('invalid');
    });
});
