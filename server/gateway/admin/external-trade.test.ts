import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';

test('external trade reports require admin authorization and create no missing native or domain stores', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-external-trade-'));
    const path = join(directory, 'absent.sqlite');
    const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor,
        externalTradeOptions: { statePath: path, enginePath: path, clockPath: path, agentPath: path, genesisPath: path, configDirectory: directory } };
    const url = new URL('http://localhost:7780/api/admin/world-genesis/test-run/external-trade?from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z');
    try {
        expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
        const headers = { 'X-Admin-Request': 'rs-sdk-admin' };
        const response = await handleAdminRequest(new Request(url, { headers }), url, context);
        expect(response!.status).toBe(200); expect(await response!.json()).toMatchObject({ status: 'unavailable' });
        url.searchParams.set('from', 'invalid');
        expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
        const post = new URL('http://localhost:7780/api/admin/world-genesis/test-run/external-trade/observe');
        expect((await handleAdminRequest(new Request(post, { method: 'POST', headers, body: '{}' }), post, context))!.status).toBe(400);
        expect(existsSync(path)).toBeFalse();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
