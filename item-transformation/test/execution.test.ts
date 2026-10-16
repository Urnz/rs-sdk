import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { itemProvenancePolicyDigest, ItemProvenanceStore,
    type ItemProvenancePolicyCatalog, type TransformProvenanceAssets } from '../../item-provenance/index.js';
import type { ThievingOutcomeReceipt } from '../../thieving-procedures/index.js';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const at=(minute:number)=>`2030-01-01T10:${String(minute).padStart(2,'0')}:00.000Z`;
function policy():ItemProvenancePolicyCatalog{const definition={schemaVersion:1 as const,rules:[
    {itemId:377,itemName:'Raw lobster',tier:'provenance-lot' as const,rationale:'Tracked test input.'},
    {itemId:379,itemName:'Lobster',tier:'provenance-lot' as const,rationale:'Tracked test output.'}]};
    return{...definition,digest:itemProvenancePolicyDigest(definition)}}
function setup(stock=2){const root=mkdtempSync(join(tmpdir(),'item-transformation-execution-'));roots.push(root);
    const path=join(root,'shared.sqlite'),raw=new Database(path,{create:true});
    raw.run(`CREATE TABLE business_inventory(business_id TEXT NOT NULL,item_id INTEGER NOT NULL,count INTEGER NOT NULL,
        revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(business_id,item_id))`);
    raw.run(`CREATE TABLE business_storage(storage_id TEXT PRIMARY KEY,business_id TEXT NOT NULL)`);
    raw.run(`CREATE TABLE business_storage_item(business_id TEXT NOT NULL,storage_id TEXT NOT NULL,item_id INTEGER NOT NULL,
        count INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(storage_id,item_id))`);
    raw.run('INSERT INTO business_inventory VALUES(?1,377,?2,1,?3)',['fishers',stock,at(0)]);raw.close(true);
    const store=new ItemProvenanceStore(path,policy());
    store.register({eventId:'register-stolen-lot',assetId:'raw-lobster-lot',itemId:377,quantity:2,
        titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'victim'},evidence:{evidenceId:'catch-proof',
            sourceDomain:'item-lifecycle',sourceRecordId:'catch-1',sourceStateVersion:1,
            sourceEvidenceDigest:'a'.repeat(64),occurredAt:at(0)}},()=>true,at(0));
    const receipt:ThievingOutcomeReceipt={receiptId:'theft-receipt-1',evidenceId:'engine-evidence-1',
        procedureId:'container.theft',procedureVersion:'1.0.0',procedureKind:'container-theft',actorAgentId:'thief',
        playerUsername:'thief',target:{kind:'loc',typeId:1,instanceIndex:null,name:'Crate',x:1,z:1,level:0},
        result:'succeeded',effect:'item-transfer',transferredItems:[{itemId:377,itemName:'Raw lobster',quantity:2}],
        thievingXpDelta:5,startedAtEngineTick:1,endedAtEngineTick:2,sourceEventId:'engine-theft-1',
        sourceEvidenceDigest:'b'.repeat(64),occurredAt:at(1),receiptDigest:'c'.repeat(64),recordedAt:at(1)};
    store.recordTheft({eventId:'theft-event-1',claimId:null,assetId:'raw-lobster-lot',expectedRevision:1,itemId:377,
        quantity:2,titleOwner:{kind:'agent',id:'victim'},previousHolder:{kind:'agent',id:'victim'},
        thiefAgentId:'thief',unitValueCoins:null},receipt,()=>true,at(1));
    store.transferCustody({eventId:'custody-to-fishers',assetId:'raw-lobster-lot',expectedRevision:2,
        from:{kind:'agent',id:'thief'},to:{kind:'business',id:'fishers'},evidence:{evidenceId:'trade-proof',
            sourceDomain:'trade',sourceRecordId:'trade-1',sourceStateVersion:1,sourceEvidenceDigest:'d'.repeat(64),
            occurredAt:at(2)}},()=>true,at(2));return{path,store}}
function request(){return{transformationId:'cook-lobster-1',businessId:'fishers',
    inputs:[{assetId:'raw-lobster-lot',expectedRevision:3,storageId:null}],
    outputs:[{assetId:'cooked-lobster-lot',itemId:379,quantity:2,storageId:null}],evidence:{
        sourceRecordId:'production-step-1',recipeId:'food.cook-lobster',recipeVersion:'1.0.0',
        recipeCatalogDigest:'e'.repeat(64),sourceEvidenceDigest:'f'.repeat(64),occurredAt:at(3)}}}

describe('atomic exact crafting lineage',()=>{
    test('consumes exact inputs, creates exact outputs and retains stolen ancestry across restart',()=>{
        const{path,store}=setup();const verify=(value:Readonly<TransformProvenanceAssets>)=>value.evidence.recipeId==='food.cook-lobster'
            &&value.inputs.length===1&&value.outputs[0]?.itemId===379&&value.outputs[0].quantity===2;
        const first=store.transform(request(),verify,at(3));expect(store.transform(request(),verify,at(3))).toEqual(first);
        expect(store.getAsset('raw-lobster-lot')).toMatchObject({lifecycleStatus:'consumed',
            consumedByTransformationId:'cook-lobster-1'});
        expect(store.getAsset('cooked-lobster-lot')).toMatchObject({lifecycleStatus:'active',quantity:2,
            titleOwner:{kind:'agent',id:'victim'},holder:{kind:'business',id:'fishers'},theftHistoryCount:1});
        expect(store.listAncestorAssetIds('cooked-lobster-lot')).toEqual(['raw-lobster-lot']);
        const raw=new Database(path);expect(raw.query('SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=377')
            .get('fishers')).toEqual({count:0});expect(raw.query(
            'SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=379').get('fishers')).toEqual({count:2});raw.close(true);
        expect(store.verifyAuditChain()).toBeTrue();store.close();const restarted=new ItemProvenanceStore(path,policy());
        try{expect(restarted.listAncestorAssetIds('cooked-lobster-lot')).toEqual(['raw-lobster-lot']);
            expect(restarted.getTransformation('cook-lobster-1')).toEqual(first)}finally{restarted.close()}
    });
    test('rolls back both stock and provenance when aggregate inventory cannot be debited',()=>{
        const{path,store}=setup(1);try{expect(()=>store.transform(request(),()=>true,at(3))).toThrow('stock is insufficient');
            expect(store.getAsset('raw-lobster-lot')).toMatchObject({lifecycleStatus:'active',revision:3});
            expect(store.getAsset('cooked-lobster-lot')).toBeNull();expect(store.getTransformation('cook-lobster-1')).toBeNull();
            const raw=new Database(path);expect(raw.query('SELECT count FROM business_inventory WHERE item_id=377').get())
                .toEqual({count:1});raw.close(true)}finally{store.close()}
    });
    test('rejects untrusted execution, changed replay, reused source receipt and repeated consumption',()=>{const{path,store}=setup();try{
        expect(()=>store.transform(request(),()=>false,at(3))).toThrow('not trusted');store.transform(request(),()=>true,at(3));
        expect(()=>store.transform({...request(),outputs:[{...request().outputs[0]!,quantity:1}]},()=>true,at(3))).toThrow('reused');
        store.register({eventId:'register-second-lot',assetId:'raw-lobster-lot-2',itemId:377,quantity:2,
            titleOwner:{kind:'agent',id:'victim'},holder:{kind:'business',id:'fishers'},evidence:{evidenceId:'second-catch-proof',
                sourceDomain:'item-lifecycle',sourceRecordId:'catch-2',sourceStateVersion:1,
                sourceEvidenceDigest:'7'.repeat(64),occurredAt:at(4)}},()=>true,at(4));
        const raw=new Database(path);raw.run('UPDATE business_inventory SET count=2 WHERE business_id=?1 AND item_id=377',['fishers']);raw.close(true);
        expect(()=>store.transform({...request(),transformationId:'cook-lobster-duplicate-receipt',
            inputs:[{assetId:'raw-lobster-lot-2',expectedRevision:1,storageId:null}],
            outputs:[{...request().outputs[0]!,assetId:'cooked-lobster-lot-duplicate'}]},()=>true,at(4))).toThrow();
        expect(store.getAsset('raw-lobster-lot-2')).toMatchObject({lifecycleStatus:'active',revision:1});
        expect(()=>store.transform({...request(),transformationId:'cook-lobster-2',
            outputs:[{...request().outputs[0]!,assetId:'cooked-lobster-lot-2'}]},()=>true,at(4))).toThrow('unavailable or changed')
    }finally{store.close()}});
    test('fails closed if a historical origin edge is deleted',()=>{const{path,store}=setup();store.transform(request(),()=>true,at(3));
        store.close();const raw=new Database(path);raw.run('DELETE FROM item_transformation_lineage');raw.close(true);
        const damaged=new ItemProvenanceStore(path,policy());try{expect(damaged.verifyAuditChain()).toBeFalse();
            expect(()=>damaged.listAncestorAssetIds('cooked-lobster-lot')).toThrow('audit is invalid')}
        finally{damaged.close()}});
});
