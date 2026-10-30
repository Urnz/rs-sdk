import {test} from 'bun:test';
import {runNativeFoodIntegration} from './native-food-test-runtime.js';
test('normal persisted smelt/repair trial review with actual native authorities and effects',async()=>{
    await runNativeFoodIntegration('NativeFounderToolTrials.test.ts',1,{testNamePattern:'^SI-C07',deadlineMs:30000});
},45000);
