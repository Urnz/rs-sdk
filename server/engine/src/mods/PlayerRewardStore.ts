import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type PlayerRewardStatus = 'pending' | 'committed' | 'rejected';

export interface PlayerRewardRecord {
    settlementId: string;
    username: string;
    amount: number;
    status: PlayerRewardStatus;
    coinsBefore: number | null;
    coinsAfter: number | null;
    createdAt: string;
    updatedAt: string;
    error: string | null;
}

export interface PlayerRewardWallet {
    balance(): number;
    credit(amount: number): number;
    remove(amount: number): number;
}

interface RewardRow {
    settlement_id: string;
    username: string;
    amount: number;
    status: PlayerRewardStatus;
    coins_before: number | null;
    coins_after: number | null;
    created_at: string;
    updated_at: string;
    error: string | null;
}

function record(row: RewardRow): PlayerRewardRecord {
    return { settlementId: row.settlement_id, username: row.username, amount: row.amount,
        status: row.status, coinsBefore: row.coins_before, coinsAfter: row.coins_after,
        createdAt: row.created_at, updatedAt: row.updated_at, error: row.error };
}

export class PlayerRewardStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS player_action_reward (
            settlement_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            amount INTEGER NOT NULL CHECK (amount > 0),
            status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'rejected')),
            coins_before INTEGER,
            coins_after INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            error TEXT)`);
    }

    close(): void {
        this.database.clearQueryCache();
        this.database.close(true);
    }

    get(settlementId: string): PlayerRewardRecord | null {
        const row = this.database.query(`SELECT * FROM player_action_reward
            WHERE settlement_id = ?1`).get(settlementId) as RewardRow | null;
        return row ? record(row) : null;
    }

    credit(settlementId: string, usernameInput: string, amount: number, wallet: PlayerRewardWallet,
        now = new Date().toISOString()): PlayerRewardRecord {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(settlementId)) {
            throw new Error('Player reward settlement id must be a UUID');
        }
        const username = usernameInput.trim().toLowerCase();
        if (!/^[a-z0-9]{1,12}$/.test(username)) throw new Error('Player reward username is invalid');
        if (!Number.isSafeInteger(amount) || amount < 1 || amount > 2_147_483_647) {
            throw new Error('Player reward amount is invalid');
        }
        const existing = this.get(settlementId);
        if (existing) {
            if (existing.username !== username || existing.amount !== amount) {
                throw new Error('Player reward settlement id was reused for a different payment');
            }
            if (existing.status === 'committed') return existing;
            if (existing.status === 'pending') {
                throw new Error('Player reward settlement is pending; manual reconciliation is required');
            }
        }
        const before = wallet.balance();
        if (!Number.isSafeInteger(before) || before < 0 || before > 2_147_483_647 - amount) {
            throw new Error('Player reward would overflow the coin balance');
        }
        if (existing) {
            if (existing.coinsBefore !== before) {
                throw new Error('Rejected player reward balance changed; manual reconciliation is required');
            }
            this.database.run(`UPDATE player_action_reward SET status = 'pending', coins_after = NULL,
                updated_at = ?2, error = NULL WHERE settlement_id = ?1 AND status = 'rejected'`,
            [settlementId, now]);
        } else {
            this.database.run(`INSERT INTO player_action_reward
                (settlement_id, username, amount, status, coins_before, coins_after, created_at, updated_at, error)
                VALUES (?1, ?2, ?3, 'pending', ?4, NULL, ?5, ?5, NULL)`,
            [settlementId, username, amount, before, now]);
        }
        try {
            const credited = wallet.credit(amount);
            if (credited !== amount || wallet.balance() !== before + amount) {
                if (credited > 0 && wallet.remove(credited) !== credited) {
                    throw new Error('Partial player reward could not be compensated');
                }
                throw new Error('Player reward inventory credit was incomplete');
            }
            this.database.run(`UPDATE player_action_reward SET status = 'committed', coins_after = ?2,
                updated_at = ?3 WHERE settlement_id = ?1 AND status = 'pending'`,
            [settlementId, before + amount, now]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.database.run(`UPDATE player_action_reward SET status = 'rejected', error = ?2,
                updated_at = ?3 WHERE settlement_id = ?1 AND status = 'pending'`,
            [settlementId, message.slice(0, 500), now]);
            throw error;
        }
        return this.get(settlementId)!;
    }
}

let defaultStore: PlayerRewardStore | null = null;

export function getPlayerRewardStore(): PlayerRewardStore {
    if (!defaultStore) defaultStore = new PlayerRewardStore('data/mods/player-action-rewards.sqlite');
    return defaultStore;
}
