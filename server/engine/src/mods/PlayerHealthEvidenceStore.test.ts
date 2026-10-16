import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlayerHealthEvidenceStore } from './PlayerHealthEvidenceStore.js';
import { applyHealthAuditedDamage } from './PlayerHealthDamage.js';

const directories: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function path() { const directory = mkdtempSync(join(tmpdir(), 'engine-health-')); directories.push(directory); return join(directory, 'source.sqlite'); }
const input = { username: 'alice', sessionId: 'session-1', engineTick: 42, occurredAt: '2026-10-13T10:00:00.000Z',
    hpBefore: 10, hpAfter: 5, maxHp: 10, damageType: 1 };
const eventId = '10000000-0000-4000-8000-000000000001';
describe('authoritative engine damage source', () => {
    test('failed evidence persistence rolls back HP and hitmarks rather than leaving an unrecorded injury', () => {
        const player = { levels: new Uint8Array([10]), masks: 0, hitmarkSlot: 0,
            hitmarkDamage: 0, hitmarkType: 0, hitmark2Damage: 0, hitmark2Type: 0 };
        expect(() => applyHealthAuditedDamage(player, 0, 5, () => {
            player.levels[0] = 5; player.masks = 1; player.hitmarkSlot++; player.hitmarkDamage = 5;
        }, () => { throw new Error('evidence persistence failed'); })).toThrow('persistence failed');
        expect(player.levels[0]).toBe(10); expect(player.masks).toBe(0); expect(player.hitmarkSlot).toBe(0);
        expect(player.hitmarkDamage).toBe(0);
        let recorded = 0;
        applyHealthAuditedDamage(player, 0, 5, () => { player.levels[0] = 5; }, (before, after) => { recorded = before - after; });
        expect(recorded).toBe(5); expect(player.levels[0]).toBe(5);
    });
    test('exact replay and restart preserve the damage proof; gateway is read-only', () => {
        const file = path(), writer = new PlayerHealthEvidenceStore(file);
        const first = writer.record(input, eventId);
        expect(writer.record(input, eventId)).toEqual(first);
        expect(() => writer.record({ ...input, hpAfter: 4 }, eventId)).toThrow('conflict');
        writer.close();
        const reader = new PlayerHealthEvidenceStore(file, true); closers.push(() => reader.close());
        expect(reader.list()).toEqual([first]);
        expect(() => reader.record(input)).toThrow('cannot write');
    });
    test('a heal, zero damage and invalid HP cannot be an injury source', () => {
        const writer = new PlayerHealthEvidenceStore(path()); closers.push(() => writer.close());
        for (const patch of [{ hpAfter: 10 }, { hpAfter: 11 }, { hpBefore: 0 }, { maxHp: 0 }, { hpAfter: -1 }]) {
            expect(() => writer.record({ ...input, ...patch })).toThrow();
        }
        expect(writer.list()).toEqual([]);
    });
    test('local compatibility avatars with underscore/space names can still record authoritative damage', () => {
        const writer = new PlayerHealthEvidenceStore(path()); closers.push(() => writer.close());
        expect(writer.record({ ...input, username: 'alice_test' }).username).toBe('alice_test');
        expect(writer.record({ ...input, username: 'alice test' }).username).toBe('alice test');
    });
    test('tampered source fails closed before any record can be read', () => {
        const file = path(), writer = new PlayerHealthEvidenceStore(file); writer.record(input, eventId); writer.close();
        const database = new Database(file); database.run("UPDATE engine_health_damage SET event_digest=?1", ['a'.repeat(64)]); database.close(true);
        expect(() => new PlayerHealthEvidenceStore(file, true)).toThrow('audit is invalid');
    });
});
