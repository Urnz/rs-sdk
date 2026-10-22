import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A01 isolated native content, Player checkpoint and readonly source integration', async () => {
    await runNativeFoodIntegration('NativeFoodConsumption.test.ts', 13);
}, 30000);
