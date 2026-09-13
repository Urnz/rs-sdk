import { afterEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendAudit, readAudit, verifyAuditChain } from './audit';
import { deriveAdminStatus, economySnapshot, recordEconomy } from './catalog';
import { handleAdminRequest } from './routes';
import { BotSupervisor, type SpawnBotOptions } from './supervisor';
import type { BotCatalogEntry, ManagedProcessSnapshot } from './types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function bot(username: string, status: BotCatalogEntry['status'], coins: number): BotCatalogEntry {
    return {
        username, displayName: username, status, managed: true, hasSave: true, hasCredentials: true,
        canSpawn: false, canDespawn: status === 'active', canRestart: true, canTeleport: status === 'active',
        canEditOffline: status === 'offline', saveSavedAt: null, currentSkill: null, runId: null,
        lastError: null, lastActivityAt: null, stateAgeMs: null, position: null, combatLevel: 3,
        totalLevel: 32, totalXp: 1_000, sessionXpGained: 0, xpPerHour: null,
        xpTrackingStartedAt: null, skillXpGains: [], coins, activity: status === 'active' ? 'Idle' : 'Offline',
        skills: [], inventory: [{ id: 995, name: 'Coins', count: coins }], equipment: [], bank: [], process: null
    };
}

describe('admin authorization boundary', () => {
    test('rejects mutation requests without the local admin header before calling the supervisor', async () => {
        let spawnCalls = 0;
        const context = {
            gatewayBots: () => new Map(),
            supervisor: { spawn: async () => { spawnCalls++; } } as unknown as BotSupervisor
        };
        const request = new Request('http://localhost:7780/api/admin/bots/spawn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'testbot', password: 'secret', reason: 'test' })
        });

        const response = await handleAdminRequest(request, new URL(request.url), context);

        expect(response?.status).toBe(401);
        expect(spawnCalls).toBe(0);
    });

    test('rejects a forged local header when the browser origin is different', async () => {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
        const request = new Request('http://localhost:7780/api/admin/bots/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin',
                Origin: 'http://attacker.invalid'
            },
            body: JSON.stringify({ username: 'testbot', password: 'secret', reason: 'test' })
        });

        const response = await handleAdminRequest(request, new URL(request.url), context);

        expect(response?.status).toBe(401);
    });

    test('protects economic and business domain data even on read requests', async () => {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
        for (const path of ['/api/admin/economic-contracts', '/api/admin/businesses']) {
            const request = new Request(`http://localhost:7780${path}`);
            const response = await handleAdminRequest(request, new URL(request.url), context);
            expect(response?.status).toBe(401);
        }
    });

    test('rejects business agent policy writes before parsing or touching domain state', async () => {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
        const request = new Request('http://localhost:7780/api/admin/agents/forge-mind/business-policy-proposals', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        const response = await handleAdminRequest(request, new URL(request.url), context);
        expect(response?.status).toBe(401);
    });

    test('rejects contract settlement retries without local admin authorization', async () => {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
        const request = new Request('http://localhost:7780/api/admin/economic-contracts/11111111-1111-4111-8111-111111111111/settle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        const response = await handleAdminRequest(request, new URL(request.url), context);
        expect(response?.status).toBe(401);
    });

    test('rejects contract cancellation and default without local admin authorization', async () => {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor };
        const request = new Request('http://localhost:7780/api/admin/economic-contracts/11111111-1111-4111-8111-111111111111/resolve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution: 'defaulted', expectedRevision: 1, reason: 'forged' })
        });
        const response = await handleAdminRequest(request, new URL(request.url), context);
        expect(response?.status).toBe(401);
    });
});

describe('online and offline state collision', () => {
    test('always treats a fresh gateway session as authoritative over stale process state', () => {
        const active = {
            status: 'active', connected: true, state: null
        } as any;
        const failedProcess: ManagedProcessSnapshot = {
            status: 'error', pid: null, startedAt: '2026-08-27T10:00:00Z', exitCode: 1
        };

        expect(deriveAdminStatus(active, failedProcess)).toBe('active');
    });
});

describe('audit durability', () => {
    test('keeps concurrent entries intact and skips a malformed line without hiding valid history', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rs-admin-audit-'));
        temporaryDirectories.push(directory);
        const path = join(directory, 'audit.jsonl');
        await Promise.all(Array.from({ length: 20 }, (_, index) => appendAudit({
            operator: 'test', action: 'bot.concurrent-update', username: `bot${index}`,
            reason: 'parallel safety test', success: index % 2 === 0
        }, path)));
        await appendFile(path, '{malformed}\n', 'utf8');

        const entries = await readAudit(100, path);

        expect(entries).toHaveLength(20);
        expect(new Set(entries.map(entry => entry.id)).size).toBe(20);
        expect(new Set(entries.map(entry => entry.username)).size).toBe(20);
        expect(await verifyAuditChain(path)).toMatchObject({ valid: false,
            error: 'Audit log contains a malformed record.' });
    });

    test('detects a modified chained entry and refuses to extend it', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rs-admin-audit-chain-'));
        temporaryDirectories.push(directory);
        const path = join(directory, 'audit.jsonl');
        await appendAudit({ operator: 'test', action: 'first', reason: 'chain test', success: true }, path);
        await appendAudit({ operator: 'test', action: 'second', reason: 'chain test', success: true }, path);
        const text = await readFile(path, 'utf8');
        await writeFile(path, text.replace('"action":"first"', '"action":"changed"'), 'utf8');
        expect(await verifyAuditChain(path)).toMatchObject({ valid: false, chainedEntries: 0 });
        await expect(appendAudit({ operator: 'test', action: 'third', reason: 'must fail', success: true }, path))
            .rejects.toThrow('Audit chain mismatch');
    });
});

describe('restart orchestration', () => {
    test('requests a clean despawn before spawning the replacement and does not use a real delay', async () => {
        const calls: string[] = [];
        const snapshot: ManagedProcessSnapshot = {
            status: 'starting', pid: 42, startedAt: '2026-08-27T10:00:00Z', exitCode: null
        };
        class TestSupervisor extends BotSupervisor {
            override async despawn(username: string, reason: string): Promise<ManagedProcessSnapshot | null> {
                calls.push(`despawn:${username}:${reason}`);
                return snapshot;
            }

            override async spawn(options: SpawnBotOptions): Promise<ManagedProcessSnapshot> {
                calls.push(`spawn:${options.username}`);
                return snapshot;
            }
        }
        const supervisor = new TestSupervisor(() => true, async milliseconds => { calls.push(`pause:${milliseconds}`); });

        const result = await supervisor.restart({ username: 'Restart1', password: 'secret' }, 'health recovery');

        expect(result).toBe(snapshot);
        expect(calls).toEqual(['despawn:Restart1:health recovery', 'pause:1500', 'spawn:Restart1']);
    });
});

describe('parallel bot refresh persistence', () => {
    test('coalesces simultaneous economy refreshes into one valid snapshot', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rs-admin-economy-'));
        temporaryDirectories.push(directory);
        const path = join(directory, 'economy.jsonl');
        const snapshot = economySnapshot([
            bot('worker1', 'active', 100), bot('worker2', 'active', 250), bot('worker3', 'offline', 50)
        ]);

        await Promise.all(Array.from({ length: 25 }, () => recordEconomy(snapshot, path, 100_000)));

        const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/);
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!)).toMatchObject({ bots: 3, online: 2, totalCoins: 400 });
    });
});
