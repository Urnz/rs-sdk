import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A07 food outcomes and SI-B02/SI-B03 native planning boundaries', async () => {
    await runNativeFoodIntegration('NativeFoodSkill.test.ts', 19);
}, 60000);
