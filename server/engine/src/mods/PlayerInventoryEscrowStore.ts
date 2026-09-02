import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

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

interface EscrowRow {
    escrow_id: string; username: string; assets_json: string; status: StoredPlayerEscrowStatus;
    balances_before_json: string; payee_username: string | null; payee_balances_before_json: string | null;
    commit_started_at: string | null; committed_at: string | null;
    created_at: string; updated_at: string; error: string | null;
}

const MAX_STACK = 2_147_483_647;

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

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
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
    }

    private addColumn(table: string, column: string, declaration: string): void {
        const columns = this.database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some(entry => entry.name === column)) {
            this.database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
        }
    }

    close(): void { this.database.clearQueryCache(); this.database.close(true); }

    get(escrowId: string): PlayerInventoryEscrowRecord | null {
        const row = this.database.query(`SELECT * FROM player_inventory_escrow
            WHERE escrow_id = ?1`).get(escrowId) as EscrowRow | null;
        return row ? escrow(row) : null;
    }

    list(limit = 100): PlayerInventoryEscrowRecord[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Player escrow list limit must be between 1 and 1000');
        }
        return (this.database.query(`SELECT * FROM player_inventory_escrow
            ORDER BY updated_at DESC, escrow_id DESC LIMIT ?1`).all(limit) as EscrowRow[]).map(escrow);
    }

    hold(escrowIdInput: string, usernameInput: string, assetsInput: PlayerEscrowAssets,
        wallet: PlayerInventoryEscrowWallet, now = new Date().toISOString()): PlayerInventoryEscrowRecord {
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
}

let defaultStore: PlayerInventoryEscrowStore | null = null;

export function getPlayerInventoryEscrowStore(): PlayerInventoryEscrowStore {
    if (!defaultStore) defaultStore = new PlayerInventoryEscrowStore('data/mods/player-inventory-escrow.sqlite');
    return defaultStore;
}
