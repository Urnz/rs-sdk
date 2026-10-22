import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-A05 physical multi-actor quantity lineage, source gaps and one-time nutrition', async () => {
    await runNativeFoodIntegration('NativeFoodLineage.test.ts', 11);
}, 60000);
