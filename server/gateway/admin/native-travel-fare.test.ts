import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-A15 native fare checkpoint, rollback, replay and content guards', async () => {
    await runNativeFoodIntegration('NativeTravelFare.test.ts', 8);
}, 30000);
