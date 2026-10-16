import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UnderworldClaimStore, type UnderworldClaimVerifier,
    type VerifiedUnderworldClaim } from '../underworld-claims.js';

const now = '2026-09-24T12:00:00.000Z';
const source = { kind: 'fencing-candidate' as const, id: 'business.7', revision: 2 };
const directories: string[] = [];
const stores: UnderworldClaimStore[] = [];
function setup(): { path: string; store: UnderworldClaimStore } {
    const directory = mkdtempSync(join(tmpdir(), 'underworld-claims-'));
    directories.push(directory);
    const path = join(directory, 'claims.sqlite');
    const store = new UnderworldClaimStore(path);
    stores.push(store);
    return { path, store };
}
function verifier(observerAgentId = 'observer'): UnderworldClaimVerifier & { enabled: boolean } {
    const value: VerifiedUnderworldClaim = { observerAgentId, actorKey: 'Horvik',
        role: 'possible-fence-counterparty', validFrom: '2026-09-23T00:00:00.000Z',
        validUntil: '2026-09-25T00:00:00.000Z', sourceDigest: 'a'.repeat(64) };
    return { enabled: true,
        verifyClaim(ref) { return this.enabled && ref.kind === source.kind && ref.id === source.id
            && ref.revision === source.revision ? value : null; },
        verifyRevocation(ref, claim) { return this.enabled && ref.id === 'revocation.1'
            && claim.actorKey === 'horvik' ? { claimId: claim.claimId,
                sourceDigest: 'b'.repeat(64), occurredAt: '2026-09-24T13:00:00.000Z' } : null; } };
}
afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('source-attested observer-scoped underworld claims', () => {
    test('requires a trusted typed source and only shows the owning observer', () => {
        const { store } = setup();
        const proof = verifier();
        expect(() => store.attest('event.1', 'claim.1', source, { ...proof,
            verifyClaim: () => null }, now)).toThrow('not attested');
        store.attest('event.1', 'claim.1', source, proof, now);
        expect(store.listActive('observer', now, proof)).toMatchObject([{ claimId: 'claim.1',
            actorKey: 'horvik', role: 'possible-fence-counterparty' }]);
        expect(store.listActive('other', now, proof)).toEqual([]);
        expect(store.verifyAuditChain()).toBe(true);
    });

    test('exact retry is idempotent; reused event and claim IDs are rejected', () => {
        const { store } = setup(); const proof = verifier();
        const first = store.attest('event.1', 'claim.1', source, proof, now);
        expect(store.attest('event.1', 'claim.1', source, proof, now)).toEqual(first);
        expect(() => store.attest('event.1', 'claim.2', source, proof, now)).toThrow('reused');
        expect(() => store.attest('event.2', 'claim.1', source, proof, now)).toThrow('reused');
    });

    test('revocation is source-attested and closes only the selected claim', () => {
        const { store } = setup(); const proof = verifier();
        store.attest('event.1', 'claim.1', source, proof, now);
        const revocationSource = { kind: 'observed-counterparty-action' as const,
            id: 'revocation.1', revision: 1 };
        expect(() => store.revoke('event.2', 'claim.1', revocationSource,
            { ...proof, verifyRevocation: () => null })).toThrow('not attested');
        store.revoke('event.2', 'claim.1', revocationSource, proof);
        expect(store.listActive('observer', now, proof)).toHaveLength(1);
        expect(store.listActive('observer', '2026-09-24T13:00:00.000Z', proof)).toEqual([]);
        expect(() => store.revoke('event.3', 'claim.1', revocationSource, proof)).toThrow('already revoked');
    });

    test('expiry and current source loss fail closed', () => {
        const { store } = setup(); const proof = verifier();
        store.attest('event.1', 'claim.1', source, proof, now);
        expect(store.listActive('observer', '2026-09-25T00:00:00.000Z', proof)).toEqual([]);
        proof.enabled = false;
        expect(store.listActive('observer', now, proof)).toEqual([]);
        expect(store.verifyAuditChain()).toBe(true);
    });

    test('tampered record or audit hash closes reads', () => {
        const { path, store } = setup(); const proof = verifier();
        store.attest('event.1', 'claim.1', source, proof, now);
        const raw = new Database(path);
        raw.run("UPDATE underworld_claim_event SET payload='{}' WHERE event_id='event.1'");
        raw.close(true);
        expect(store.verifyAuditChain()).toBe(false);
        expect(() => store.listActive('observer', now, proof)).toThrow('audit chain');
    });

    test('schema version survives reopening and rejects newer schema', () => {
        const { path, store } = setup(); const proof = verifier();
        store.attest('event.1', 'claim.1', source, proof, now);
        store.close(); stores.pop();
        const reopened = new UnderworldClaimStore(path); stores.push(reopened);
        expect(reopened.listActive('observer', now, proof)).toHaveLength(1);
        reopened.close(); stores.pop();
        const raw = new Database(path);
        raw.run('PRAGMA user_version = 2'); raw.close(true);
        expect(() => new UnderworldClaimStore(path)).toThrow('newer than supported');
    });
});
