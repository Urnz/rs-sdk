import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { BoundSimulationEventStamp, SimulationClockStatus } from '../../../simulation-clock/types.js';
import type { SimulationClockStore } from '../../../simulation-clock/store.js';
import type { InstitutionKind } from './institution-treasury.js';
import type { InstitutionSettlementRecord } from './institution-settlement-orchestrator.js';

export interface BankDefinition { bankId: string; treasuryActorId: string; reserveRatioBps: number;
    depositInterestBps: number; revision: number; createdAt: string; updatedAt: string }
export interface BankDepositAccount { accountId: string; bankId: string; ownerKind: InstitutionKind;
    ownerActorId: string; balanceGp: number; revision: number; createdAt: string; updatedAt: string }
export interface BankReservePosition { depositsGp: number; cashGp: number; requiredReserveGp: number;
    excessReserveGp: number; reserveRatioBps: number; compliant: boolean }
export type BankJournalKind = 'deposit' | 'withdrawal' | 'interest';
export interface BankJournalEntry { transactionId: string; settlementId: string; eventId: string;
    eventDigest: string; bankId: string; accountId: string; kind: BankJournalKind; amountGp: number;
    debitAccount: string; creditAccount: string; createdAt: string;
    simulationStamp?: BoundSimulationEventStamp | null }
export interface BankPosting { postingId: string; transactionId: string; side: 'debit'|'credit'; account: string; amountGp: number }

interface BankRow { bank_id: string; treasury_actor_id: string; reserve_ratio_bps: number;
    deposit_interest_bps: number; revision: number; created_at: string; updated_at: string }
interface AccountRow { account_id: string; bank_id: string; owner_kind: InstitutionKind; owner_actor_id: string;
    balance_gp: number; revision: number; created_at: string; updated_at: string }
interface JournalRow { transaction_id: string; settlement_id: string; event_id: string; event_digest: string;
    bank_id: string; account_id: string; kind: BankJournalKind; amount_gp: number;
    debit_account: string; credit_account: string; created_at: string;
    simulation_clock_id: string | null; simulation_sequence: number | null; simulation_time: string | null;
    simulation_binding_wall_time: string | null; simulation_engine_tick: number | null;
    simulation_profile_digest: string | null; simulation_clock_status: SimulationClockStatus | null;
    simulation_clock_revision: number | null; simulation_source_digest: string | null }

export interface BankingSimulationClock { store: SimulationClockStore; clockId: string;
    engineTick?: () => number | undefined }

const MAX_GP = 2_147_483_647;
function id(value: string, label: string): string { const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized)) throw new Error(`${label} is invalid`); return normalized }
function bank(row: BankRow): BankDefinition { return { bankId: row.bank_id, treasuryActorId: row.treasury_actor_id,
    reserveRatioBps: row.reserve_ratio_bps, depositInterestBps: row.deposit_interest_bps,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at } }
function account(row: AccountRow): BankDepositAccount { return { accountId: row.account_id, bankId: row.bank_id,
    ownerKind: row.owner_kind, ownerActorId: row.owner_actor_id, balanceGp: row.balance_gp,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at } }
function entry(row: JournalRow): BankJournalEntry { const stampValues = [row.simulation_clock_id,
    row.simulation_sequence, row.simulation_time, row.simulation_binding_wall_time,
    row.simulation_profile_digest, row.simulation_clock_status, row.simulation_clock_revision,
    row.simulation_source_digest]; const hasStamp = stampValues.some(value => value !== null);
    if (hasStamp && stampValues.some(value => value === null)) throw new Error(`Bank simulation stamp is incomplete for ${row.transaction_id}`);
    const simulationStamp: BoundSimulationEventStamp | null = hasStamp ? { clockId: row.simulation_clock_id!,
        domain: 'bank-journal', sourceId: row.transaction_id, sourceDigest: row.simulation_source_digest!,
        sequence: row.simulation_sequence!, simulationTime: row.simulation_time!, wallTime: row.simulation_binding_wall_time!,
        engineTick: row.simulation_engine_tick, profileDigest: row.simulation_profile_digest!,
        status: row.simulation_clock_status!, revision: row.simulation_clock_revision! } : null;
    return { transactionId: row.transaction_id,
    settlementId: row.settlement_id, eventId: row.event_id, eventDigest: row.event_digest,
    bankId: row.bank_id, accountId: row.account_id, kind: row.kind, amountGp: row.amount_gp,
    debitAccount: row.debit_account, creditAccount: row.credit_account, createdAt: row.created_at,
    simulationStamp } }
function auditEntry(value: BankJournalEntry): Omit<BankJournalEntry, 'simulationStamp'> {
    const { simulationStamp: _simulationStamp, ...core } = value; return core
}
function txDigest(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export class BankingLedgerStore {
    private readonly database: Database;
    constructor(path: string, private readonly simulationClock?: BankingSimulationClock) {
        mkdirSync(dirname(path), { recursive: true }); this.database = new Database(path, { create: true, strict: true });
        try { this.database.run('PRAGMA foreign_keys = ON'); this.migrate();
            if (simulationClock) this.backfillSimulationStamps();
        } catch (error) { this.database.close(true); throw error }
    }
    private migrate(): void { const schemaTable=this.database.query(`SELECT 1 AS found FROM sqlite_master
            WHERE type='table' AND name='banking_ledger_schema'`).get();
        if(schemaTable){const schema=this.database.query(`SELECT version FROM banking_ledger_schema WHERE singleton=1`).get() as {version:number}|null;
            if(!schema||schema.version!==1)throw new Error(`Unsupported banking ledger schema version: ${schema?.version??'missing'}`)}
        const migration = this.database.transaction(() => {
        this.database.run(`CREATE TABLE IF NOT EXISTS banking_ledger_schema (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>=1))`);
        this.database.run(`INSERT OR IGNORE INTO banking_ledger_schema(singleton,version) VALUES(1,1)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_bank (bank_id TEXT PRIMARY KEY,
            treasury_actor_id TEXT NOT NULL UNIQUE, reserve_ratio_bps INTEGER NOT NULL CHECK (reserve_ratio_bps BETWEEN 0 AND 10000),
            deposit_interest_bps INTEGER NOT NULL CHECK (deposit_interest_bps BETWEEN 0 AND 10000), revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS bank_deposit_account (account_id TEXT PRIMARY KEY,
            bank_id TEXT NOT NULL, owner_kind TEXT NOT NULL CHECK (owner_kind IN ('business','faction')), owner_actor_id TEXT NOT NULL,
            balance_gp INTEGER NOT NULL CHECK (balance_gp BETWEEN 0 AND 2147483647), revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(bank_id, owner_kind, owner_actor_id),
            FOREIGN KEY(bank_id) REFERENCES economic_bank(bank_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS bank_journal (transaction_id TEXT PRIMARY KEY,
            settlement_id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL UNIQUE, event_digest TEXT NOT NULL CHECK(length(event_digest)=64),
            bank_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('deposit','withdrawal','interest')),
            amount_gp INTEGER NOT NULL CHECK(amount_gp > 0), debit_account TEXT NOT NULL, credit_account TEXT NOT NULL,
            created_at TEXT NOT NULL, FOREIGN KEY(bank_id) REFERENCES economic_bank(bank_id),
            FOREIGN KEY(account_id) REFERENCES bank_deposit_account(account_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS bank_posting (posting_id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('debit','credit')),
            account TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK(amount_gp>0),
            UNIQUE(transaction_id,side), FOREIGN KEY(transaction_id) REFERENCES bank_journal(transaction_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS bank_audit_chain (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT NOT NULL UNIQUE, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE,
            FOREIGN KEY(transaction_id) REFERENCES bank_journal(transaction_id))`);
        const columns = this.database.query('PRAGMA table_info(bank_journal)').all() as Array<{name:string}>;
        const existing = new Set(columns.map(column => column.name));
        const additions: Array<[string,string]> = [['simulation_clock_id','TEXT'],['simulation_sequence','INTEGER'],
            ['simulation_time','TEXT'],['simulation_binding_wall_time','TEXT'],['simulation_engine_tick','INTEGER'],
            ['simulation_profile_digest','TEXT'],['simulation_clock_status','TEXT'],['simulation_clock_revision','INTEGER'],
            ['simulation_source_digest','TEXT']];
        for (const [name,type] of additions) if (!existing.has(name)) this.database.run(`ALTER TABLE bank_journal ADD COLUMN ${name} ${type}`);
        this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS bank_journal_simulation_sequence
            ON bank_journal(simulation_clock_id,simulation_sequence) WHERE simulation_clock_id IS NOT NULL`);
        }); migration.immediate();
    }
    close(): void { this.database.close(true) }
    createBank(bankIdInput: string, treasuryActorIdInput: string, reserveRatioBps: number,
        depositInterestBps: number, now = new Date().toISOString()): BankDefinition {
        const bankId = id(bankIdInput, 'Bank id'); const treasuryActorId = id(treasuryActorIdInput, 'Bank treasury actor id');
        for (const [label, value] of [['reserve ratio', reserveRatioBps], ['deposit interest', depositInterestBps]] as const) {
            if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error(`Bank ${label} must be between 0 and 10000 bps`);
        }
        this.database.run(`INSERT INTO economic_bank VALUES (?1,?2,?3,?4,1,?5,?5)`,
            [bankId, treasuryActorId, reserveRatioBps, depositInterestBps, now]); return this.getBank(bankId)!;
    }
    getBank(bankIdInput: string): BankDefinition | null { const row = this.database.query(`SELECT * FROM economic_bank WHERE bank_id=?1`)
        .get(id(bankIdInput, 'Bank id')) as BankRow | null; return row ? bank(row) : null }
    openAccount(bankIdInput: string, accountIdInput: string, ownerKind: InstitutionKind, ownerActorIdInput: string,
        now = new Date().toISOString()): BankDepositAccount { const bankId = id(bankIdInput, 'Bank id');
        if (!this.getBank(bankId)) throw new Error('Bank does not exist'); const accountId = id(accountIdInput, 'Bank account id');
        const ownerActorId = id(ownerActorIdInput, 'Bank account owner id');
        this.database.run(`INSERT INTO bank_deposit_account VALUES (?1,?2,?3,?4,0,1,?5,?5)`,
            [accountId, bankId, ownerKind, ownerActorId, now]); return this.getAccount(accountId)! }
    getAccount(accountIdInput: string): BankDepositAccount | null { const row = this.database.query(`SELECT * FROM bank_deposit_account WHERE account_id=?1`)
        .get(id(accountIdInput, 'Bank account id')) as AccountRow | null; return row ? account(row) : null }
    listJournal(): BankJournalEntry[] { return (this.database.query(`SELECT * FROM bank_journal ORDER BY created_at, transaction_id`).all() as JournalRow[]).map(entry) }
    listPostings(transactionId: string): BankPosting[] { return this.database.query(`SELECT posting_id postingId,
        transaction_id transactionId,side,account,amount_gp amountGp FROM bank_posting WHERE transaction_id=?1 ORDER BY side`)
        .all(transactionId) as BankPosting[] }
    verifyAuditChain(): { valid: boolean; entries: number; headHash: string } { const rows=this.database.query(`SELECT a.sequence,
        a.previous_hash previousHash,a.entry_hash entryHash,j.* FROM bank_audit_chain a JOIN bank_journal j USING(transaction_id) ORDER BY a.sequence`).all() as Array<JournalRow&{previousHash:string;entryHash:string}>;
        const counts=this.database.query(`SELECT (SELECT COUNT(*) FROM bank_journal) journals,
            (SELECT COUNT(*) FROM bank_posting) postings,(SELECT COUNT(*) FROM bank_audit_chain) audits`).get() as {journals:number;postings:number;audits:number};
        if(counts.journals!==counts.audits||counts.postings!==counts.journals*2)return{valid:false,entries:rows.length,headHash:'0'.repeat(64)};
        let previous='0'.repeat(64);for(const row of rows){const e=entry(row);const postings=this.listPostings(e.transactionId);
            if(postings.length!==2||postings[0]?.side!=='credit'||postings[1]?.side!=='debit'||postings[0].amountGp!==postings[1].amountGp||postings[0].amountGp!==e.amountGp)return{valid:false,entries:rows.length,headHash:previous};
            const expected=txDigest({previousHash:previous,entry:auditEntry(e),postings});if(row.previousHash!==previous||row.entryHash!==expected)return{valid:false,entries:rows.length,headHash:previous};previous=row.entryHash}
        return{valid:true,entries:rows.length,headHash:previous} }
    reservePosition(bankIdInput: string, cashGp: number): BankReservePosition { const definition = this.getBank(bankIdInput);
        if (!definition) throw new Error('Bank does not exist'); if (!Number.isSafeInteger(cashGp) || cashGp < 0 || cashGp > MAX_GP) throw new Error('Bank cash is invalid');
        const result = this.database.query(`SELECT COALESCE(SUM(balance_gp),0) total FROM bank_deposit_account WHERE bank_id=?1`).get(definition.bankId) as { total: number };
        const requiredReserveGp = Math.ceil(result.total * definition.reserveRatioBps / 10_000);
        return { depositsGp: result.total, cashGp, requiredReserveGp, excessReserveGp: cashGp - requiredReserveGp,
            reserveRatioBps: definition.reserveRatioBps, compliant: cashGp >= requiredReserveGp } }
    postSettlement(accountIdInput: string, kind: BankJournalKind, settlement: InstitutionSettlementRecord,
        now = new Date().toISOString()): BankJournalEntry {
        const target = this.getAccount(accountIdInput); if (!target) throw new Error('Bank account does not exist');
        const definition = this.getBank(target.bankId)!; if (settlement.domain !== 'banking' || settlement.status !== 'committed') throw new Error('Bank journal requires a committed banking settlement');
        const expectedKind = kind === 'deposit' ? 'deposit-cleared' : kind === 'withdrawal' ? 'withdrawal-approved' : 'interest-accrued';
        if (settlement.eventKind !== expectedKind) throw new Error('Bank journal kind does not match settlement evidence');
        const ownerMatchesPayer = settlement.payerKind === target.ownerKind && settlement.payerActorId === target.ownerActorId;
        const ownerMatchesPayee = settlement.payeeKind === target.ownerKind && settlement.payeeActorId === target.ownerActorId;
        const bankMatchesPayer = settlement.payerKind === 'business' && settlement.payerActorId === definition.treasuryActorId;
        const bankMatchesPayee = settlement.payeeKind === 'business' && settlement.payeeActorId === definition.treasuryActorId;
        if ((kind === 'deposit' && (!ownerMatchesPayer || !bankMatchesPayee))
            || (kind !== 'deposit' && (!bankMatchesPayer || !ownerMatchesPayee))) throw new Error('Bank settlement parties do not match the account');
        const debitAccount = kind === 'deposit' ? `asset:treasury:${definition.treasuryActorId}`
            : kind === 'withdrawal' ? `liability:deposit:${target.accountId}` : `expense:deposit-interest:${definition.bankId}`;
        const creditAccount = kind === 'deposit' || kind === 'interest' ? `liability:deposit:${target.accountId}`
            : `asset:treasury:${definition.treasuryActorId}`;
        const payload = { settlementId: settlement.settlementId, eventId: settlement.eventId,
            eventDigest: settlement.eventDigest, bankId: target.bankId, accountId: target.accountId,
            kind, amountGp: settlement.amountGp, debitAccount, creditAccount };
        const transactionId = txDigest(payload); const existing = this.database.query(`SELECT * FROM bank_journal WHERE settlement_id=?1`)
            .get(settlement.settlementId) as JournalRow | null;
        if (existing) { if (existing.transaction_id !== transactionId) throw new Error('Bank settlement changed after posting');
            if (existing.simulation_clock_id === null) { const stamp=this.bindSimulationStamp(transactionId,existing.created_at);
                if(stamp)this.writeSimulationStamp(transactionId,stamp) }
            return entry(this.database.query(`SELECT * FROM bank_journal WHERE transaction_id=?1`).get(transactionId) as JournalRow) }
        const stamp=this.bindSimulationStamp(transactionId,now);
        const delta = kind === 'withdrawal' ? -settlement.amountGp : settlement.amountGp;
        const transaction = this.database.transaction(() => { const updated = this.database.run(`UPDATE bank_deposit_account SET balance_gp=balance_gp+?2,
                revision=revision+1, updated_at=?3 WHERE account_id=?1 AND balance_gp+?2 BETWEEN 0 AND 2147483647`, [target.accountId, delta, now]);
            if (updated.changes !== 1) throw new Error('Bank account has insufficient funds or would overflow');
            this.database.run(`INSERT INTO bank_journal (transaction_id,settlement_id,event_id,event_digest,bank_id,
                account_id,kind,amount_gp,debit_account,credit_account,created_at,simulation_clock_id,
                simulation_sequence,simulation_time,simulation_binding_wall_time,simulation_engine_tick,
                simulation_profile_digest,simulation_clock_status,simulation_clock_revision,simulation_source_digest)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
                [transactionId, settlement.settlementId, settlement.eventId, settlement.eventDigest, target.bankId,
                    target.accountId, kind, settlement.amountGp, debitAccount, creditAccount, now,
                    stamp?.clockId??null,stamp?.sequence??null,stamp?.simulationTime??null,stamp?.wallTime??null,
                    stamp?.engineTick??null,stamp?.profileDigest??null,stamp?.status??null,stamp?.revision??null,
                    stamp?.sourceDigest??null]);
            const postings:BankPosting[]=[{postingId:`${transactionId}:credit`,transactionId,side:'credit',account:creditAccount,amountGp:settlement.amountGp},
                {postingId:`${transactionId}:debit`,transactionId,side:'debit',account:debitAccount,amountGp:settlement.amountGp}];
            for(const p of postings)this.database.run(`INSERT INTO bank_posting VALUES(?1,?2,?3,?4,?5)`,[p.postingId,p.transactionId,p.side,p.account,p.amountGp]);
            const prior=this.database.query(`SELECT entry_hash entryHash FROM bank_audit_chain ORDER BY sequence DESC LIMIT 1`).get() as {entryHash:string}|null;
            const previousHash=prior?.entryHash??'0'.repeat(64);const journalEntry:Omit<BankJournalEntry,'simulationStamp'>={transactionId,...payload,createdAt:now};
            const entryHash=txDigest({previousHash,entry:journalEntry,postings});this.database.run(`INSERT INTO bank_audit_chain(transaction_id,previous_hash,entry_hash) VALUES(?1,?2,?3)`,[transactionId,previousHash,entryHash]); }); transaction.immediate();
        return entry(this.database.query(`SELECT * FROM bank_journal WHERE transaction_id=?1`).get(transactionId) as JournalRow)
    }

    private bindSimulationStamp(transactionId: string, requestedWallTime: string): BoundSimulationEventStamp | null {
        if (!this.simulationClock) return null; const clock=this.simulationClock.store.get(this.simulationClock.clockId);
        if(!clock)throw new Error(`Simulation clock ${this.simulationClock.clockId} does not exist`);
        const normalized=new Date(requestedWallTime).toISOString(); const wallTime=normalized<clock.lastObservedWallTime
            ?clock.lastObservedWallTime:normalized;
        return this.simulationClock.store.bindEvent({clockId:this.simulationClock.clockId,domain:'bank-journal',
            sourceId:transactionId,sourceDigest:transactionId,wallTime,
            engineTick:this.simulationClock.engineTick?.()}).stamp
    }
    private writeSimulationStamp(transactionId:string,stamp:BoundSimulationEventStamp):void {
        this.database.run(`UPDATE bank_journal SET simulation_clock_id=?2,simulation_sequence=?3,
            simulation_time=?4,simulation_binding_wall_time=?5,simulation_engine_tick=?6,
            simulation_profile_digest=?7,simulation_clock_status=?8,simulation_clock_revision=?9,
            simulation_source_digest=?10 WHERE transaction_id=?1 AND simulation_clock_id IS NULL`,
        [transactionId,stamp.clockId,stamp.sequence,stamp.simulationTime,stamp.wallTime,stamp.engineTick,
            stamp.profileDigest,stamp.status,stamp.revision,stamp.sourceDigest])
    }
    private backfillSimulationStamps():void { const rows=this.database.query(`SELECT * FROM bank_journal
        WHERE simulation_clock_id IS NULL ORDER BY created_at,transaction_id`).all() as JournalRow[];
        for(const row of rows){const stamp=this.bindSimulationStamp(row.transaction_id,row.created_at)!;
            this.writeSimulationStamp(row.transaction_id,stamp)} }
}
