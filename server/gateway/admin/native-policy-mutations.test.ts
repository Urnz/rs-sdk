import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 native mod reload and director mutation observation boundaries',async()=>{
    await runNativeFoodIntegration('PolicyMutationNative.test.ts',2,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
