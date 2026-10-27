import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 native parser, admission guard and packed terminal respawn observations',async()=>{
    await runNativeFoodIntegration('NativeLifecycleAttempts.test.ts',8,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
