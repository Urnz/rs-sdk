import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type InstitutionKind = 'business' | 'faction';
export type TreasuryReservationStatus = 'reserved' | 'committed' | 'released';

export interface InstitutionTreasuryAccount {
    kind: InstitutionKind;
    id: string;
    balanceGp: number;
    reservedGp: number;
    availableGp: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface TreasuryReservation {
    reservationId: string;
    kind: InstitutionKind;
    actorId: string;
    amountGp: number;
    status: TreasuryReservationStatus;
    settlementId: string | null;
    createdAt: string;
    updatedAt: string;
}

interface AccountRow {
    actor_kind: InstitutionKind; actor_id: string; balance_gp: number; reserved_gp: number;
    revision: number; created_at: string; updated_at: string;
}
interface ReservationRow {
    reservation_id: string; actor_kind: InstitutionKind; actor_id: string; amount_gp: number;
    status: TreasuryReservationStatus; settlement_id: string | null; created_at: string; updated_at: string;
}

function actorId(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) throw new Error('Treasury actor id is invalid');
    return normalized;
}
function account(row: AccountRow): InstitutionTreasuryAccount {
    return { kind: row.actor_kind, id: row.actor_id, balanceGp: row.balance_gp,
        reservedGp: row.reserved_gp, availableGp: row.balance_gp - row.reserved_gp,
        revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
function reservation(row: ReservationRow): TreasuryReservation {
    return { reservationId: row.reservation_id, kind: row.actor_kind, actorId: row.actor_id,
        amountGp: row.amount_gp, status: row.status, settlementId: row.settlement_id,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

export class InstitutionTreasuryStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_treasury (
            actor_kind TEXT NOT NULL CHECK (actor_kind IN ('business', 'faction')),
            actor_id TEXT NOT NULL, balance_gp INTEGER NOT NULL CHECK (balance_gp >= 0),
            reserved_gp INTEGER NOT NULL CHECK (reserved_gp >= 0 AND reserved_gp <= balance_gp),
            revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (actor_kind, actor_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_treasury_reservation (
            reservation_id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
            amount_gp INTEGER NOT NULL CHECK (amount_gp > 0),
            status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
            settlement_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY (actor_kind, actor_id) REFERENCES institution_treasury(actor_kind, actor_id))`);
    }

    close(): void { this.database.close(true); }

    get(kind: InstitutionKind, idInput: string): InstitutionTreasuryAccount | null {
        const row = this.database.query(`SELECT * FROM institution_treasury
            WHERE actor_kind = ?1 AND actor_id = ?2`).get(kind, actorId(idInput)) as AccountRow | null;
        return row ? account(row) : null;
    }

    list(): InstitutionTreasuryAccount[] {
        return (this.database.query(`SELECT * FROM institution_treasury
            ORDER BY actor_kind, actor_id`).all() as AccountRow[]).map(account);
    }

    ensure(kind: InstitutionKind, idInput: string, now = new Date().toISOString()): InstitutionTreasuryAccount {
        const id = actorId(idInput);
        this.database.run(`INSERT OR IGNORE INTO institution_treasury
            (actor_kind, actor_id, balance_gp, reserved_gp, revision, created_at, updated_at)
            VALUES (?1, ?2, 0, 0, 1, ?3, ?3)`, [kind, id, now]);
        return this.get(kind, id)!;
    }

    setBalance(kind: InstitutionKind, idInput: string, expectedRevision: number, balanceGp: number,
        now = new Date().toISOString()): InstitutionTreasuryAccount {
        const current = this.ensure(kind, idInput, now);
        if (!Number.isSafeInteger(balanceGp) || balanceGp < current.reservedGp || balanceGp > 2_147_483_647) {
            throw new Error(`Treasury balance must be between reserved funds (${current.reservedGp}) and 2147483647`);
        }
        const result = this.database.run(`UPDATE institution_treasury SET balance_gp = ?4,
            revision = revision + 1, updated_at = ?5
            WHERE actor_kind = ?1 AND actor_id = ?2 AND revision = ?3`,
        [kind, current.id, expectedRevision, balanceGp, now]);
        if (result.changes !== 1) throw new Error('Treasury changed before update; refresh and try again');
        return this.get(kind, current.id)!;
    }

    getReservation(reservationId: string): TreasuryReservation | null {
        const row = this.database.query(`SELECT * FROM institution_treasury_reservation
            WHERE reservation_id = ?1`).get(reservationId) as ReservationRow | null;
        return row ? reservation(row) : null;
    }

    reserve(kind: InstitutionKind, idInput: string, reservationId: string, amountGp: number,
        now = new Date().toISOString()): { reservation: TreasuryReservation; created: boolean } {
        const id = actorId(idInput);
        if (!/^[a-z0-9][a-z0-9._-]{2,95}$/.test(reservationId)) throw new Error('Treasury reservation id is invalid');
        if (!Number.isSafeInteger(amountGp) || amountGp < 1 || amountGp > 2_147_483_647) {
            throw new Error('Treasury reservation amount is invalid');
        }
        let created = false;
        const transaction = this.database.transaction(() => {
            const existing = this.getReservation(reservationId);
            if (existing) {
                if (existing.kind !== kind || existing.actorId !== id || existing.amountGp !== amountGp) {
                    throw new Error('Treasury reservation id was reused for a different request');
                }
                return;
            }
            const current = this.ensure(kind, id, now);
            if (current.availableGp < amountGp) throw new Error('Insufficient institution treasury funds');
            const updated = this.database.run(`UPDATE institution_treasury SET reserved_gp = reserved_gp + ?3,
                revision = revision + 1, updated_at = ?4
                WHERE actor_kind = ?1 AND actor_id = ?2 AND balance_gp - reserved_gp >= ?3`,
            [kind, id, amountGp, now]);
            if (updated.changes !== 1) throw new Error('Institution treasury changed during reservation');
            this.database.run(`INSERT INTO institution_treasury_reservation
                (reservation_id, actor_kind, actor_id, amount_gp, status, settlement_id, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, 'reserved', NULL, ?5, ?5)`,
            [reservationId, kind, id, amountGp, now]);
            created = true;
        });
        transaction.immediate();
        return { reservation: this.getReservation(reservationId)!, created };
    }

    bindSettlement(reservationId: string, settlementId: string,
        now = new Date().toISOString()): TreasuryReservation {
        if (!/^[0-9a-f-]{36}$/i.test(settlementId)) throw new Error('Treasury settlement id is invalid');
        const current = this.getReservation(reservationId);
        if (!current || current.status !== 'reserved') throw new Error('Treasury reservation is not payable');
        if (current.settlementId && current.settlementId !== settlementId) {
            throw new Error('Treasury reservation is bound to another settlement');
        }
        this.database.run(`UPDATE institution_treasury_reservation SET settlement_id = ?2,
            updated_at = ?3 WHERE reservation_id = ?1 AND status = 'reserved' AND settlement_id IS NULL`,
        [reservationId, settlementId, now]);
        return this.getReservation(reservationId)!;
    }

    commit(reservationId: string, settlementId: string,
        now = new Date().toISOString()): TreasuryReservation {
        const transaction = this.database.transaction(() => {
            const current = this.getReservation(reservationId);
            if (!current || current.settlementId !== settlementId) throw new Error('Treasury settlement does not match its reservation');
            if (current.status === 'committed') return;
            if (current.status !== 'reserved') throw new Error('Released treasury reservation cannot be committed');
            const updated = this.database.run(`UPDATE institution_treasury SET
                balance_gp = balance_gp - ?3, reserved_gp = reserved_gp - ?3,
                revision = revision + 1, updated_at = ?4
                WHERE actor_kind = ?1 AND actor_id = ?2 AND reserved_gp >= ?3`,
            [current.kind, current.actorId, current.amountGp, now]);
            if (updated.changes !== 1) throw new Error('Treasury funds changed during settlement');
            this.database.run(`UPDATE institution_treasury_reservation SET status = 'committed',
                updated_at = ?2 WHERE reservation_id = ?1 AND status = 'reserved'`, [reservationId, now]);
        });
        transaction.immediate();
        return this.getReservation(reservationId)!;
    }

    release(reservationId: string, now = new Date().toISOString()): TreasuryReservation | null {
        const transaction = this.database.transaction(() => {
            const current = this.getReservation(reservationId);
            if (!current || current.status !== 'reserved') return;
            const updated = this.database.run(`UPDATE institution_treasury SET reserved_gp = reserved_gp - ?3,
                revision = revision + 1, updated_at = ?4 WHERE actor_kind = ?1 AND actor_id = ?2 AND reserved_gp >= ?3`,
            [current.kind, current.actorId, current.amountGp, now]);
            if (updated.changes !== 1) throw new Error('Treasury funds changed during reservation release');
            this.database.run(`UPDATE institution_treasury_reservation SET status = 'released',
                updated_at = ?2 WHERE reservation_id = ?1 AND status = 'reserved'`, [reservationId, now]);
        });
        transaction.immediate();
        return this.getReservation(reservationId);
    }
}
