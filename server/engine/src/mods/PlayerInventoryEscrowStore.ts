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

export type PlayerEscrowStatus = 'pending' | 'held' | 'releasing' | 'released' | 'rejected' | 'reconcile';

export interface PlayerInventoryEscrowRecord {
    escrowId: string;
    username: string;
    assets: PlayerEscrowAssets;
    status: PlayerEscrowStatus;
    balancesBefore: PlayerEscrowItem[];
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
    escrow_id: string; username: string; assets_json: string; status: PlayerEscrowStatus;
    balances_before_json: string; created_at: string; updated_at: string; error: string | null;
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
        assets: JSON.parse(row.assets_json) as PlayerEscrowAssets, status: row.status,
        balancesBefore: JSON.parse(row.balances_before_json) as PlayerEscrowItem[],
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
            balances_before_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`);
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
            if (existing.status === 'held' || existing.status === 'released' || existing.status === 'rejected') return existing;
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
}
