import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C04 native commerce to Business cashflow proof',async()=>{
    await runNativeFoodIntegration('NativeCommerce.test.ts',2,{testNamePattern:'^SI-C04',deadlineMs:60000});
},90000);
