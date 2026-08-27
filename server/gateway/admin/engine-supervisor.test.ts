import { describe, expect, test } from 'bun:test';
import { restartLocalEngine } from './engine-supervisor';

describe('local engine restart supervisor', () => {
    test('parses a successful fixed-script result', async () => {
        const result = await restartLocalEngine(async () => ({
            exitCode: 0,
            stdout: 'status line\n{"ok":true,"previousPid":10,"pid":11,"restartedAt":"2026-08-27T00:00:00.000Z","logDirectory":"C:\\\\logs"}\n',
            stderr: ''
        }));
        expect(result).toMatchObject({ ok: true, previousPid: 10, pid: 11 });
    });

    test('surfaces script failures without attempting arbitrary commands', async () => {
        await expect(restartLocalEngine(async () => ({ exitCode: 1, stdout: '', stderr: 'managed engine mismatch' })))
            .rejects.toThrow('managed engine mismatch');
    });

    test('rejects overlapping restarts', async () => {
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const first = restartLocalEngine(async () => {
            await blocked;
            return { exitCode: 1, stdout: '', stderr: 'stopped' };
        });
        await expect(restartLocalEngine(async () => ({ exitCode: 0, stdout: '{}', stderr: '' }))).rejects.toThrow('folyamatban');
        release();
        await expect(first).rejects.toThrow('stopped');
    });
});
