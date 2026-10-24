import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C06 actual native WIP checkpoint archive/reopen',async()=>{
    await runNativeFoodIntegration('NativeToolWork.test.ts',1,{testNamePattern:'^SI-C06',deadlineMs:60000});
},90000);
