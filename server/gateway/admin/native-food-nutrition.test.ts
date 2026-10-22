import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A04 isolated real content, durable needs, receipt-use and forced-crash recovery', async () => {
    await runNativeFoodIntegration('NativeFoodNutrition.test.ts', 21);
}, 60000);
