import { expect, test } from 'bun:test';
import { runNativeFoodIntegration, streamNativeOutput } from './native-food-test-runtime.js';
import { INTEGRATION_NATIVE_CASES, exactNativeCasePattern } from './integration-native-cases.js';

test('native output is forwarded before child EOF and preserves split UTF-8 without duplicate output', async () => {
    const bytes = new TextEncoder().encode('árvíz\npartial result\n');
    let finish!: () => void, received = '', ended = false;
    let observed!: () => void;
    const available = new Promise<void>(resolve => { observed = resolve; });
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1));
        finish = () => controller.close();
    } });
    const draining = streamNativeOutput(stream, chunk => {
        received += chunk;
        if (received === 'árvíz\npartial result\n') observed();
    }).then(result => { ended = true; return result; });
    await available;
    expect(received).toBe('árvíz\npartial result\n'); expect(ended).toBeFalse();
    finish(); expect(await draining).toBe(received);
});

test('stream failures retain already-forwarded diagnostics and reject instead of reporting success', async () => {
    let fail!: () => void, received = '';
    let observed!: () => void;
    const available = new Promise<void>(resolve => { observed = resolve; });
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('case-start\n'));
        fail = () => controller.error(new Error('injected pipe failure'));
    } });
    const draining = streamNativeOutput(stream, chunk => { received += chunk; observed(); });
    await available; fail();
    await expect(draining).rejects.toThrow('injected pipe failure');
    expect(received).toBe('case-start\n');
});

test('native case selectors match exactly one manifest entry, including regex punctuation', () => {
    expect(new Set(INTEGRATION_NATIVE_CASES.map(c => c.id)).size).toBe(10);
    for (const entry of INTEGRATION_NATIVE_CASES) {
        const pattern = new RegExp(exactNativeCasePattern(entry.name));
        expect(INTEGRATION_NATIVE_CASES.filter(c => pattern.test(c.name))).toHaveLength(1);
        expect(pattern.test(`${entry.name} extra case`)).toBeFalse();
    }
    const pattern = new RegExp(exactNativeCasePattern('case (a) [b] + c?'));
    expect(pattern.test('case (a) [b] + c?')).toBeTrue();
    expect(pattern.test('case a b  c')).toBeFalse();
});

test('an empty native selector cannot be reported as a successful one-case run', async () => {
    await expect(runNativeFoodIntegration('IntegrationFixtureNative.test.ts', 1,
        { testNamePattern: '^intentionally-no-native-case$', deadlineMs: 5000 })).rejects.toThrow();
}, 10000);

test('a process deadline kills and awaits its child rather than leaving a dangling native runner', async () => {
    await expect(runNativeFoodIntegration('IntegrationFixtureNative.test.ts', 1,
        { testNamePattern: exactNativeCasePattern(INTEGRATION_NATIVE_CASES[0]!.name), deadlineMs: 1 }))
        .rejects.toThrow('process deadline exceeded');
}, 10000);
