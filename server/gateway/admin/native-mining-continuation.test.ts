import {test} from 'bun:test';
import {runNativeFoodIntegration} from './native-food-test-runtime.js';
test('SI-C07 natural packed Mining continuation and cancellation',async()=>{
    await runNativeFoodIntegration('NativeMiningAdmission.test.ts',5,{testNamePattern:'^SI-C07 continuation',deadlineMs:20000});
},30000);
