import {test} from 'bun:test';
import {runNativeFoodIntegration} from './native-food-test-runtime.js';
test('native founder trial non-stackable inventory roundtrip',async()=>{
    await runNativeFoodIntegration('NativeFounderTrialInventory.test.ts',1,{deadlineMs:15000});
},25000);
