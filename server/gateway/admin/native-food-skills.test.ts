import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A07 executor, SDK protocol and canonical native food outcomes', async () => {
    await runNativeFoodIntegration('NativeFoodSkill.test.ts', 17);
}, 60000);
