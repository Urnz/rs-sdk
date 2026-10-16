import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PlayerCustodyStore } from './PlayerCustodyStore.js';

const roots: string[] = [];
const digest = 'a'.repeat(64);
const base = { custodyId: '10000000-0000-4000-8000-000000000001', decisionId: 'justice-decision-1',
    decisionDigest: digest, username: 'Suspect', jurisdictionId: 'lumbridge', x: 3221, z: 3219, level: 0,
    startedAt: '2026-09-28T10:00:00.000Z', releaseAt: '2026-09-28T10:05:00.000Z' };

function store(): PlayerCustodyStore {
    const root = mkdtempSync(join(tmpdir(), 'player-custody-')); roots.push(root);
    return new PlayerCustodyStore(join(root, 'custody.sqlite'));
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('PlayerCustodyStore', () => {
    test('persists exact replay, blocks conflicting replay, and releases only at the deadline', () => {
        const first = store();
        const applied = first.apply(base);
        expect(applied.status).toBe('active');
        expect(first.apply(base)).toEqual(applied);
        expect(() => first.apply({ ...base, x: 3222 })).toThrow('reused');
        expect(first.activeFor('suspect', '2026-09-28T09:59:59.999Z')).toBeNull();
        expect(first.releaseExpired('2026-09-28T10:04:59.999Z')).toEqual([]);
        expect(first.activeFor('suspect', '2026-09-28T10:04:59.999Z')?.custodyId).toBe(base.custodyId);
        expect(first.releaseExpired(base.releaseAt)).toHaveLength(1);
        expect(first.activeFor('suspect', base.releaseAt)).toBeNull();
        expect(first.verifyAuditChain()).toBeTrue();
        first.close();
    });

    test('survives restart and rejects overlapping active custody', () => {
        const root = mkdtempSync(join(tmpdir(), 'player-custody-restart-')); roots.push(root);
        const path = join(root, 'custody.sqlite');
        let current = new PlayerCustodyStore(path); current.apply(base); current.close();
        current = new PlayerCustodyStore(path);
        expect(current.activeFor('SUSPECT', '2026-09-28T10:01:00.000Z')?.decisionId).toBe(base.decisionId);
        expect(() => current.apply({ ...base, custodyId: '10000000-0000-4000-8000-000000000002',
            decisionId: 'justice-decision-2' })).toThrow('overlapping');
        current.close();
    });
});
