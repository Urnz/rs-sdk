import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 native Mining request observations and atomic output boundary',async()=>{
    await runNativeFoodIntegration('NativeMiningDemand.test.ts',5,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
