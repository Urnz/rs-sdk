import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotSupervisor, isActiveSkillSnapshot } from './supervisor.js';

const directories: string[] = [];

async function markerDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'rs-skill-marker-'));
    directories.push(directory);
    await mkdir(directory, { recursive: true });
    return directory;
}

function marker(overrides: Record<string, unknown> = {}) {
    return { username: 'Ferrye14', skillId: 'mining.safe', version: '1.0.0',
        runId: '11111111-1111-4111-8111-111111111111', startedAt: '2026-09-08T08:00:00.000Z',
        heartbeatAt: '2026-09-08T08:00:09.000Z', progressAt: '2026-09-08T08:00:08.000Z',
        progressSequence: 3, pid: 4242, ...overrides };
}

afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('skill marker restart reconciliation', () => {
    test('does not treat a terminal retained snapshot as active autonomy ownership', () => {
        const base = { runId: '11111111-1111-4111-8111-111111111111', pid: null,
            skill: 'mining.safe@1.0.0', startedAt: '2026-09-08T08:00:00.000Z', exitCode: 0,
            logPath: 'skill.log' };
        expect(isActiveSkillSnapshot({ ...base, status: 'running', pid: 42 })).toBeTrue();
        expect(isActiveSkillSnapshot({ ...base, status: 'stopping', pid: 42 })).toBeTrue();
        expect(isActiveSkillSnapshot({ ...base, status: 'exited' })).toBeFalse();
        expect(isActiveSkillSnapshot({ ...base, status: 'error', exitCode: 1 })).toBeFalse();
    });

    test('serializes concurrent skill starts for the same avatar before any spawn', async () => {
        const directory = await markerDirectory();
        let releaseEnvironment!: () => void;
        let enteredEnvironment!: () => void;
        const entered = new Promise<void>(resolve => { enteredEnvironment = resolve; });
        const environment = new Promise<Record<string, string>>(resolve => {
            releaseEnvironment = () => resolve({});
        });
        const supervisor = new BotSupervisor(() => false, async () => undefined, () => false, directory,
            async () => { enteredEnvironment(); return environment; });
        const first = supervisor.startSkill('Ferrye14', 'mining.safe@1.0.0', {});
        await entered;
        await expect(supervisor.startSkill('Ferrye14', 'mining.safe@1.0.0', {}))
            .rejects.toThrow('indítása már folyamatban');
        releaseEnvironment();
        await expect(first).rejects.toThrow('helyi bot.env');
        await expect(supervisor.startSkill('Ferrye14', 'mining.safe@1.0.0', {}))
            .rejects.toThrow('helyi bot.env');
    });

    test('adopts only a live process with a fresh self-updated heartbeat', async () => {
        const directory = await markerDirectory();
        await writeFile(join(directory, 'ferrye14.json'), JSON.stringify(marker()));
        const supervisor = new BotSupervisor(() => false, async () => undefined, pid => pid === 4242, directory);
        expect(await supervisor.reconcileSkillMarkers('2026-09-08T08:00:10.000Z')).toEqual([
            expect.objectContaining({ username: 'ferrye14', status: 'adopted', snapshot: expect.objectContaining({
                runId: '11111111-1111-4111-8111-111111111111', pid: 4242, skill: 'mining.safe@1.0.0'
            }) })
        ]);
        expect(supervisor.skillSnapshot('Ferrye14')).toMatchObject({ status: 'running', pid: 4242 });
        await expect(supervisor.startSkill('Ferrye14', 'mining.safe@1.0.0', {}))
            .rejects.toThrow('adoptált agent skillt');
    });

    test('keeps a live but stale or legacy marker blocked and unadopted', async () => {
        const directory = await markerDirectory();
        const path = join(directory, 'ferrye14.json');
        await writeFile(path, JSON.stringify(marker({ heartbeatAt: undefined })));
        const supervisor = new BotSupervisor(() => false, async () => undefined, () => true, directory);
        expect(await supervisor.reconcileSkillMarkers('2026-09-08T08:00:10.000Z')).toEqual([
            expect.objectContaining({ status: 'unverified', reason: expect.stringContaining('pre-heartbeat') })
        ]);
        expect(supervisor.skillSnapshot('ferrye14')).toBeNull();
        expect(await supervisor.stopSkill('ferrye14')).toBe(false);
        expect(await readFile(path, 'utf8')).not.toBe('');
    });

    test('terminates a live PID whose heartbeat is fresh but journal progress exceeded its deadline', async () => {
        const directory = await markerDirectory();
        await writeFile(join(directory, 'ferrye14.json'), JSON.stringify(marker({
            heartbeatAt: '2026-09-08T08:09:59.000Z', progressAt: '2026-09-08T08:00:00.000Z'
        })));
        const terminated: number[] = [];
        const supervisor = new BotSupervisor(() => false, async () => undefined, () => true, directory,
            async () => ({}), pid => { terminated.push(pid); });
        expect(await supervisor.reconcileSkillMarkers('2026-09-08T08:10:00.000Z', 15_000, 60_000)).toEqual([
            expect.objectContaining({ status: 'stalled', reason: expect.stringContaining('progress deadline'),
                snapshot: expect.objectContaining({ status: 'stopping', progressSequence: 3 }) })
        ]);
        expect(terminated).toEqual([4242]);
        expect(supervisor.skillSnapshot('ferrye14')).toMatchObject({ status: 'stopping', pid: 4242 });
    });

    test('removes a marker only after proving its PID is dead', async () => {
        const directory = await markerDirectory();
        const path = join(directory, 'ferrye14.json');
        await writeFile(path, JSON.stringify(marker()));
        const supervisor = new BotSupervisor(() => false, async () => undefined, () => false, directory);
        expect(await supervisor.reconcileSkillMarkers('2026-09-08T08:00:10.000Z')).toEqual([
            expect.objectContaining({ status: 'stale-removed', snapshot: expect.objectContaining({
                runId: '11111111-1111-4111-8111-111111111111', status: 'error', pid: null
            }) })
        ]);
        await expect(readFile(path, 'utf8')).rejects.toThrow();
    });
});
