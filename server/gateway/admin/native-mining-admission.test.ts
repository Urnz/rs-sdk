import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 source-backed Mining admission, late dispatch, cancellation and real native fulfillment',async()=>{
    await runNativeFoodIntegration('NativeMiningAdmission.test.ts',6,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
