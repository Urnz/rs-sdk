import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('GE-independent player checkpoint authority', () => {
    test('creates and reopens the same durable checkpoint while GE stays unavailable', () => {
        const root = mkdtempSync(join(tmpdir(), 'player-save-without-ge-')); roots.push(root);
        const gePath = join(root, 'market.sqlite'), checkpointPath = join(root, 'player-checkpoints.sqlite');
        const moduleUrl = pathToFileURL(join(import.meta.dir, 'MarketStore.ts')).href;
        const script = `
            import { existsSync } from 'node:fs';
            import { ensurePlayerSaveStore, playerSaveStore, marketStore, MarketStore } from ${JSON.stringify(moduleUrl)};
            const store = playerSaveStore();
            if (!store || existsSync(process.env.GE_DATABASE))
                throw new Error('Checkpoint authority was not separated from disabled GE');
            store.checkpoint('payer', new Uint8Array([7, 8]), true);
            if (ensurePlayerSaveStore() !== store || playerSaveStore() !== store)
                throw new Error('Checkpoint authority split');
            try { marketStore(); throw new Error('GE unexpectedly enabled'); }
            catch (error) { if (!String(error).includes('Grand Exchange is not available')) throw error; }
            store.db.close(true);
            const reopened = new MarketStore(process.env.PLAYER_CHECKPOINT_DATABASE);
            if (JSON.stringify([...reopened.saved('payer')]) !== '[7,8]')
                throw new Error('Checkpoint did not survive restart');
            reopened.db.close(true);
        `;
        const result = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8', env: { ...process.env, GE_ENABLED: 'false', GE_DATABASE: gePath,
                PLAYER_CHECKPOINT_DATABASE: checkpointPath } });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });
});
