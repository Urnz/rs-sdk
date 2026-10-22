import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

/** Drain while the child is running: a parent timeout must not erase completed cases. */
export async function streamNativeOutput(stream: ReadableStream<Uint8Array>, write: (chunk: string) => void): Promise<string> {
    const reader = stream.getReader(), decoder = new TextDecoder();
    let output = '';
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            const chunk = decoder.decode(next.value, { stream: true });
            output += chunk; write(chunk);
        }
        const tail = decoder.decode(); output += tail;
        if (tail) write(tail);
        return output;
    } finally { reader.releaseLock(); }
}

export interface NativeTestOptions { testNamePattern?: string; deadlineMs?: number }

export async function runNativeFoodIntegration(fileName: string, expectedTests: number, options: NativeTestOptions = {}): Promise<void> {
    if (options.deadlineMs !== undefined && (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs < 1))
        throw new Error('Native test deadline must be a positive integer');
    const root = mkdtempSync(join(tmpdir(), 'native-food-runtime-'));
    const started = performance.now();
    const phase = (name: string) => console.info('[native-runtime]', JSON.stringify({ fileName,
        testNamePattern: options.testNamePattern, phase: name,
        elapsedMs: Math.round(performance.now() - started) }));
    try {
        phase('setup-start');
        mkdirSync(join(root, 'data/config'), { recursive: true });
        const key = generateKeyPairSync('rsa', { modulusLength: 512,
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
        writeFileSync(join(root, 'data/config/private.pem'), key.privateKey);
        mkdirSync(join(root, 'data/pack'), { recursive: true });
        for (const name of ['main_file_cache.dat', ...Array.from({ length: 5 }, (_, i) => `main_file_cache.idx${i}`)])
            copyFileSync(resolve(import.meta.dir, '../../engine/data/pack', name), join(root, 'data/pack', name));
        phase('setup-complete');
        const child = Bun.spawn([process.execPath, 'test', resolve(import.meta.dir, '../../engine/src/mods', fileName),
            ...(options.testNamePattern ? ['-t', options.testNamePattern] : [])], {
            cwd: root, env: { ...process.env, PLAYER_CHECKPOINT_DATABASE: join(root, 'world-checkpoints.sqlite'),
                GE_DATABASE: join(root, 'world-checkpoints.sqlite'), TEMP: root, TMP: root, TMPDIR: root }, stdout: 'pipe', stderr: 'pipe'
        });
        phase('child-start');
        let timedOut = false;
        const timer = options.deadlineMs === undefined ? undefined : setTimeout(() => {
            timedOut = true; phase('child-deadline'); child.kill();
        }, options.deadlineMs);
        try {
            const [stdout, stderr, code] = await Promise.all([
                streamNativeOutput(child.stdout, chunk => { process.stdout.write(chunk); }),
                streamNativeOutput(child.stderr, chunk => { process.stderr.write(chunk); }), child.exited]);
            phase('child-exit');
            if (timedOut) throw new Error(`Native test process deadline exceeded (${options.deadlineMs}ms): ${fileName}`);
            if (code !== 0) throw new Error(`Native food integration failed (${code})\n${stdout}\n${stderr}`);
            expect(stderr).toMatch(new RegExp(`^\\s*${expectedTests} pass\\s*$`, 'm'));
            expect(stderr).toMatch(/^\s*0 fail\s*$/m);
            expect(code).toBe(0);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            if (child.exitCode === null) { child.kill(); await child.exited; }
        }
    } finally { phase('cleanup-start'); rmSync(root, { recursive: true, force: true }); phase('cleanup-complete'); }
}
