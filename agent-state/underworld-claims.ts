import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { normalizeActorKey, normalizeAgentId } from './validation.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const ZERO = '0'.repeat(64);

export type UnderworldClaimSourceKind = 'fencing-candidate' | 'observed-counterparty-action';
export interface UnderworldClaimSourceRef {
    kind: UnderworldClaimSourceKind;
    id: string;
    revision: number;
}
/** Returned by a trusted source adapter, not constructed from notes, tags, chat or model text. */
export interface VerifiedUnderworldClaim {
    observerAgentId: string;
    actorKey: string;
    role: 'possible-fence-counterparty';
    validFrom: string;
    validUntil: string;
    sourceDigest: string;
}
export interface VerifiedUnderworldRevocation {
    claimId: string;
    sourceDigest: string;
    occurredAt: string;
}
export interface UnderworldClaimVerifier {
    verifyClaim(ref: Readonly<UnderworldClaimSourceRef>): VerifiedUnderworldClaim | null;
    verifyRevocation(ref: Readonly<UnderworldClaimSourceRef>, claim: Readonly<UnderworldClaim>):
        VerifiedUnderworldRevocation | null;
}
export interface UnderworldClaim {
    claimId: string;
    observerAgentId: string;
    actorKey: string;
    role: 'possible-fence-counterparty';
    validFrom: string;
    validUntil: string;
    source: UnderworldClaimSourceRef;
    sourceDigest: string;
}
export type UnderworldClaimEvent = {
    eventId: string;
    kind: 'attested';
    claim: UnderworldClaim;
    occurredAt: string;
} | {
    eventId: string;
    kind: 'revoked';
    claimId: string;
    source: UnderworldClaimSourceRef;
    sourceDigest: string;
    occurredAt: string;
};

type Row = { sequence: number; event_id: string; kind: string; claim_id: string; payload: string;
    previous_hash: string; entry_hash: string };

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`);
    return value;
}
function source(value: UnderworldClaimSourceRef): UnderworldClaimSourceRef {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'id,kind,revision'
        || !['fencing-candidate', 'observed-counterparty-action'].includes(value.kind)
        || !Number.isSafeInteger(value.revision) || value.revision < 1)
        throw new Error('Underworld claim source reference is invalid');
    return { kind: value.kind, id: id(value.id, 'source.id'), revision: value.revision };
}
function validatedClaim(value: VerifiedUnderworldClaim, ref: UnderworldClaimSourceRef, claimId: string): UnderworldClaim {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'actorKey,observerAgentId,role,sourceDigest,validFrom,validUntil'
        || value.role !== 'possible-fence-counterparty')
        throw new Error('Verified underworld claim is invalid');
    const validFrom = time(value.validFrom, 'validFrom');
    const validUntil = time(value.validUntil, 'validUntil');
    if (Date.parse(validUntil) <= Date.parse(validFrom)) throw new Error('Underworld claim lifetime is invalid');
    return { claimId, observerAgentId: normalizeAgentId(value.observerAgentId),
        actorKey: normalizeActorKey(value.actorKey), role: value.role, validFrom, validUntil,
        source: ref, sourceDigest: digest(value.sourceDigest, 'sourceDigest') };
}

/** Separate append-only v1 ledger; no global role lookup and no trade execution. */
export class UnderworldClaimStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }

    attest(eventIdInput: string, claimIdInput: string, sourceInput: UnderworldClaimSourceRef,
        verifier: UnderworldClaimVerifier, occurredAtInput: string): UnderworldClaimEvent {
        const eventId = id(eventIdInput, 'eventId');
        const claimId = id(claimIdInput, 'claimId');
        const ref = source(sourceInput);
        const occurredAt = time(occurredAtInput, 'occurredAt');
        if (!this.verifyAuditChain()) throw new Error('Underworld claim audit chain is invalid');
        const verified = verifier.verifyClaim(Object.freeze({ ...ref }));
        if (!verified) throw new Error('Underworld claim source is not attested');
        const claim = validatedClaim(verified, ref, claimId);
        if (Date.parse(occurredAt) < Date.parse(claim.validFrom)
            || Date.parse(occurredAt) >= Date.parse(claim.validUntil))
            throw new Error('Underworld claim is not valid at attestation time');
        const event: UnderworldClaimEvent = { eventId, kind: 'attested', claim, occurredAt };
        this.append(event);
        return event;
    }

    revoke(eventIdInput: string, claimIdInput: string, sourceInput: UnderworldClaimSourceRef,
        verifier: UnderworldClaimVerifier): UnderworldClaimEvent {
        const eventId = id(eventIdInput, 'eventId');
        const claimId = id(claimIdInput, 'claimId');
        const ref = source(sourceInput);
        if (!this.verifyAuditChain()) throw new Error('Underworld claim audit chain is invalid');
        const claim = this.claimById(claimId);
        if (!claim) throw new Error('Underworld claim does not exist');
        const verified = verifier.verifyRevocation(Object.freeze({ ...ref }), Object.freeze({ ...claim }));
        if (!verified || verified.claimId !== claimId) throw new Error('Underworld claim revocation is not attested');
        const event: UnderworldClaimEvent = { eventId, kind: 'revoked', claimId, source: ref,
            sourceDigest: digest(verified.sourceDigest, 'revocation.sourceDigest'),
            occurredAt: time(verified.occurredAt, 'revocation.occurredAt') };
        const original = this.events().find(item => item.kind === 'attested' && item.claim.claimId === claimId);
        if (!original || Date.parse(event.occurredAt) < Date.parse(original.occurredAt))
            throw new Error('Underworld claim revocation predates attestation');
        this.append(event);
        return event;
    }

    /** Current source must still verify exactly the recorded facts; unavailable sources fail closed. */
    listActive(observerAgentIdInput: string, asOfInput: string, verifier: UnderworldClaimVerifier): UnderworldClaim[] {
        const observerAgentId = normalizeAgentId(observerAgentIdInput);
        const asOf = time(asOfInput, 'asOf');
        if (!this.verifyAuditChain()) throw new Error('Underworld claim audit chain is invalid');
        const events = this.events();
        const revoked = new Set(events.filter(item => item.kind === 'revoked'
            && Date.parse(item.occurredAt) <= Date.parse(asOf)).map(item => item.kind === 'revoked' ? item.claimId : ''));
        return events.filter((event): event is Extract<UnderworldClaimEvent, { kind: 'attested' }> =>
            event.kind === 'attested' && event.claim.observerAgentId === observerAgentId
            && Date.parse(event.occurredAt) <= Date.parse(asOf)
            && Date.parse(event.claim.validFrom) <= Date.parse(asOf)
            && Date.parse(asOf) < Date.parse(event.claim.validUntil)
            && !revoked.has(event.claim.claimId)).map(event => {
            const current = verifier.verifyClaim(Object.freeze({ ...event.claim.source }));
            if (!current) return null;
            try {
                const fresh = validatedClaim(current, event.claim.source, event.claim.claimId);
                return hash(fresh) === hash(event.claim) ? event.claim : null;
            } catch { return null; }
        }).filter((claim): claim is UnderworldClaim => claim !== null)
            .sort((a, b) => a.actorKey.localeCompare(b.actorKey) || a.claimId.localeCompare(b.claimId));
    }

    verifyAuditChain(): boolean {
        const rows = this.rows();
        let previous = ZERO;
        const claims = new Map<string, string>();
        const revoked = new Set<string>();
        for (const row of rows) {
            let event: UnderworldClaimEvent;
            try { event = JSON.parse(row.payload) as UnderworldClaimEvent; }
            catch { return false; }
            if (!event || event.eventId !== row.event_id || event.kind !== row.kind
                || (event.kind === 'attested' ? event.claim.claimId : event.claimId) !== row.claim_id
                || row.previous_hash !== previous
                || row.entry_hash !== hash({ previousHash: previous, event })) return false;
            try {
                id(event.eventId, 'eventId'); time(event.occurredAt, 'occurredAt');
                if (event.kind === 'attested') {
                    const claim = event.claim;
                    const { claimId, source: claimSource, ...attestation } = claim;
                    if (claims.has(claimId) || hash(validatedClaim(attestation, source(claimSource), id(claimId, 'claimId')))
                        !== hash(claim)) return false;
                    if (Date.parse(event.occurredAt) < Date.parse(claim.validFrom)
                        || Date.parse(event.occurredAt) >= Date.parse(claim.validUntil)) return false;
                    claims.set(claim.claimId, event.occurredAt);
                } else if (event.kind === 'revoked') {
                    if (!claims.has(event.claimId) || revoked.has(event.claimId)
                        || Date.parse(event.occurredAt) < Date.parse(claims.get(event.claimId)!)) return false;
                    source(event.source); digest(event.sourceDigest, 'sourceDigest');
                    revoked.add(event.claimId);
                } else return false;
            } catch { return false; }
            previous = row.entry_hash;
        }
        return true;
    }

    private claimById(claimId: string): UnderworldClaim | null {
        const event = this.events().find(item => item.kind === 'attested' && item.claim.claimId === claimId);
        return event?.kind === 'attested' ? event.claim : null;
    }
    private events(): UnderworldClaimEvent[] {
        return this.rows().map(row => JSON.parse(row.payload) as UnderworldClaimEvent);
    }
    private rows(): Row[] {
        return this.database.query('SELECT * FROM underworld_claim_event ORDER BY sequence').all() as Row[];
    }
    private append(event: UnderworldClaimEvent): void {
        const transaction = this.database.transaction(() => {
            if (!this.verifyAuditChain()) throw new Error('Underworld claim audit chain is invalid');
            const existing = this.database.query('SELECT payload FROM underworld_claim_event WHERE event_id=?1')
                .get(event.eventId) as { payload: string } | null;
            if (existing) {
                if (existing.payload !== JSON.stringify(event)) throw new Error('Underworld claim event ID was reused');
                return;
            }
            const claimId = event.kind === 'attested' ? event.claim.claimId : event.claimId;
            if (event.kind === 'attested' && this.claimById(claimId))
                throw new Error('Underworld claim ID was reused');
            if (event.kind === 'revoked' && this.events().some(item => item.kind === 'revoked'
                && item.claimId === claimId)) throw new Error('Underworld claim is already revoked');
            const previousHash = (this.database.query('SELECT entry_hash FROM underworld_claim_event ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            this.database.run(`INSERT INTO underworld_claim_event(event_id,kind,claim_id,payload,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5,?6)`, [event.eventId, event.kind, claimId, JSON.stringify(event), previousHash,
                hash({ previousHash, event })]);
        });
        transaction.immediate();
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Underworld claim schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE underworld_claim_event (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL CHECK(kind IN ('attested','revoked')),claim_id TEXT NOT NULL,
                payload TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                UNIQUE(kind,claim_id))`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
