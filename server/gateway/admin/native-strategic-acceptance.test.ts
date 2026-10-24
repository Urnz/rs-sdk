import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';

test('SI-B06 four scripted strategic trajectories retain canonical native results', async () => {
    if (process.env.SI_B06_PROVIDER === 'openai') throw new Error('Automated verification is scripted-only; use run-strategic-acceptance.ts for an authorized real trial');
    await runNativeFoodIntegration('StrategicAcceptance.test.ts', 4, { testNamePattern: '^SI-B06', deadlineMs: 60000 });
}, 90000);
