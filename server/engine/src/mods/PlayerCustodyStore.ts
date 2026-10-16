import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const USERNAME = /^[a-zA-Z0-9]{1,12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);

export interface PlayerCustodyOrder {
    custodyId: string;
    decisionId: string;
    decisionDigest: string;
    username: string;
    jurisdictionId: string;
    x: number;
    z: number;
    level: number;
    startedAt: string;
    releaseAt: string;
}

export interface PlayerCustodyRecord extends PlayerCustodyOrder {
    status: 'active' | 'released';
    releasedAt: string | null;
    orderDigest: string;
}

type Row = { custody_id: string; decision_id: string; decision_digest: string; username: string;
    jurisdiction_id: string; x: number; z: number; level: number; started_at: string; release_at: string;
    status: PlayerCustodyRecord['status']; released_at: string | null; order_digest: string };
type AuditRow = { sequence: number; custody_id: string; action: 'applied' | 'released';
    occurred_at: string; record_digest: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function iso(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${field} is invalid`);
    return value;
}
function record(row: Row): PlayerCustodyRecord {
    return { custodyId: row.custody_id, decisionId: row.decision_id, decisionDigest: row.decision_digest,
        username: row.username, jurisdictionId: row.jurisdiction_id, x: row.x, z: row.z, level: row.level,
        startedAt: row.started_at, releaseAt: row.release_at, status: row.status,
        releasedAt: row.released_at, orderDigest: row.order_digest };
}
function order(value: PlayerCustodyRecord): PlayerCustodyOrder {
    return { custodyId: value.custodyId, decisionId: value.decisionId, decisionDigest: value.decisionDigest,
        username: value.username, jurisdictionId: value.jurisdictionId, x: value.x, z: value.z,
        level: value.level, startedAt: value.startedAt, releaseAt: value.releaseAt };
}

/** Engine authority for an already-adjudicated, finite custody order. It cannot create legal authority. */
export class PlayerCustodyStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys=ON');
        this.migrate();
    }
    close(): void { this.database.close(true); }

    get(custodyId: string): PlayerCustodyRecord | null {
        if (!UUID.test(custodyId)) throw new Error('custodyId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Player custody audit chain is invalid');
        const row = this.database.query('SELECT * FROM player_custody WHERE custody_id=?1').get(custodyId) as Row | null;
        return row ? record(row) : null;
    }

    activeFor(usernameInput: string, now = new Date().toISOString()): PlayerCustodyRecord | null {
        const username = usernameInput.trim().toLowerCase();
        if (!USERNAME.test(username)) throw new Error('custody username is invalid');
        iso(now, 'custody time');
        if (!this.verifyAuditChain()) throw new Error('Player custody audit chain is invalid');
        const row = this.database.query(`SELECT * FROM player_custody WHERE username=?1 AND status='active'
            AND started_at<=?2 AND release_at>?2 ORDER BY started_at DESC LIMIT 1`).get(username, now) as Row | null;
        return row ? record(row) : null;
    }

    apply(input: PlayerCustodyOrder): PlayerCustodyRecord {
        if (!input || Object.keys(input).sort().join(',') !== ['custodyId','decisionId','decisionDigest','username',
            'jurisdictionId','x','z','level','startedAt','releaseAt'].sort().join(','))
            throw new Error('Player custody order fields are invalid');
        const value: PlayerCustodyOrder = { ...input, username: input.username.trim().toLowerCase() };
        if (!UUID.test(value.custodyId) || !ID.test(value.decisionId) || !DIGEST.test(value.decisionDigest)
            || !USERNAME.test(value.username) || !ID.test(value.jurisdictionId)
            || !Number.isSafeInteger(value.x) || value.x < 0 || value.x > 16383
            || !Number.isSafeInteger(value.z) || value.z < 0 || value.z > 16383
            || !Number.isSafeInteger(value.level) || value.level < 0 || value.level > 3)
            throw new Error('Player custody order is invalid');
        iso(value.startedAt, 'custody start'); iso(value.releaseAt, 'custody release');
        if (value.releaseAt <= value.startedAt) throw new Error('Player custody release must follow its start');
        if (!this.verifyAuditChain()) throw new Error('Player custody audit chain is invalid');
        const orderDigest = hash(value), existing = this.get(value.custodyId);
        if (existing) {
            if (existing.orderDigest !== orderDigest) throw new Error('Player custody id was reused with different content');
            return existing;
        }
        const conflicting = this.database.query(`SELECT custody_id FROM player_custody
            WHERE username=?1 AND status='active' AND started_at<?3 AND release_at>?2 LIMIT 1`)
            .get(value.username, value.startedAt, value.releaseAt);
        if (conflicting) throw new Error('Player already has an overlapping active custody order');
        this.database.transaction(() => {
            this.database.run(`INSERT INTO player_custody(custody_id,decision_id,decision_digest,username,
                jurisdiction_id,x,z,level,started_at,release_at,status,released_at,order_digest)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'active',NULL,?11)`,
            [value.custodyId,value.decisionId,value.decisionDigest,value.username,value.jurisdictionId,
                value.x,value.z,value.level,value.startedAt,value.releaseAt,orderDigest]);
            this.audit(value.custodyId, 'applied', value.startedAt, hash({ ...value, status: 'active', releasedAt: null, orderDigest }));
        }).immediate();
        return this.get(value.custodyId)!;
    }

    releaseExpired(now = new Date().toISOString()): PlayerCustodyRecord[] {
        iso(now, 'custody release time');
        if (!this.verifyAuditChain()) throw new Error('Player custody audit chain is invalid');
        const rows = this.database.query(`SELECT * FROM player_custody WHERE status='active' AND release_at<=?1
            ORDER BY release_at,custody_id`).all(now) as Row[];
        const released: PlayerCustodyRecord[] = [];
        for (const row of rows) this.database.transaction(() => {
            const changed = this.database.run(`UPDATE player_custody SET status='released',released_at=?2
                WHERE custody_id=?1 AND status='active'`, [row.custody_id, now]);
            if (changed.changes !== 1) throw new Error('Player custody changed during timed release');
            const current = this.database.query('SELECT * FROM player_custody WHERE custody_id=?1')
                .get(row.custody_id) as Row;
            this.audit(row.custody_id, 'released', now, hash(record(current)));
            released.push(record(current));
        }).immediate();
        return released;
    }

    verifyAuditChain(): boolean {
        try {
            const records = this.database.query('SELECT * FROM player_custody ORDER BY rowid').all() as Row[];
            const audits = this.database.query('SELECT * FROM player_custody_audit ORDER BY sequence').all() as AuditRow[];
            const byId = new Map(records.map(value => [value.custody_id, value]));
            let previous = ZERO;
            const actions = new Map<string, AuditRow[]>();
            for (const entry of audits) {
                const source = byId.get(entry.custody_id);
                if (!source || entry.previous_hash !== previous) return false;
                const payload = { custodyId: entry.custody_id, action: entry.action,
                    occurredAt: entry.occurred_at, recordDigest: entry.record_digest };
                if (entry.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = entry.entry_hash;
                const list = actions.get(entry.custody_id) ?? []; list.push(entry); actions.set(entry.custody_id, list);
            }
            for (const row of records) {
                const value = record(row), entries = actions.get(row.custody_id) ?? [];
                if (value.orderDigest !== hash(order(value)) || entries.length !== (value.status === 'active' ? 1 : 2)
                    || entries[0]?.action !== 'applied' || entries[0].record_digest !== hash({ ...order(value),
                        status: 'active', releasedAt: null, orderDigest: value.orderDigest })
                    || (value.status === 'released' && (entries[1]?.action !== 'released'
                        || entries[1].record_digest !== hash(value) || value.releasedAt === null))) return false;
            }
            return audits.length === [...actions.values()].reduce((sum, list) => sum + list.length, 0);
        } catch { return false; }
    }

    private audit(custodyId: string, action: AuditRow['action'], occurredAt: string, recordDigest: string): void {
        const previous = (this.database.query('SELECT entry_hash FROM player_custody_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        const payload = { custodyId, action, occurredAt, recordDigest };
        this.database.run(`INSERT INTO player_custody_audit(custody_id,action,occurred_at,record_digest,
            previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5,?6)`,
        [custodyId,action,occurredAt,recordDigest,previous,hash({ previousHash: previous, payload })]);
    }

    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Player custody schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE player_custody(custody_id TEXT PRIMARY KEY,decision_id TEXT NOT NULL UNIQUE,
                decision_digest TEXT NOT NULL,username TEXT NOT NULL,jurisdiction_id TEXT NOT NULL,x INTEGER NOT NULL,
                z INTEGER NOT NULL,level INTEGER NOT NULL,started_at TEXT NOT NULL,release_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('active','released')),released_at TEXT,order_digest TEXT NOT NULL UNIQUE)`);
            this.database.run(`CREATE TABLE player_custody_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                custody_id TEXT NOT NULL REFERENCES player_custody(custody_id),action TEXT NOT NULL,
                occurred_at TEXT NOT NULL,record_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                UNIQUE(custody_id,action))`);
            this.database.run('PRAGMA user_version=1');
        }).immediate();
    }
}

let defaultStore: PlayerCustodyStore | null = null;
export function getPlayerCustodyStore(): PlayerCustodyStore {
    return defaultStore ??= new PlayerCustodyStore(process.env.PLAYER_CUSTODY_DB || 'data/mods/player-custody.sqlite');
}
