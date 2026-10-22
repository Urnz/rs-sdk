import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A02 isolated native gathering, cooking, quotas and checkpoint integration', async () => {
    await runNativeFoodIntegration('NativeFoodProduction.test.ts', 11);
}, 30000);
