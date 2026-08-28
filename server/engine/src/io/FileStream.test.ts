import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FileStream from './FileStream.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    }
});

describe('FileStream write cache', () => {
    test('returns newly written bytes instead of a stale packed entry', () => {
        const directory = mkdtempSync(join(tmpdir(), 'filestream-cache-'));
        temporaryDirectories.push(directory);
        const stream = new FileStream(directory, true);
        const initial = new Uint8Array([1, 2, 3]);
        const replacement = new Uint8Array([4, 5, 6, 7]);

        expect(stream.write(4, 0, initial)).toBeTrue();
        expect(stream.read(4, 0)).toEqual(initial);
        expect(stream.write(4, 0, replacement)).toBeTrue();
        expect(stream.read(4, 0)).toEqual(replacement);
        stream.close();
    });
});
