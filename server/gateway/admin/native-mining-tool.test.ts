import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C02 actual Mining tool use and custody',async()=>{
    await runNativeFoodIntegration('NativeMiningTool.test.ts',13,{testNamePattern:'^SI-C02',deadlineMs:60000});
},90000);
