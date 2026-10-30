import {test} from 'bun:test';
import {runNativeFoodIntegration} from './native-food-test-runtime.js';
test('two independent level-1 native tin draft effects and fail-closed source review',async()=>{
    await runNativeFoodIntegration('NativeMiningAdmission.test.ts',1,{testNamePattern:'^SI-C07 exact tin draft',deadlineMs:20000});
},30000);
