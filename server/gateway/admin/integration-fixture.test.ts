import { test } from 'bun:test';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
import { INTEGRATION_NATIVE_CASES, NATIVE_PROCESS_OVERHEAD_MS, exactNativeCasePattern } from './integration-native-cases.js';

for (const entry of INTEGRATION_NATIVE_CASES) test(`SI-A13 ${entry.id}: ${entry.name}`, async () => {
    await runNativeFoodIntegration('IntegrationFixtureNative.test.ts', 1, {
        testNamePattern: exactNativeCasePattern(entry.name), deadlineMs: entry.timeoutMs + NATIVE_PROCESS_OVERHEAD_MS
    });
}, entry.timeoutMs + 2 * NATIVE_PROCESS_OVERHEAD_MS);
