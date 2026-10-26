import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 founder cohort frames and legacy/identity/unbound native ingress gaps',async()=>{
    await runNativeFoodIntegration('NativeMiningCoverage.test.ts',6,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
