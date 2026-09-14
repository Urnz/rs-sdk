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

export interface InstitutionTreasuryTransfer {
    settlementId: string;
    reservationId: string;
    payerKind: InstitutionKind;
    payerActorId: string;
    payeeKind: InstitutionKind;
    payeeActorId: string;
    amountGp: number;
    createdAt: string;
}
export interface TreasuryGenesisReceipt { allocationId:string;kind:InstitutionKind;actorId:string;amountGp:number;
    status:'active'|'reset';createdAt:string;resetAt:string|null }

interface AccountRow {
    actor_kind: InstitutionKind; actor_id: string; balance_gp: number; reserved_gp: number;
    revision: number; created_at: string; updated_at: string;
}
interface ReservationRow {
    reservation_id: string; actor_kind: InstitutionKind; actor_id: string; amount_gp: number;
    status: TreasuryReservationStatus; settlement_id: string | null; created_at: string; updated_at: string;
}
interface TransferRow {
    settlement_id: string; reservation_id: string; payer_kind: InstitutionKind; payer_actor_id: string;
    payee_kind: InstitutionKind; payee_actor_id: string; amount_gp: number; created_at: string;
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
function transfer(row: TransferRow): InstitutionTreasuryTransfer {
    return { settlementId: row.settlement_id, reservationId: row.reservation_id,
        payerKind: row.payer_kind, payerActorId: row.payer_actor_id,
        payeeKind: row.payee_kind, payeeActorId: row.payee_actor_id,
        amountGp: row.amount_gp, createdAt: row.created_at };
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
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_treasury_transfer (
            settlement_id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE,
            payer_kind TEXT NOT NULL CHECK (payer_kind IN ('business', 'faction')), payer_actor_id TEXT NOT NULL,
            payee_kind TEXT NOT NULL CHECK (payee_kind IN ('business', 'faction')), payee_actor_id TEXT NOT NULL,
            amount_gp INTEGER NOT NULL CHECK (amount_gp > 0), created_at TEXT NOT NULL,
            FOREIGN KEY (reservation_id) REFERENCES institution_treasury_reservation(reservation_id),
            FOREIGN KEY (payer_kind, payer_actor_id) REFERENCES institution_treasury(actor_kind, actor_id),
            FOREIGN KEY (payee_kind, payee_actor_id) REFERENCES institution_treasury(actor_kind, actor_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_treasury_genesis (
            allocation_id TEXT PRIMARY KEY,actor_kind TEXT NOT NULL CHECK(actor_kind IN ('business','faction')),
            actor_id TEXT NOT NULL,amount_gp INTEGER NOT NULL CHECK(amount_gp>0),
            status TEXT NOT NULL CHECK(status IN ('active','reset')),created_at TEXT NOT NULL,reset_at TEXT)`);
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

    creditGenesis(kind:InstitutionKind,idInput:string,allocationId:string,amountGp:number,
        now=new Date().toISOString()):TreasuryGenesisReceipt {
        const id=actorId(idInput);
        if(!/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(allocationId))throw new Error('Genesis treasury allocation id is invalid');
        if(!Number.isSafeInteger(amountGp)||amountGp<1||amountGp>2147483647)throw new Error('Genesis treasury amount is invalid');
        const existing=this.database.query('SELECT * FROM institution_treasury_genesis WHERE allocation_id=?1')
            .get(allocationId) as {actor_kind:InstitutionKind;actor_id:string;amount_gp:number;
                status:'active'|'reset';created_at:string;reset_at:string|null}|null;
        if(existing){if(existing.actor_kind!==kind||existing.actor_id!==id||existing.amount_gp!==amountGp)
            throw new Error('Genesis treasury allocation id was reused');
            return{allocationId,kind,actorId:id,amountGp,status:existing.status,createdAt:existing.created_at,resetAt:existing.reset_at}}
        const transaction=this.database.transaction(()=>{
            this.database.run(`INSERT OR IGNORE INTO institution_treasury
                (actor_kind,actor_id,balance_gp,reserved_gp,revision,created_at,updated_at)
                VALUES(?1,?2,0,0,1,?3,?3)`,[kind,id,now]);
            const changed=this.database.run(`UPDATE institution_treasury SET balance_gp=balance_gp+?3,
                revision=revision+1,updated_at=?4 WHERE actor_kind=?1 AND actor_id=?2 AND balance_gp<=2147483647-?3`,
            [kind,id,amountGp,now]);
            if(changed.changes!==1)throw new Error('Genesis treasury credit would overflow');
            this.database.run(`INSERT INTO institution_treasury_genesis VALUES(?1,?2,?3,?4,'active',?5,NULL)`,
                [allocationId,kind,id,amountGp,now]);
        });transaction.immediate();
        return{allocationId,kind,actorId:id,amountGp,status:'active',createdAt:now,resetAt:null};
    }

    resetGenesis(allocationId:string,now=new Date().toISOString()):TreasuryGenesisReceipt|null {
        if(!/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(allocationId))throw new Error('Genesis treasury allocation id is invalid');
        const row=this.database.query('SELECT * FROM institution_treasury_genesis WHERE allocation_id=?1').get(allocationId) as
            {actor_kind:InstitutionKind;actor_id:string;amount_gp:number;status:'active'|'reset';created_at:string;reset_at:string|null}|null;
        if(!row)return null;
        if(row.status==='reset')return{allocationId,kind:row.actor_kind,actorId:row.actor_id,amountGp:row.amount_gp,
            status:'reset',createdAt:row.created_at,resetAt:row.reset_at};
        const transaction=this.database.transaction(()=>{
            const changed=this.database.run(`UPDATE institution_treasury SET balance_gp=balance_gp-?3,
                revision=revision+1,updated_at=?4 WHERE actor_kind=?1 AND actor_id=?2
                AND balance_gp-reserved_gp>=?3`,[row.actor_kind,row.actor_id,row.amount_gp,now]);
            if(changed.changes!==1)throw new Error('Genesis treasury funds are reserved or spent and cannot be reset');
            this.database.run(`UPDATE institution_treasury_genesis SET status='reset',reset_at=?2
                WHERE allocation_id=?1 AND status='active'`,[allocationId,now]);
        });transaction.immediate();
        return{allocationId,kind:row.actor_kind,actorId:row.actor_id,amountGp:row.amount_gp,
            status:'reset',createdAt:row.created_at,resetAt:now};
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
        if (!current) throw new Error('Treasury reservation is not payable');
        if (current.settlementId && current.settlementId !== settlementId) {
            throw new Error('Treasury reservation is bound to another settlement');
        }
        if (current.status === 'committed' && current.settlementId === settlementId) return current;
        if (current.status !== 'reserved') throw new Error('Treasury reservation is not payable');
        this.database.run(`UPDATE institution_treasury_reservation SET settlement_id = ?2,
            updated_at = ?3 WHERE reservation_id = ?1 AND status = 'reserved' AND settlement_id IS NULL`,
        [reservationId, settlementId, now]);
        return this.getReservation(reservationId)!;
    }

    getTransfer(settlementId: string): InstitutionTreasuryTransfer | null {
        const row = this.database.query(`SELECT * FROM institution_treasury_transfer
            WHERE settlement_id = ?1`).get(settlementId) as TransferRow | null;
        return row ? transfer(row) : null;
    }

    listTransfers(limit = 100): InstitutionTreasuryTransfer[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Treasury transfer list limit must be between 1 and 1000');
        }
        return (this.database.query(`SELECT * FROM institution_treasury_transfer
            ORDER BY created_at DESC, settlement_id DESC LIMIT ?1`).all(limit) as TransferRow[]).map(transfer);
    }

    transferReserved(reservationId: string, settlementId: string, payeeKind: InstitutionKind,
        payeeIdInput: string, now = new Date().toISOString()): InstitutionTreasuryTransfer {
        const payeeActorId = actorId(payeeIdInput);
        const transaction = this.database.transaction(() => {
            const current = this.getReservation(reservationId);
            if (!current || current.settlementId !== settlementId) {
                throw new Error('Treasury transfer does not match its reservation');
            }
            if (current.kind === payeeKind && current.actorId === payeeActorId) {
                throw new Error('Treasury transfer payer and payee must be different');
            }
            const existing = this.getTransfer(settlementId);
            if (existing) {
                if (existing.reservationId !== reservationId || existing.payerKind !== current.kind
                    || existing.payerActorId !== current.actorId || existing.payeeKind !== payeeKind
                    || existing.payeeActorId !== payeeActorId || existing.amountGp !== current.amountGp) {
                    throw new Error('Treasury settlement id was reused for a different transfer');
                }
                return;
            }
            if (current.status !== 'reserved') throw new Error('Treasury reservation is not transferable');
            const payee = this.ensure(payeeKind, payeeActorId, now);
            if (payee.balanceGp > 2_147_483_647 - current.amountGp) {
                throw new Error('Treasury transfer would exceed the recipient balance limit');
            }
            const debited = this.database.run(`UPDATE institution_treasury SET
                balance_gp = balance_gp - ?3, reserved_gp = reserved_gp - ?3,
                revision = revision + 1, updated_at = ?4
                WHERE actor_kind = ?1 AND actor_id = ?2 AND reserved_gp >= ?3 AND balance_gp >= ?3`,
            [current.kind, current.actorId, current.amountGp, now]);
            if (debited.changes !== 1) throw new Error('Treasury payer funds changed during transfer');
            const credited = this.database.run(`UPDATE institution_treasury SET balance_gp = balance_gp + ?3,
                revision = revision + 1, updated_at = ?4
                WHERE actor_kind = ?1 AND actor_id = ?2 AND balance_gp <= ?5`,
            [payeeKind, payeeActorId, current.amountGp, now, 2_147_483_647 - current.amountGp]);
            if (credited.changes !== 1) throw new Error('Treasury recipient changed during transfer');
            this.database.run(`UPDATE institution_treasury_reservation SET status = 'committed',
                updated_at = ?2 WHERE reservation_id = ?1 AND status = 'reserved'`, [reservationId, now]);
            this.database.run(`INSERT INTO institution_treasury_transfer
                (settlement_id, reservation_id, payer_kind, payer_actor_id,
                    payee_kind, payee_actor_id, amount_gp, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            [settlementId, reservationId, current.kind, current.actorId,
                payeeKind, payeeActorId, current.amountGp, now]);
        });
        transaction.immediate();
        return this.getTransfer(settlementId)!;
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
