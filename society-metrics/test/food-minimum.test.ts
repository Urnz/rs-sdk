import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { foodMinimumCells } from '../food-minimum.js';
import { fixture,at } from './native-boundary-fixture.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { appendFoodLineage } from '../../server/engine/src/mods/NativeFoodLineageStore.js';
import { parsePlayerSaveBytes } from '../../server/gateway/admin/save-reader.js';
import { createSaveData } from '../../sdk/test/utils/save-generator.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config'));
const cells=(f:ReturnType<typeof fixture>)=>foodMinimumCells(contract,f.read().minimumFood,()=>true,()=>true);
test('native effective-relief share uses actual relief, not physiological demand, and midnight belongs to its preceding day',()=>{
    const f=fixture();f.scope.toSimulationTime=at(48);f.produce('gather',23.5);f.produce('cook',23.75);f.consume(24);f.advance(48);
    const before=readFileSync(f.options.databasePath),result=cells(f),share=result.cells.find(c=>c.requirementId==='internal-food-relief-share')!;
    expect(share.subject).toEqual({bucket:0});expect(share.lower).toEqual({numerator:'18000000',denominator:'1800'});
    expect(share.upper!).toEqual(share.lower!);expect(result.cells.filter(c=>c.requirementId==='internal-food-relief-share')).toHaveLength(1);
    expect(result.cells.some(c=>c.requirementId==='inter-actor-final-use-chains')).toBeFalse();expect(readFileSync(f.options.databasePath)).toEqual(before);
});
test('actual native gather/cook/trade/consume ancestry counts a distinct-producer chain once, not once per productive stage',()=>{
    const f=fixture();f.scope.toSimulationTime=at(24);f.produce('gather',0.25,1);f.produce('cook',0.5,1);
    const store=new TradeEvidenceStore(join(f.root,'server/engine/data/mods/trade-evidence.sqlite'));
    const trade=store.record({tick:1,fromUsername:'bea',toUsername:'ada',fromItems:[{id:379,name:'Lobster',count:1}],toItems:[],fromValue:1,toValue:0,committedAt:at(0.75)});store.close();
    const side=(index:number,before:number,after:number)=>{const b=f.bindings[index]!;return{custodian:{worldId:b.worldId,actorId:b.actorId,username:b.playerId,lifecycleId:b.lifecycleId},
        before:{raw:0,cooked:before,burnt:0},after:{raw:0,cooked:after,burnt:0}};};
    f.db.transaction(()=>appendFoodLineage(f.db,{kind:'transfer',trade,sides:[side(1,1,0),side(0,0,1)]})).immediate();
    f.consume(1);f.advance(24);const food=f.read().minimumFood,result=foodMinimumCells(contract,food,()=>true,()=>true);
    expect(result.cells.find(c=>c.requirementId==='inter-actor-final-use-chains')!.lower).toEqual({numerator:'1',denominator:'1'});
    expect(foodMinimumCells(contract,food,()=>true,()=>false).cells.some(c=>c.requirementId==='inter-actor-final-use-chains')).toBeFalse();
});
test('zero/no-use relief cannot pass internal supply; unknown ancestry bounds share without inventing internal credit',()=>{
    const f=fixture();f.scope.toSimulationTime=at(24);f.consume(1,true);f.advance(24);expect(cells(f).cells).toHaveLength(0);
    const g=fixture();g.scope.toSimulationTime=at(24);g.consume(1);g.advance(24);
    const share=cells(g).cells.find(c=>c.requirementId==='internal-food-relief-share')!;
    expect(share.lower!.numerator).toBe('0');expect(share.upper).toEqual({numerator:'2000000',denominator:'200'});expect(cells(g).violations).toHaveLength(0);
});
test('known bootstrap/import relief violates100% supply even with pending unrelated meals; a controlled origin certificate never substitutes for native verification',()=>{
    const f=fixture();f.scope.toSimulationTime=at(24);f.consume(1);f.advance(24);const food=f.read().minimumFood;
    // Calculation-only certificate fixture. The native reader authenticates origin separately; there is no upload API.
    for(const origin of ['bootstrap','import'] as const){
        const proof={...food,pending:1,rows:food.rows.map(r=>({...r,origin}))},r=foodMinimumCells(contract,proof,()=>true,()=>true);
        expect(r.cells.some(c=>c.requirementId==='internal-food-relief-share')).toBeFalse();expect(r.violations).toHaveLength(1);
    }
    expect(foodMinimumCells(contract,{...food,rows:food.rows.map(r=>({...r,origin:'mixed'}))},()=>true,()=>true).violations).toHaveLength(0);
});
test('pending native applications withhold exact share and unbound lifecycles cannot donate final use or relief',()=>{
    const f=fixture();f.scope.toSimulationTime=at(24);f.produce('gather',0.25);f.produce('cook',0.5);f.consume(1);f.advance(24);
    const food=f.read().minimumFood;
    expect(foodMinimumCells(contract,{...food,pending:1},()=>true,()=>true).cells).toHaveLength(0);
    expect(foodMinimumCells(contract,food,()=>false,()=>true).cells).toHaveLength(0);
});
test('optional checkpoint vitals expose current HP while the normal admin save shape and base levels stay unchanged',()=>{
    const bytes=createSaveData({inventory:[{id:379,count:2}]});const before=bytes.slice();
    const admin=parsePlayerSaveBytes(bytes,at(0),true),native=parsePlayerSaveBytes(bytes,at(0),true,true);
    expect(admin.valid).toBeTrue();expect('currentHitpoints' in admin).toBeFalse();expect(native.currentHitpoints).toBeGreaterThan(0);
    const {currentHitpoints:_,...rest}=native;expect(rest).toEqual(admin);expect(bytes).toEqual(before);
});
