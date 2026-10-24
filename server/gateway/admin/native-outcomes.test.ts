import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C05 actual native worker/time/output projection',async()=>{
    await runNativeFoodIntegration('NativeToolWork.test.ts',1,{testNamePattern:'^SI-C05',deadlineMs:60000});
},90000);
