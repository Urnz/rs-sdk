import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCurrentUnderworldClaimVerifier } from '../current-underworld-source.js';
import { UnderworldClaimStore, type UnderworldClaimVerifier } from '../underworld-claims.js';

const now = '2026-09-24T12:00:00.000Z';
const ref = { kind: 'fencing-candidate' as const, id: 'business.7', revision: 1 };
const directories: string[] = [];
const stores: UnderworldClaimStore[] = [];

function setup(): UnderworldClaimStore {
    const directory = mkdtempSync(join(tmpdir(), 'underworld-source-'));
    directories.push(directory);
    const store = new UnderworldClaimStore(join(directory, 'claims.sqlite'));
    stores.push(store);
    return store;
}

afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('current underworld source boundary', () => {
    test('candidate references cannot attest a claim without observer-specific engine evidence', () => {
        const store = setup();
        const current = createCurrentUnderworldClaimVerifier();
        expect(current.verifyClaim(ref)).toBeNull();
        expect(current.verifyRevocation(ref, {
            claimId: 'claim.1', observerAgentId: 'observer', actorKey: 'partner',
            role: 'possible-fence-counterparty', validFrom: now,
            validUntil: '2026-09-25T12:00:00.000Z', source: ref, sourceDigest: 'a'.repeat(64)
        })).toBeNull();
        expect(() => store.attest('event.1', 'claim.1', ref, current, now)).toThrow('not attested');
        expect(store.listActive('observer', now, current)).toEqual([]);
    });

    test('synthetic prior claim is hidden when only the current source boundary is available', () => {
        const store = setup();
        const fixture: UnderworldClaimVerifier = {
            verifyClaim: () => ({ observerAgentId: 'observer', actorKey: 'partner',
                role: 'possible-fence-counterparty', validFrom: '2026-09-24T00:00:00.000Z',
                validUntil: '2026-09-25T00:00:00.000Z', sourceDigest: 'a'.repeat(64) }),
            verifyRevocation: () => null
        };
        store.attest('event.1', 'claim.1', ref, fixture, now);
        expect(store.listActive('observer', now, fixture)).toHaveLength(1);
        expect(store.listActive('observer', now, createCurrentUnderworldClaimVerifier())).toEqual([]);
    });
});
