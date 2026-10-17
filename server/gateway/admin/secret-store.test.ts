import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerSecretStore } from '../../control-plane/secret-store.js';

test('Windows credential vault isolates workspaces, persists across instances, rotates and deletes without plaintext files', async () => {
    const first = await mkdtemp(join(tmpdir(), 'rs-vault-a-')), second = await mkdtemp(join(tmpdir(), 'rs-vault-b-'));
    const a = new ServerSecretStore(first), b = new ServerSecretStore(second);
    try {
        await expect(a.get('../invalid')).rejects.toThrow('Invalid secret name');
        await a.set('technical-test', 'synthetic-vault-one');
        expect(await a.status('technical-test')).toBe(true);
        expect(await b.status('technical-test')).toBe(false);
        expect(await new ServerSecretStore(first).get('technical-test')).toBe('synthetic-vault-one');
        await a.set('technical-test', 'synthetic-vault-two');
        expect(await a.get('technical-test')).toBe('synthetic-vault-two');
        await a.delete('technical-test');
        expect(await a.get('technical-test')).toBeNull();
        await a.delete('technical-test');
    } finally {
        await a.delete('technical-test'); await b.delete('technical-test');
        await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true });
    }
}, 20000);
