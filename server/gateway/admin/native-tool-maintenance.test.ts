import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-C07 native wear repair reuse, audited consumption and offline reread',async()=>{
    await runNativeFoodIntegration('NativeToolWork.test.ts',4,{testNamePattern:'^(SI-C03 complete100|SI-C07 (maintenance|material))',deadlineMs:60000});
},90000);
