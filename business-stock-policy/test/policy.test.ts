import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { authorizeStockMovement,BusinessStockSettlementStore,decideBusinessStock,
    loadDefaultBusinessStockPolicyCatalog,validateBusinessStockPolicyCatalog } from '../index.js';

const directories:string[]=[];afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'stock-policy-'));directories.push(directory);const path=join(directory,'business.sqlite');
    const manager=new BusinessManagerStore(path);manager.create({businessId:'lumbridge-general-store',name:'Store',
        summary:'Agent shop.',ownerAgentId:'owner'});manager.close();return {path,store:new BusinessStockSettlementStore(path)}}
function evidence(direction:'procurement'|'sale',quantity:number){return {kind:'verified-skill' as const,
    evidenceId:`${direction}-${quantity}`,status:'completed' as const,businessId:'lumbridge-general-store',itemId:2347,
    quantity,unitPriceGp:direction==='procurement'?10:5,direction,skill:direction==='procurement'?{id:'shopping.lumbridge.buy-hammers',version:'1.0.0'}:
        {id:'trade.lumbridge.give-item',version:'1.0.0'},occurredAt:'2026-09-20T10:00:00.000Z'}}
const trusted=()=>true;

describe('Business stock policy and evidence-gated settlement',()=>{
    test('makes a high-level replenishment decision without changing stock',()=>{const catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
        const decision=decideBusinessStock(policy,catalog,0);expect(decision).toMatchObject({procurement:{quantity:8,maxUnitPriceGp:10},
            sale:{unitPriceGp:5,availableUnits:0,maxUnitsPerSettlement:5}})});
    test('credits and sells finite Business stock only after exact verified evidence',()=>{const catalog=loadDefaultBusinessStockPolicyCatalog(),
        policy=catalog.policies[0]!,{path,store}=fixture();try{const buyDecision=decideBusinessStock(policy,catalog,0),
            buy=authorizeStockMovement(policy,buyDecision,evidence('procurement',8),trusted);
        expect(store.apply('buy-hammers-1',buy)).toMatchObject({direction:'procurement',quantity:8});
        expect(store.apply('buy-hammers-1',buy)).toMatchObject({direction:'procurement',quantity:8});
        const sellDecision=decideBusinessStock(policy,catalog,8),sale=authorizeStockMovement(policy,sellDecision,evidence('sale',5),trusted);
        expect(store.apply('sell-hammers-1',sale)).toMatchObject({direction:'sale',quantity:5});
        const manager=new BusinessManagerStore(path);expect(manager.listInventory('lumbridge-general-store'))
            .toMatchObject([{itemId:2347,count:3}]);manager.close();}finally{store.close()}});
    test('rejects unverified, excessive and changed evidence without inventory mutation',()=>{const catalog=loadDefaultBusinessStockPolicyCatalog(),
        policy=catalog.policies[0]!,decision=decideBusinessStock(policy,catalog,0),{path,store}=fixture();try{
        expect(()=>authorizeStockMovement(policy,decision,evidence('procurement',8))).toThrow('not trusted');
        expect(()=>authorizeStockMovement(policy,decision,{...evidence('procurement',8),unitPriceGp:11},trusted)).toThrow('exceeds');
        expect(()=>authorizeStockMovement(policy,decision,{...evidence('procurement',8),skill:{id:'draft.buy',version:'1.0.0'}},trusted))
            .toThrow('not allowed');expect(()=>authorizeStockMovement(policy,decision,evidence('procurement',9),trusted)).toThrow('exceeds');
        const authorized=authorizeStockMovement(policy,decision,evidence('procurement',8),trusted);store.apply('stable-id',authorized);
        expect(()=>store.apply('stable-id',{...authorized,quantity:7})).toThrow('authorization');
        const manager=new BusinessManagerStore(path);expect(manager.listInventory('lumbridge-general-store')[0]?.count).toBe(8);manager.close();
    }finally{store.close()}});
    test('rejects unsafe stock bounds and unreviewed configured skill references',()=>{const catalog=loadDefaultBusinessStockPolicyCatalog(),policy=catalog.policies[0]!;
        expect(()=>validateBusinessStockPolicyCatalog({schemaVersion:1,policies:[{...policy,minimumStock:9,targetStock:8}]}))
            .toThrow('bounds');expect(catalog.digest).toHaveLength(64)});
});
