import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FileStream from '../src/io/FileStream';

test('a changed map is immediately readable by the same pack pass and after reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ge-cache-'));
    const cache = new FileStream(dir, true);
    try {
        cache.write(4, 263, Uint8Array.of(1, 2, 3), 1);
        expect(cache.read(4, 263)).toEqual(Uint8Array.of(1, 2, 3, 0, 1));
        cache.write(4, 263, Uint8Array.of(4, 5, 6, 7), 1);
        expect(cache.read(4, 263)).toEqual(Uint8Array.of(4, 5, 6, 7, 0, 1));
        const reopened = new FileStream(dir, false, true);
        try {
            expect(reopened.read(4, 263)).toEqual(cache.read(4, 263));
        } finally {
            reopened.close();
        }
    } finally {
        cache.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
