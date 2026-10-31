import World from '../engine/World.js';
import {afterEach,beforeAll,expect,test} from 'bun:test';
import {fixture,closeNativeMiningFixtures} from './native-mining-tool-fixture.js';
import {loadPackedContent} from './native-food-skill-fixture.js';
import InvType from '../cache/config/InvType.js';
import {equalNativeInventoryQuantities,nativeInventoryQuantities} from '../../../../society-integration/native-inventory.js';
beforeAll(loadPackedContent);afterEach(closeNativeMiningFixtures);
test('SI-C07 actual non-stackable copper allocation survives native save/reload without changing item quantities',()=>{
    const f=fixture();f.miner.invAdd(InvType.INV,436,2);f.miner.invAdd(InvType.INV,2347,1);f.p.checkpoint([f.miner]);
    const inventory=f.reload().getInventory(InvType.INV)!.items.filter(Boolean).map(item=>({id:item!.id,count:item!.count}));
    expect(inventory.filter(item=>item.id===436)).toEqual([{id:436,count:1},{id:436,count:1}]);
    expect(nativeInventoryQuantities(inventory)).toEqual([{id:436,count:2},{id:1265,count:1},{id:2347,count:1}]);
    expect(equalNativeInventoryQuantities(inventory,[{id:1265,count:1},{id:436,count:2},{id:2347,count:1}])).toBeTrue();
    expect(equalNativeInventoryQuantities(inventory,[{id:1265,count:1},{id:436,count:1},{id:2347,count:1}])).toBeFalse();
    expect(equalNativeInventoryQuantities(inventory,[{id:1265,count:1},{id:436,count:3},{id:2347,count:1}])).toBeFalse();
    expect(equalNativeInventoryQuantities(inventory,[{id:1265,count:1},{id:438,count:2},{id:2347,count:1}])).toBeFalse();
});
