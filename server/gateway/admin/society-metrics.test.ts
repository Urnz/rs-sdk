import { expect, test } from 'bun:test';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('self-sufficiency GET is authenticated, validates simulation scope and never accepts source paths from HTTP', async () => {
    const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
    const url = new URL('http://localhost:7780/api/admin/society/self-sufficiency?from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z&actor=ada&clockId=world&food=C:/untrusted.sqlite');
    expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
    const headers = { 'X-Admin-Request': 'rs-sdk-admin' };
    const response = await handleAdminRequest(new Request(url, { headers }), url, context);
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ assessment: 'inconclusive', sources: { food: { status: 'unavailable' } } });
    url.searchParams.set('to', 'invalid');
    expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
});

test('multi-objective contract/report require admin authentication and HTTP cannot supply observations or native source paths', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'evaluation-route-'));
    try {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor,
            selfSufficiencySources: { food: join(directory, 'food.sqlite') },
            dependencyGraphOptions: { enginePath: join(directory, 'trade.sqlite'), productionPath: join(directory, 'production.sqlite'),
                agentPath: join(directory, 'agents.sqlite'), clockPath: join(directory, 'clock.sqlite') } };
        const headers = { 'X-Admin-Request': 'rs-sdk-admin' };
        const contract = new URL('http://localhost:7780/api/admin/society/evaluation/contract');
        expect((await handleAdminRequest(new Request(contract), contract, context))!.status).toBe(401);
        const definition = await handleAdminRequest(new Request(contract, { headers }), contract, context);
        expect((await definition!.json()).objectives).toHaveLength(10);
        const url = new URL('http://localhost:7780/api/admin/society/evaluation?from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z&actor=ada&clockId=world&clockProfileDigest=' + 'a'.repeat(64));
        url.searchParams.set('production', 'C:/untrusted.sqlite'); url.searchParams.set('observations', '{"wealth":100}');
        expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
        const response = await handleAdminRequest(new Request(url, { headers }), url, context);
        expect(response!.status).toBe(200);
        expect(await response!.json()).toMatchObject({ measurementStatus: 'inconclusive', totalScore: null,
            sources: { economicRisk: { sources: { production: { status: 'unavailable' } } } } });
        const post = await handleAdminRequest(new Request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }), url, context);
        expect(post!.status).not.toBe(200);
        url.searchParams.set('clockProfileDigest', 'bad');
        expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
        expect(readdirSync(directory)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
