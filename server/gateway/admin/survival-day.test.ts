import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('day-survival native content, autonomous threshold, canonical meals and permanent death recovery', async () => {
    await runNativeFoodIntegration('SurvivalDay.test.ts', 7);
}, 60000);
