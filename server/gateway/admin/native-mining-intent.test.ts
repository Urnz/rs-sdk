import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-C07 standing Mining request intervals, native fulfillment and archive boundary',async()=>{
    await runNativeFoodIntegration('NativeMiningIntent.test.ts',6,{testNamePattern:'^SI-C07',deadlineMs:60000});
},90000);
