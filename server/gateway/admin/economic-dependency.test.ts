import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';
test('dependency graph GET is authenticated, validates scope and accepts only server-configured sources', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-dependency-')), path = join(directory, 'absent.sqlite');
    const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor,
        dependencyGraphOptions: { enginePath: path, productionPath: path, agentPath: path, clockPath: path } };
    const url = new URL('http://localhost:7780/api/admin/economy/dependencies?basis=wall&from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z&production=C:/untrusted.sqlite');
    try {
        expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
        const headers = { 'X-Admin-Request': 'rs-sdk-admin' }, response = await handleAdminRequest(new Request(url, { headers }), url, context);
        expect(response!.status).toBe(200); expect(await response!.json()).toMatchObject({ measurementStatus: 'unavailable', completeEconomyCoverage: false });
        expect(existsSync(path)).toBeFalse(); url.searchParams.set('basis', 'invented');
        expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('economic risk GET authenticates, validates scope, ignores source overrides and preserves unavailable coverage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-economic-risk-')), path = join(directory, 'absent.sqlite');
    const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor,
        dependencyGraphOptions: { enginePath: path, productionPath: path, agentPath: path, clockPath: path } };
    const url = new URL('http://localhost:7780/api/admin/economy/dependency-risk?basis=wall&from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z&production=C:/untrusted.sqlite');
    try {
        expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
        const headers = { 'X-Admin-Request': 'rs-sdk-admin' }, response = await handleAdminRequest(new Request(url, { headers }), url, context);
        expect(response!.status).toBe(200); expect(await response!.json()).toMatchObject({ artifactKind: 'observed-economic-structural-risk',
            measurementStatus: 'unavailable', productionMetricsStatus: 'unavailable', scenarios: [], predictsFutureOutage: false });
        expect(existsSync(path)).toBeFalse(); url.searchParams.set('basis', 'simulation');
        expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
