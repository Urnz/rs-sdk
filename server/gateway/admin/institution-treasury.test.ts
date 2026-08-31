import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstitutionTreasuryStore } from './institution-treasury.js';

const dirs: string[] = [];
function store(): InstitutionTreasuryStore {
    const dir = mkdtempSync(join(tmpdir(), 'rs-treasury-')); dirs.push(dir);
    return new InstitutionTreasuryStore(join(dir, 'treasury.sqlite'));
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('institution treasury', () => {
    test('reserves, commits, and idempotently preserves real funds', () => {
        const treasury = store();
        const empty = treasury.ensure('business', 'forge');
        treasury.setBalance('business', 'forge', empty.revision, 1_000);
        const held = treasury.reserve('business', 'forge', 'work.iron-001', 400);
        expect(held.created).toBeTrue();
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 1_000, reservedGp: 400, availableGp: 600 });
        expect(treasury.reserve('business', 'forge', 'work.iron-001', 400).created).toBeFalse();
        const settlementId = '11111111-1111-4111-8111-111111111111';
        treasury.bindSettlement('work.iron-001', settlementId);
        treasury.commit('work.iron-001', settlementId);
        treasury.commit('work.iron-001', settlementId);
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 600, reservedGp: 0, availableGp: 600 });
        treasury.close();
    });

    test('rejects unfunded work and releases failed work exactly once', () => {
        const treasury = store();
        const empty = treasury.ensure('faction', 'white-knights');
        treasury.setBalance('faction', 'white-knights', empty.revision, 500);
        expect(() => treasury.reserve('faction', 'white-knights', 'work.too-large', 501)).toThrow('Insufficient');
        treasury.reserve('faction', 'white-knights', 'work.patrol', 300);
        treasury.release('work.patrol'); treasury.release('work.patrol');
        expect(treasury.get('faction', 'white-knights')).toMatchObject({ balanceGp: 500, reservedGp: 0 });
        expect(() => treasury.commit('work.patrol', '22222222-2222-4222-8222-222222222222')).toThrow();
        treasury.close();
    });
});
