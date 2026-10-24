import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C03 actual smelting and repair native boundary',async()=>{
    await runNativeFoodIntegration('NativeToolWork.test.ts',12,{testNamePattern:'^SI-C03',deadlineMs:60000});
},90000);
