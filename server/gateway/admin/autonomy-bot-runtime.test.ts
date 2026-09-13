import { describe, expect, test } from 'bun:test';
import type { GatewayBotSnapshot, ManagedProcessSnapshot } from './types.js';
import type { BotSupervisor, SpawnBotOptions } from './supervisor.js';
import { ensureAutonomyBotSession } from './autonomy-bot-runtime.js';

function gateway(controllers = 0): Map<string, GatewayBotSnapshot> {
    return new Map([['ferrye14', { username: 'Ferrye14', status: 'active', connected: true,
        connectedAt: 1, lastStateReceivedAt: 9_000, state: { player: {} } as GatewayBotSnapshot['state'],
        controllers, observers: 0 }]]);
}

function supervisor(options: { process?: ManagedProcessSnapshot | null; spawnError?: Error } = {}) {
    const spawns: SpawnBotOptions[] = [];
    const value = {
        snapshot: () => options.process ?? null,
        spawn: async (input: SpawnBotOptions) => {
            spawns.push(input);
            if (options.spawnError) throw options.spawnError;
            return { status: 'starting', pid: 42, startedAt: '2026-09-08T08:00:00.000Z',
                exitCode: null } satisfies ManagedProcessSnapshot;
        }
    } as unknown as BotSupervisor;
    return { value, spawns };
}

describe('autonomy bot session reconciliation', () => {
    test('adopts a fresh controller-free session without spawning another bot', async () => {
        const managed = supervisor();
        expect(await ensureAutonomyBotSession('Ferrye14', () => gateway(), managed.value, 10_000))
            .toMatchObject({ ready: true, status: 'adopted' });
        expect(managed.spawns).toEqual([]);
    });

    test('fails closed when another controller already owns the avatar', async () => {
        const managed = supervisor();
        expect(await ensureAutonomyBotSession('Ferrye14', () => gateway(1), managed.value, 10_000))
            .toMatchObject({ ready: false, status: 'controller-conflict' });
        expect(managed.spawns).toEqual([]);
    });

    test('waits for an existing managed process to publish fresh state', async () => {
        const managed = supervisor({ process: { status: 'running', pid: 42,
            startedAt: '2026-09-08T08:00:00.000Z', exitCode: null } });
        expect(await ensureAutonomyBotSession('Ferrye14', () => new Map(), managed.value, 10_000))
            .toMatchObject({ ready: false, status: 'starting' });
        expect(managed.spawns).toEqual([]);
    });

    test('starts an offline enrolled avatar using only its local bot identity', async () => {
        const managed = supervisor();
        expect(await ensureAutonomyBotSession('Ferrye14', () => new Map(), managed.value, 10_000))
            .toMatchObject({ ready: false, status: 'spawned' });
        expect(managed.spawns).toEqual([{ username: 'Ferrye14' }]);
    });

    test('returns a bounded failure when no local credentials are available', async () => {
        const managed = supervisor({ spawnError: new Error('Local bot credentials are unavailable.') });
        expect(await ensureAutonomyBotSession('Ferrye14', () => new Map(), managed.value, 10_000))
            .toEqual({ ready: false, status: 'failed', reason: 'Local bot credentials are unavailable.' });
    });
});
