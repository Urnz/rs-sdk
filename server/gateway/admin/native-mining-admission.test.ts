import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 source-backed Mining admission, late dispatch, cancellation and real native fulfillment',async()=>{
    await runNativeFoodIntegration('NativeMiningAdmission.test.ts',11,{testNamePattern:'^SI-C07 (?!(?:exact tin draft|continuation))',deadlineMs:60000});
},90000);
