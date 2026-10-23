import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A07 food outcomes and SI-B02 native state-goal boundary', async () => {
    await runNativeFoodIntegration('NativeFoodSkill.test.ts', 18);
}, 60000);
