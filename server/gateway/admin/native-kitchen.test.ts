import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-A06 isolated native kitchen custody and physical processing', async () => {
    await runNativeFoodIntegration('NativeKitchen.test.ts', 21);
}, 60000);
