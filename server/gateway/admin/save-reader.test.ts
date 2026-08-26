import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSaveData, Items, Locations } from '../../../sdk/test/utils/save-generator';
import { deriveAdminStatus, economySnapshot } from './catalog';
import { readPlayerSave } from './save-reader';
import { listAdminSkills, resolveAdminSkill, validateAdminSkillParameters } from './skill-catalog';
import { listAdminTeleportDestinations, resolveAdminTeleportDestination } from './teleport';
import { validateOfflineSaveDraft } from './offline-editor';
import type { BotCatalogEntry } from './types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('admin save reader', () => {
    test('reads offline skills, money, position, inventory and bank without mutating the save', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rs-admin-save-'));
        temporaryDirectories.push(directory);
        const path = join(directory, 'fisher.sav');
        const bytes = createSaveData({
            position: Locations.ALKHARID_FISHING,
            skills: { Fishing: 40, Cooking: 12 },
            coins: 250,
            inventory: [{ id: Items.SMALL_FISHING_NET, count: 1 }],
            bank: [{ id: Items.COINS, count: 1_000 }, { id: Items.RAW_SHRIMPS, count: 20 }]
        });
        await writeFile(path, bytes);

        const snapshot = await readPlayerSave(path);

        expect(snapshot.valid).toBe(true);
        expect(snapshot.position).toMatchObject(Locations.ALKHARID_FISHING);
        expect(snapshot.skills.find(skill => skill.name === 'Fishing')?.level).toBe(40);
        expect(snapshot.skills.find(skill => skill.name === 'Cooking')?.level).toBe(12);
        expect(snapshot.coins).toBe(1_250);
        expect(snapshot.inventory).toContainEqual(expect.objectContaining({ id: Items.SMALL_FISHING_NET, count: 1 }));
        expect(snapshot.bank).toContainEqual(expect.objectContaining({ id: Items.RAW_SHRIMPS, count: 20 }));
    });

    test('reports a corrupt checksum as data instead of crashing the whole catalog', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rs-admin-save-'));
        temporaryDirectories.push(directory);
        const path = join(directory, 'broken.sav');
        const bytes = createSaveData({ coins: 10 });
        bytes[10] = (bytes[10] ?? 0) ^ 0xff;
        await writeFile(path, bytes);

        const snapshot = await readPlayerSave(path);

        expect(snapshot.valid).toBe(false);
        expect(snapshot.error).toContain('checksum');
    });
});

describe('admin economy aggregation', () => {
    test('aggregates bot money, xp, online count and item stock', () => {
        const base = {
            username: 'a', displayName: 'A', status: 'active', managed: true, hasSave: true,
            hasCredentials: true, canSpawn: false, canDespawn: true, canRestart: true, canTeleport: true,
            canEditOffline: false, saveSavedAt: null,
            currentSkill: null, runId: null,
            lastError: null, lastActivityAt: null, stateAgeMs: 0, position: null, combatLevel: 3,
            totalLevel: 40, totalXp: 1_000, coins: 500, activity: 'Idle', skills: [], equipment: [],
            process: null
        } satisfies Omit<BotCatalogEntry, 'inventory' | 'bank'>;
        const bots: BotCatalogEntry[] = [
            { ...base, inventory: [{ id: 995, name: 'Coins', count: 500 }], bank: [] },
            { ...base, username: 'b', displayName: 'B', status: 'offline', totalLevel: 60, totalXp: 2_000, coins: 700,
                inventory: [], bank: [{ id: 995, name: 'Coins', count: 700 }, { id: 377, name: 'Raw lobster', count: 12 }] }
        ];

        const snapshot = economySnapshot(bots);

        expect(snapshot).toMatchObject({ bots: 2, online: 1, totalCoins: 1_200, totalXp: 3_000, averageTotalLevel: 50 });
        expect(snapshot.itemStock).toContainEqual({ id: 377, name: 'Raw lobster', count: 12 });
    });
});

describe('admin lifecycle status', () => {
    const process = (status: 'starting' | 'running' | 'stopping' | 'exited' | 'error', startedAt: string) => ({
        status, startedAt, pid: status === 'exited' ? null : 123, exitCode: null
    });

    test('does not call a running process offline while the gateway has no fresh state', () => {
        const now = Date.parse('2026-08-20T00:00:30Z');
        expect(deriveAdminStatus(undefined, process('running', '2026-08-20T00:00:00Z'), now)).toBe('stale');
    });

    test('keeps a newly spawned process in the starting grace period', () => {
        const now = Date.parse('2026-08-20T00:00:10Z');
        expect(deriveAdminStatus(undefined, process('running', '2026-08-20T00:00:00Z'), now)).toBe('starting');
    });
});

describe('admin agent skill catalog', () => {
    test('lists only the latest verified shared versions', async () => {
        const skills = await listAdminSkills();
        expect(skills.length).toBeGreaterThanOrEqual(5);
        expect(new Set(skills.map(skill => skill.id)).size).toBe(skills.length);
        expect(skills).toContainEqual(expect.objectContaining({
            reference: 'mining.varrock-east.copper-to-bank@1.0.0',
            name: 'Varrock east copper to bank'
        }));
    });

    test('applies defaults and rejects missing, unknown or out-of-range parameters', async () => {
        const production = await resolveAdminSkill('production.varrock.bronze-daggers@1.0.0');
        expect(validateAdminSkillParameters(production.definition, {})).toEqual({ 'target-items': 1 });
        expect(() => validateAdminSkillParameters(production.definition, { 'target-items': 6 })).toThrow('legfeljebb 5');
        expect(() => validateAdminSkillParameters(production.definition, { unexpected: 1 })).toThrow('Ismeretlen');

        const trade = await resolveAdminSkill('trade.lumbridge.give-item@1.0.0');
        expect(() => validateAdminSkillParameters(trade.definition, {})).toThrow('recipient');
    });
});

describe('admin teleport destinations', () => {
    test('loads unique, bounded, named destinations', async () => {
        const destinations = await listAdminTeleportDestinations();
        expect(destinations.length).toBeGreaterThanOrEqual(5);
        expect(new Set(destinations.map(destination => destination.id)).size).toBe(destinations.length);
        expect(destinations.every(destination => destination.level >= 0 && destination.level <= 3)).toBe(true);
        expect(destinations).toContainEqual(expect.objectContaining({
            id: 'lumbridge-courtyard', x: 3222, z: 3218, level: 0
        }));
    });

    test('rejects destinations outside the approved catalog', async () => {
        await expect(resolveAdminTeleportDestination('lumbridge-courtyard')).resolves.toMatchObject({ label: expect.any(String) });
        await expect(resolveAdminTeleportDestination('arbitrary-coordinate')).rejects.toThrow('Nem engedélyezett');
    });
});

describe('admin offline save draft', () => {
    const valid = {
        expectedSavedAt: '2026-08-26T12:00:00.000Z',
        coins: 5_000,
        skills: [{ name: 'Fishing', experience: 372_240 }],
        inventory: [{ id: 301, count: 1 }],
        bank: [{ id: 377, count: 40 }]
    };

    test('accepts bounded canonical edit data', () => {
        expect(validateOfflineSaveDraft(valid)).toEqual(valid);
    });

    test('rejects invalid xp, coin duplication and unsafe quantities', () => {
        expect(() => validateOfflineSaveDraft({ ...valid, skills: [{ name: 'Fishing', experience: -1 }] })).toThrow('Fishing XP');
        expect(() => validateOfflineSaveDraft({ ...valid, inventory: [{ id: 995, count: 10 }] })).toThrow('Pénz mezőben');
        expect(() => validateOfflineSaveDraft({ ...valid, bank: [{ id: 377, count: 0 }] })).toThrow('mennyiség');
    });

    test('rejects stale or duplicate skill identities before reaching the engine', () => {
        expect(() => validateOfflineSaveDraft({ ...valid, expectedSavedAt: 'not-a-date' })).toThrow('időbélyege');
        expect(() => validateOfflineSaveDraft({ ...valid, skills: [valid.skills[0], valid.skills[0]] })).toThrow('ismétlődő');
    });
});
