import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
interface EscrowCheckpointDatabase { db: Database; checkpoint(owner: string, save: Uint8Array, enroll?: boolean): void }

export interface PlayerEscrowItem {
    id: number;
    count: number;
}

export interface PlayerEscrowAssets {
    gp: number;
    items: PlayerEscrowItem[];
}

type StoredPlayerEscrowStatus = 'pending' | 'held' | 'releasing' | 'released' | 'rejected' | 'reconcile';
export type PlayerEscrowStatus = StoredPlayerEscrowStatus | 'settling' | 'committed';

export interface PlayerInventoryEscrowRecord {
    escrowId: string;
    username: string;
    assets: PlayerEscrowAssets;
    status: PlayerEscrowStatus;
    balancesBefore: PlayerEscrowItem[];
    payeeUsername: string | null;
    payeeBalancesBefore: PlayerEscrowItem[];
    committedAt: string | null;
    createdAt: string;
    updatedAt: string;
    error: string | null;
}

export interface PlayerInventoryEscrowWallet {
    count(itemId: number): number;
    remove(itemId: number, count: number): number;
    add(itemId: number, count: number): number;
}

export type PlayerEscrowCheckpoint = {
    /** The affected online player, not an arbitrary payer/payee supplied by a caller. */
    owner: string;
    /** Serialize the post-mutation player state synchronously. */
    save(): Uint8Array;
    /** Restore the pre-mutation in-memory state if SQLite or serialization fails. */
    rollback(): void;
};

export type PlayerEscrowCheckpointCommand =
    | { operation: 'hold'; escrowId: string; username: string; assets: PlayerEscrowAssets }
    | { operation: 'release' | 'consume'; escrowId: string; username: string }
    | { operation: 'commit'; escrowId: string; username: string; payeeUsername: string };

interface EscrowRow {
    escrow_id: string; username: string; assets_json: string; status: StoredPlayerEscrowStatus;
    balances_before_json: string; payee_username: string | null; payee_balances_before_json: string | null;
    commit_started_at: string | null; committed_at: string | null;
    created_at: string; updated_at: string; error: string | null;
}
interface EscrowAuditRow { escrow_id: string; operation: PlayerEscrowCheckpointCommand['operation'];
    row_digest: string; previous_hash: string; entry_hash: string; occurred_at: string; business_binding_digest?: string | null }

const MAX_STACK = 2_147_483_647;
const ZERO_HASH = '0'.repeat(64);

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function rowDigest(row: EscrowRow): string {
    return hash(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeAssets(input: PlayerEscrowAssets): PlayerEscrowAssets {
    if (!Number.isSafeInteger(input.gp) || input.gp < 0 || input.gp > MAX_STACK) {
        throw new Error('Player escrow GP amount is invalid');
    }
    if (!Array.isArray(input.items) || input.items.length > 28) throw new Error('Player escrow item list is invalid');
    const totals = new Map<number, number>();
    for (const item of input.items) {
        if (!Number.isSafeInteger(item.id) || item.id < 0 || item.id > 65_535 || item.id === 995
            || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > MAX_STACK) {
            throw new Error('Player escrow item is invalid');
        }
        const total = (totals.get(item.id) ?? 0) + item.count;
        if (!Number.isSafeInteger(total) || total > MAX_STACK) throw new Error('Player escrow item total is invalid');
        totals.set(item.id, total);
    }
    const items = [...totals].sort(([left], [right]) => left - right).map(([id, count]) => ({ id, count }));
    if (input.gp === 0 && items.length === 0) throw new Error('Player escrow assets cannot be empty');
    return { gp: input.gp, items };
}

function holdings(assets: PlayerEscrowAssets): PlayerEscrowItem[] {
    return [...(assets.gp > 0 ? [{ id: 995, count: assets.gp }] : []), ...assets.items];
}

function escrow(row: EscrowRow): PlayerInventoryEscrowRecord {
    return { escrowId: row.escrow_id, username: row.username,
        assets: JSON.parse(row.assets_json) as PlayerEscrowAssets,
        status: row.committed_at ? 'committed' : row.commit_started_at ? 'settling' : row.status,
        balancesBefore: JSON.parse(row.balances_before_json) as PlayerEscrowItem[],
        payeeUsername: row.payee_username,
        payeeBalancesBefore: row.payee_balances_before_json
            ? JSON.parse(row.payee_balances_before_json) as PlayerEscrowItem[] : [],
        committedAt: row.committed_at,
        createdAt: row.created_at, updatedAt: row.updated_at, error: row.error };
}

function exactUsername(value: string): string {
    const username = value.trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(username)) throw new Error('Player escrow username is invalid');
    return username;
}

function exactUuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('Player escrow id must be a UUID');
    }
    return value.toLowerCase();
}

function isoTimestamp(value: string): string {
    if (Number.isNaN(Date.parse(value))) throw new Error('Player escrow timestamp must be ISO-8601');
    return new Date(value).toISOString();
}

export class PlayerInventoryEscrowStore {
    private readonly database: Database;
    private readonly sharedMarket: EscrowCheckpointDatabase | null;
    private atomicMutation = false;

    constructor(pathOrMarket: string | EscrowCheckpointDatabase, readOnly = false) {
        this.sharedMarket = typeof pathOrMarket === 'string' ? null : pathOrMarket;
        if (typeof pathOrMarket === 'string') mkdirSync(dirname(pathOrMarket), { recursive: true });
        this.database = this.sharedMarket?.db ?? new Database(pathOrMarket as string, { create: true, strict: true });
        if (readOnly) {
            if (!this.sharedMarket || !this.verifySharedAuditChain()) throw new Error('Readonly shared escrow audit is invalid');
            return;
        }
        this.database.run(`CREATE TABLE IF NOT EXISTS player_inventory_escrow (
            escrow_id TEXT PRIMARY KEY, username TEXT NOT NULL, assets_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'held', 'releasing', 'released', 'rejected', 'reconcile')),
            balances_before_json TEXT NOT NULL, payee_username TEXT, payee_balances_before_json TEXT,
            commit_started_at TEXT, committed_at TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`);
        this.addColumn('player_inventory_escrow', 'payee_username', 'TEXT');
        this.addColumn('player_inventory_escrow', 'payee_balances_before_json', 'TEXT');
        this.addColumn('player_inventory_escrow', 'commit_started_at', 'TEXT');
        this.addColumn('player_inventory_escrow', 'committed_at', 'TEXT');
        if (this.sharedMarket) this.database.run(`CREATE TABLE IF NOT EXISTS player_inventory_escrow_audit (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, escrow_id TEXT NOT NULL,
            operation TEXT NOT NULL, row_digest TEXT NOT NULL, previous_hash TEXT NOT NULL,
            entry_hash TEXT NOT NULL, occurred_at TEXT NOT NULL)`);
        if (this.sharedMarket) {
            this.addColumn('player_inventory_escrow_audit', 'business_binding_digest', 'TEXT');
            this.database.run(`CREATE TABLE IF NOT EXISTS player_inventory_escrow_business_binding(
                escrow_id TEXT PRIMARY KEY,binding_digest TEXT NOT NULL)`);
        }
    }

    private addColumn(table: string, column: string, declaration: string): void {
        const columns = this.database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some(entry => entry.name === column)) {
            this.database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
        }
    }

    close(): void { if (!this.sharedMarket) this.database.close(true); }

    private assertMutationContext(): void {
        if (this.sharedMarket && !this.atomicMutation)
            throw new Error('Shared player escrow requires an atomic checkpoint mutation');
    }

    /** New shared ledger only: verify every current escrow row against its last chained mutation. */
    verifySharedAuditChain(): boolean {
        if (!this.sharedMarket) throw new Error('Shared escrow audit requires a shared database');
        const audit = this.database.query('SELECT * FROM player_inventory_escrow_audit ORDER BY sequence')
            .all() as EscrowAuditRow[];
        const latest = new Map<string, string>();
        const purposes = new Map<string, string>();
        let previous = ZERO_HASH;
        for (const entry of audit) {
            const payload = { escrowId: entry.escrow_id, operation: entry.operation,
                rowDigest: entry.row_digest, occurredAt: entry.occurred_at,
                ...(entry.business_binding_digest ? { businessBindingDigest: entry.business_binding_digest } : {}) };
            if (entry.previous_hash !== previous || entry.entry_hash !== hash({ previous, payload })) return false;
            previous = entry.entry_hash;
            latest.set(entry.escrow_id, entry.row_digest);
            if (entry.business_binding_digest) purposes.set(entry.escrow_id, entry.business_binding_digest);
        }
        const bindings = this.database.query('SELECT * FROM player_inventory_escrow_business_binding').all() as { escrow_id: string; binding_digest: string }[];
        if (bindings.length !== purposes.size || bindings.some(row => purposes.get(row.escrow_id) !== row.binding_digest)) return false;
        const rows = this.database.query('SELECT * FROM player_inventory_escrow').all() as EscrowRow[];
        return latest.size === rows.length && rows.every(row => latest.get(row.escrow_id) === rowDigest(row));
    }

    private appendSharedAudit(escrowId: string, operation: PlayerEscrowCheckpointCommand['operation'],
        occurredAt: string): void {
        const row = this.database.query('SELECT * FROM player_inventory_escrow WHERE escrow_id=?1')
            .get(escrowId) as EscrowRow | null;
        if (!row) throw new Error('Escrow audit source row is absent');
        const digest = rowDigest(row);
        const lastForEscrow = this.database.query(`SELECT row_digest FROM player_inventory_escrow_audit
            WHERE escrow_id=?1 ORDER BY sequence DESC LIMIT 1`).get(escrowId) as { row_digest: string } | null;
        if (lastForEscrow?.row_digest === digest) return; // Exact idempotent replay.
        const previous = (this.database.query(`SELECT entry_hash FROM player_inventory_escrow_audit
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO_HASH;
        const payload = { escrowId, operation, rowDigest: digest, occurredAt };
        const purpose = this.database.query('SELECT binding_digest FROM player_inventory_escrow_business_binding WHERE escrow_id=?1')
            .get(escrowId) as { binding_digest: string } | null;
        const boundPayload = { ...payload, ...(purpose ? { businessBindingDigest: purpose.binding_digest } : {}) };
        this.database.run(`INSERT INTO player_inventory_escrow_audit
            (escrow_id,operation,row_digest,previous_hash,entry_hash,occurred_at,business_binding_digest)
            VALUES(?1,?2,?3,?4,?5,?6,?7)`,
        [escrowId, operation, digest, previous, hash({ previous, payload: boundPayload }), occurredAt, purpose?.binding_digest ?? null]);
    }

    /**
     * Opt-in durable boundary: escrow row and player checkpoint commit in the same SQLite transaction.
     * The live engine must not use this until legacy escrow migration and a checkpoint authority exist.
     */
    mutateWithCheckpoint(command: PlayerEscrowCheckpointCommand, wallet: PlayerInventoryEscrowWallet,
        account: PlayerEscrowCheckpoint, now = new Date().toISOString(), businessBindingDigest?: string): PlayerInventoryEscrowRecord {
        if (!this.sharedMarket) throw new Error('Escrow checkpoint requires a shared player save database');
        const affectedUsername = command.operation === 'commit' ? command.payeeUsername : command.username;
        if (account.owner !== exactUsername(account.owner)
            || account.owner !== exactUsername(affectedUsername))
            throw new Error('Escrow checkpoint player does not match the affected wallet');
        let mutationStarted = false;
        try {
            let value!: PlayerInventoryEscrowRecord;
            this.database.transaction(() => {
                if (!this.verifySharedAuditChain()) throw new Error('Shared player escrow audit chain is invalid');
                const binding = this.database.query('SELECT binding_digest FROM player_inventory_escrow_business_binding WHERE escrow_id=?1')
                    .get(command.escrowId) as { binding_digest: string } | null;
                if (binding && binding.binding_digest !== businessBindingDigest) throw new Error('Business custody requires its exact native WIP authority');
                if (businessBindingDigest) {
                    if (!/^[0-9a-f]{64}$/.test(businessBindingDigest)) throw new Error('Invalid Business custody binding');
                    if (!binding && command.operation !== 'hold') throw new Error('Business custody binding is absent');
                    if (!binding) this.database.run('INSERT INTO player_inventory_escrow_business_binding VALUES(?1,?2)', [command.escrowId, businessBindingDigest]);
                }
                mutationStarted = true;
                this.atomicMutation = true;
                let result: PlayerInventoryEscrowRecord;
                try {
                    result = command.operation === 'hold'
                        ? this.hold(command.escrowId, command.username, command.assets, wallet, now)
                        : command.operation === 'release'
                            ? this.release(command.escrowId, command.username, wallet, now)
                            : command.operation === 'commit'
                                ? this.commit(command.escrowId, command.username, command.payeeUsername, wallet, now)
                                : this.consume(command.escrowId, command.username, now);
                } finally { this.atomicMutation = false; }
                this.sharedMarket!.checkpoint(account.owner, account.save(), true);
                this.appendSharedAudit(result.escrowId, command.operation, isoTimestamp(now));
                if (!this.verifySharedAuditChain()) throw new Error('Shared player escrow audit chain is invalid');
                value = result;
            }).immediate();
            return value;
        } catch (error) {
            if (mutationStarted) account.rollback();
            throw error;
        }
    }

    get(escrowId: string): PlayerInventoryEscrowRecord | null {
        if (this.sharedMarket && !this.atomicMutation && !this.verifySharedAuditChain())
            throw new Error('Shared player escrow audit chain is invalid');
        const row = this.database.query(`SELECT * FROM player_inventory_escrow
            WHERE escrow_id = ?1`).get(escrowId) as EscrowRow | null;
        return row ? escrow(row) : null;
    }

    list(limit = 100): PlayerInventoryEscrowRecord[] {
        if (this.sharedMarket && !this.atomicMutation && !this.verifySharedAuditChain())
            throw new Error('Shared player escrow audit chain is invalid');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Player escrow list limit must be between 1 and 1000');
        }
        return (this.database.query(`SELECT * FROM player_inventory_escrow
            ORDER BY updated_at DESC, escrow_id DESC LIMIT ?1`).all(limit) as EscrowRow[]).map(escrow);
    }

    hold(escrowIdInput: string, usernameInput: string, assetsInput: PlayerEscrowAssets,
        wallet: PlayerInventoryEscrowWallet, now = new Date().toISOString()): PlayerInventoryEscrowRecord {
        this.assertMutationContext();
        const escrowId = exactUuid(escrowIdInput), username = exactUsername(usernameInput);
        const timestamp = isoTimestamp(now);
        const assets = normalizeAssets(assetsInput), assetsJson = JSON.stringify(assets);
        const existing = this.get(escrowId);
        if (existing) {
            if (existing.username !== username || JSON.stringify(existing.assets) !== assetsJson) {
                throw new Error('Player escrow id was reused for different assets');
            }
            if (existing.status === 'held' || existing.status === 'released'
                || existing.status === 'rejected' || existing.status === 'committed') return existing;
            throw new Error('Player escrow has an incomplete mutation; manual reconciliation is required');
        }
        const requested = holdings(assets);
        const balancesBefore = requested.map(item => ({ id: item.id, count: wallet.count(item.id) }));
        if (balancesBefore.some((balance, index) => !Number.isSafeInteger(balance.count)
            || balance.count < requested[index]!.count || balance.count > MAX_STACK)) {
            throw new Error('Insufficient or invalid player inventory assets for escrow');
        }
        this.database.run(`INSERT INTO player_inventory_escrow
            (escrow_id, username, assets_json, status, balances_before_json, created_at, updated_at, error)
            VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5, NULL)`,
        [escrowId, username, assetsJson, JSON.stringify(balancesBefore), timestamp]);
        const removed: PlayerEscrowItem[] = [];
        try {
            for (let index = 0; index < requested.length; index++) {
                const item = requested[index]!, before = balancesBefore[index]!.count;
                wallet.remove(item.id, item.count);
                const actual = before - wallet.count(item.id);
                if (actual > 0) removed.push({ id: item.id, count: actual });
                if (actual !== item.count) throw new Error(`Player escrow removal was incomplete for item ${item.id}`);
            }
            this.database.run(`UPDATE player_inventory_escrow SET status = 'held', updated_at = ?2
                WHERE escrow_id = ?1 AND status = 'pending'`, [escrowId, timestamp]);
        } catch (error) {
            let reconciled = true;
            for (const item of [...removed].reverse()) wallet.add(item.id, item.count);
            for (const balance of balancesBefore) if (wallet.count(balance.id) !== balance.count) reconciled = false;
            const message = error instanceof Error ? error.message : String(error);
            this.database.run(`UPDATE player_inventory_escrow SET status = ?2, error = ?3, updated_at = ?4
                WHERE escrow_id = ?1 AND status = 'pending'`,
            [escrowId, reconciled ? 'rejected' : 'reconcile', message.slice(0, 500), timestamp]);
            throw error;
        }
        return this.get(escrowId)!;
    }

    release(escrowIdInput: string, usernameInput: string, wallet: PlayerInventoryEscrowWallet,
        now = new Date().toISOString()): PlayerInventoryEscrowRecord {
        this.assertMutationContext();
        const escrowId = exactUuid(escrowIdInput), username = exactUsername(usernameInput);
        const timestamp = isoTimestamp(now);
        const current = this.get(escrowId);
        if (!current || current.username !== username) throw new Error('Player escrow does not belong to this player');
        if (current.status === 'released') return current;
        if (current.status !== 'held') throw new Error('Only held player escrow can be released');
        const requested = holdings(current.assets);
        const beforeRelease = requested.map(item => ({ id: item.id, count: wallet.count(item.id) }));
        if (beforeRelease.some(balance => !Number.isSafeInteger(balance.count)
            || balance.count < 0 || balance.count > MAX_STACK)) throw new Error('Player inventory state is invalid');
        this.database.run(`UPDATE player_inventory_escrow SET status = 'releasing', error = NULL,
            updated_at = ?2 WHERE escrow_id = ?1 AND status = 'held'`, [escrowId, timestamp]);
        const added: PlayerEscrowItem[] = [];
        try {
            for (let index = 0; index < requested.length; index++) {
                const item = requested[index]!, before = beforeRelease[index]!.count;
                wallet.add(item.id, item.count);
                const actual = wallet.count(item.id) - before;
                if (actual > 0) added.push({ id: item.id, count: actual });
                if (actual !== item.count) throw new Error(`Player escrow release was incomplete for item ${item.id}`);
            }
            this.database.run(`UPDATE player_inventory_escrow SET status = 'released', updated_at = ?2
                WHERE escrow_id = ?1 AND status = 'releasing'`, [escrowId, timestamp]);
        } catch (error) {
            for (const item of [...added].reverse()) wallet.remove(item.id, item.count);
            const reconciled = beforeRelease.every(balance => wallet.count(balance.id) === balance.count);
            const message = error instanceof Error ? error.message : String(error);
            this.database.run(`UPDATE player_inventory_escrow SET status = ?2, error = ?3, updated_at = ?4
                WHERE escrow_id = ?1 AND status = 'releasing'`,
            [escrowId, reconciled ? 'held' : 'reconcile', message.slice(0, 500), timestamp]);
            throw error;
        }
        return this.get(escrowId)!;
    }

    commit(escrowIdInput: string, payerUsernameInput: string, payeeUsernameInput: string,
        payeeWallet: PlayerInventoryEscrowWallet,
        now = new Date().toISOString()): PlayerInventoryEscrowRecord {
        this.assertMutationContext();
        const escrowId = exactUuid(escrowIdInput), payerUsername = exactUsername(payerUsernameInput);
        const payeeUsername = exactUsername(payeeUsernameInput), timestamp = isoTimestamp(now);
        if (payerUsername === payeeUsername) throw new Error('Player escrow payer and payee must be different');
        const current = this.get(escrowId);
        if (!current || current.username !== payerUsername) throw new Error('Player escrow does not belong to this payer');
        if (current.payeeUsername && current.payeeUsername !== payeeUsername) {
            throw new Error('Player escrow is bound to another payee');
        }
        if (current.status === 'committed') return current;
        if (current.status === 'settling' || current.status === 'reconcile') {
            throw new Error('Player escrow settlement requires manual reconciliation');
        }
        if (current.status !== 'held') throw new Error('Only held player escrow can be committed');
        const requested = holdings(current.assets);
        const balancesBefore = requested.map(item => ({ id: item.id, count: payeeWallet.count(item.id) }));
        if (balancesBefore.some((balance, index) => !Number.isSafeInteger(balance.count)
            || balance.count < 0 || balance.count > MAX_STACK - requested[index]!.count)) {
            throw new Error('Player escrow would overflow or cannot observe the payee inventory');
        }
        const started = this.database.run(`UPDATE player_inventory_escrow SET payee_username = ?2,
            payee_balances_before_json = ?3, commit_started_at = ?4, error = NULL, updated_at = ?4
            WHERE escrow_id = ?1 AND status = 'held' AND commit_started_at IS NULL AND committed_at IS NULL`,
        [escrowId, payeeUsername, JSON.stringify(balancesBefore), timestamp]);
        if (started.changes !== 1) throw new Error('Player escrow changed before settlement');
        const added: PlayerEscrowItem[] = [];
        try {
            for (let index = 0; index < requested.length; index++) {
                const item = requested[index]!, before = balancesBefore[index]!.count;
                payeeWallet.add(item.id, item.count);
                const actual = payeeWallet.count(item.id) - before;
                if (actual > 0) added.push({ id: item.id, count: actual });
                if (actual !== item.count) throw new Error(`Player escrow settlement was incomplete for item ${item.id}`);
            }
            const committed = this.database.run(`UPDATE player_inventory_escrow SET committed_at = ?2, updated_at = ?2
                WHERE escrow_id = ?1 AND commit_started_at IS NOT NULL AND committed_at IS NULL`,
            [escrowId, timestamp]);
            if (committed.changes !== 1) throw new Error('Player escrow changed during settlement');
        } catch (error) {
            for (const item of [...added].reverse()) payeeWallet.remove(item.id, item.count);
            const reconciled = balancesBefore.every(balance => payeeWallet.count(balance.id) === balance.count);
            const message = error instanceof Error ? error.message : String(error);
            this.database.run(`UPDATE player_inventory_escrow SET status = CASE WHEN ?2 THEN 'held' ELSE 'reconcile' END,
                payee_username = CASE WHEN ?2 THEN NULL ELSE payee_username END,
                payee_balances_before_json = CASE WHEN ?2 THEN NULL ELSE payee_balances_before_json END,
                commit_started_at = CASE WHEN ?2 THEN NULL ELSE commit_started_at END,
                error = ?3, updated_at = ?4 WHERE escrow_id = ?1 AND committed_at IS NULL`,
            [escrowId, reconciled ? 1 : 0, message.slice(0, 500), timestamp]);
            throw error;
        }
        return this.get(escrowId)!;
    }

    consume(escrowIdInput:string,payerUsernameInput:string,
        now=new Date().toISOString()):PlayerInventoryEscrowRecord {
        this.assertMutationContext();
        const escrowId=exactUuid(escrowIdInput),payerUsername=exactUsername(payerUsernameInput),timestamp=isoTimestamp(now);
        const current=this.get(escrowId);if(!current||current.username!==payerUsername)
            throw new Error('Player escrow does not belong to this payer');
        if(current.status==='committed'){if(current.payeeUsername!==null)
            throw new Error('Player escrow was committed to a payee');return current}
        if(current.status!=='held')throw new Error('Only held player escrow can be consumed');
        const changed=this.database.run(`UPDATE player_inventory_escrow SET commit_started_at=?2,committed_at=?2,
            updated_at=?2,error=NULL WHERE escrow_id=?1 AND status='held' AND payee_username IS NULL
            AND commit_started_at IS NULL AND committed_at IS NULL`,[escrowId,timestamp]);
        if(changed.changes!==1)throw new Error('Player escrow changed before consumption');return this.get(escrowId)!
    }
}

let defaultStore: PlayerInventoryEscrowStore | null = null;

export function getPlayerInventoryEscrowStore(): PlayerInventoryEscrowStore {
    if (!defaultStore) defaultStore = new PlayerInventoryEscrowStore('data/mods/player-inventory-escrow.sqlite');
    return defaultStore;
}
