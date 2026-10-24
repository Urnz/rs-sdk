import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-C01 actual Player XP, caps and atomic checkpoint receipts', async () => {
    await runNativeFoodIntegration('NativeAttributeXp.test.ts', 13, { testNamePattern: '^SI-C01', deadlineMs: 60000 });
}, 90000);
