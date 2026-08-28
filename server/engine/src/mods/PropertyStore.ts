import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { validateEconomicActorRef, type EconomicActorRef } from './EconomicActors.js';
import type { PropertyCatalog, PropertyStateEntry, PropertyStatus } from './Properties.js';

export type PropertyPurchaseStatus = 'pending' | 'committed' | 'rejected' | 'compensated';

export interface PropertyPurchaseRequest {
    transactionId: string;
    propertyId: string;
    buyer: EconomicActorRef;
}

export interface PropertyPurchaseRecord extends PropertyPurchaseRequest {
    amount: number;
    status: PropertyPurchaseStatus;
    createdAt: string;
    updatedAt: string;
    error: string | null;
}

export interface PropertyWallet {
    /** Debit must be idempotent for the supplied transaction id. */
    debit(owner: EconomicActorRef, amount: number, transactionId: string): void;
    /** Refund must be idempotent for the supplied transaction id. */
    refund(owner: EconomicActorRef, amount: number, transactionId: string): void;
}

interface PropertyRow {
    property_id: string;
    status: PropertyStatus;
    owner_kind: EconomicActorRef['kind'] | null;
    owner_id: string | null;
    acquired_at: string | null;
    updated_at: string;
    version: number;
}

interface PurchaseRow {
    transaction_id: string;
    property_id: string;
    buyer_kind: EconomicActorRef['kind'];
    buyer_id: string;
    amount: number;
    status: PropertyPurchaseStatus;
    created_at: string;
    updated_at: string;
    error: string | null;
}

function purchaseRecord(row: PurchaseRow): PropertyPurchaseRecord {
    return {
        transactionId: row.transaction_id,
        propertyId: row.property_id,
        buyer: { kind: row.buyer_kind, id: row.buyer_id },
        amount: row.amount,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        error: row.error
    };
}

function propertyStateEntry(row: PropertyRow): PropertyStateEntry {
    return {
        propertyId: row.property_id,
        status: row.status,
        owner: row.owner_kind && row.owner_id ? { kind: row.owner_kind, id: row.owner_id } : null,
        acquiredAt: row.acquired_at,
        updatedAt: row.updated_at,
        version: row.version
    };
}

function sameRequest(record: PropertyPurchaseRecord, request: PropertyPurchaseRequest): boolean {
    return record.propertyId === request.propertyId
        && record.buyer.kind === request.buyer.kind && record.buyer.id === request.buyer.id;
}

export class PropertyStore {
    private readonly database: Database;
    private readonly definitions;

    constructor(catalog: PropertyCatalog, path: string, now = new Date().toISOString()) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.definitions = new Map(catalog.properties.map(property => [property.propertyId, property]));
        try {
            this.database.run('PRAGMA foreign_keys = ON');
            this.database.run(`CREATE TABLE IF NOT EXISTS property_state (
            property_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('available', 'owned', 'locked', 'disabled')),
            owner_kind TEXT CHECK (owner_kind IS NULL OR owner_kind IN ('player', 'business', 'faction')),
            owner_id TEXT,
            acquired_at TEXT,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL CHECK (version >= 1),
            CHECK ((owner_kind IS NULL) = (owner_id IS NULL)),
            CHECK (status != 'owned' OR owner_id IS NOT NULL)
            )`);
            this.database.run(`CREATE TABLE IF NOT EXISTS property_purchase (
            transaction_id TEXT PRIMARY KEY,
            property_id TEXT NOT NULL REFERENCES property_state(property_id),
            buyer_kind TEXT NOT NULL CHECK (buyer_kind IN ('player', 'business', 'faction')),
            buyer_id TEXT NOT NULL,
            amount INTEGER NOT NULL CHECK (amount > 0),
            status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'rejected', 'compensated')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            error TEXT
            )`);
            this.synchronizeCatalog(now);
        } catch (error) {
            this.database.clearQueryCache();
            this.database.close(true);
            throw error;
        }
    }

    close(): void {
        this.database.clearQueryCache();
        this.database.close(true);
    }

    listProperties(): PropertyStateEntry[] {
        return (this.database.query('SELECT * FROM property_state ORDER BY property_id').all() as PropertyRow[])
            .map(propertyStateEntry);
    }

    getPurchase(transactionId: string): PropertyPurchaseRecord | null {
        const row = this.database.query('SELECT * FROM property_purchase WHERE transaction_id = ?1').get(transactionId);
        return row ? purchaseRecord(row as PurchaseRow) : null;
    }

    purchase(request: PropertyPurchaseRequest, wallet: PropertyWallet, now = new Date().toISOString()): PropertyPurchaseRecord {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/.test(request.transactionId)) {
            throw new Error('Property purchase requires a stable transaction id between 8 and 96 characters');
        }
        const buyer = validateEconomicActorRef(request.buyer, 'property buyer');
        const definition = this.definitions.get(request.propertyId);
        if (!definition) throw new Error(`Unknown property: ${request.propertyId}`);
        const normalizedRequest = { ...request, buyer };
        const existing = this.getPurchase(request.transactionId);
        if (existing) {
            if (!sameRequest(existing, normalizedRequest)) throw new Error('Transaction id was already used for another purchase');
            if (existing.status === 'committed') return existing;
            if (existing.status !== 'pending') throw new Error(`Property purchase already ended as ${existing.status}`);
        } else {
            this.reserve(normalizedRequest, definition.purchasePrice, now);
        }

        try {
            wallet.debit(buyer, definition.purchasePrice, request.transactionId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.reject(normalizedRequest, message, now);
            throw new Error(`Property purchase debit failed: ${message}`);
        }

        try {
            this.commit(normalizedRequest, now);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                wallet.refund(buyer, definition.purchasePrice, request.transactionId);
                this.compensate(normalizedRequest, message, now);
            } catch (compensationError) {
                throw new Error(`Property purchase is pending recovery: ${message}; compensation failed: ${String(compensationError)}`);
            }
            throw new Error(`Property purchase commit failed and was refunded: ${message}`);
        }
        return this.getPurchase(request.transactionId)!;
    }

    private synchronizeCatalog(now: string): void {
        const transaction = this.database.transaction(() => {
            const persisted = this.database.query('SELECT property_id FROM property_state').all() as Array<{ property_id: string }>;
            for (const row of persisted) {
                if (!this.definitions.has(row.property_id)) {
                    throw new Error(`Property catalog cannot remove persisted property: ${row.property_id}`);
                }
            }
            for (const propertyId of this.definitions.keys()) {
                this.database.run(`INSERT OR IGNORE INTO property_state
                    (property_id, status, owner_kind, owner_id, acquired_at, updated_at, version)
                    VALUES (?1, 'available', NULL, NULL, NULL, ?2, 1)`, [propertyId, now]);
            }
        });
        transaction.immediate();
    }

    private reserve(request: PropertyPurchaseRequest, amount: number, now: string): void {
        const transaction = this.database.transaction(() => {
            const result = this.database.run(`UPDATE property_state SET status = 'locked', updated_at = ?2,
                version = version + 1 WHERE property_id = ?1 AND status = 'available' AND owner_id IS NULL`,
            [request.propertyId, now]);
            if (result.changes !== 1) throw new Error('Property is not available for purchase');
            this.database.run(`INSERT INTO property_purchase
                (transaction_id, property_id, buyer_kind, buyer_id, amount, status, created_at, updated_at, error)
                VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6, NULL)`,
            [request.transactionId, request.propertyId, request.buyer.kind, request.buyer.id, amount, now]);
        });
        transaction.immediate();
    }

    private commit(request: PropertyPurchaseRequest, now: string): void {
        const transaction = this.database.transaction(() => {
            const state = this.database.run(`UPDATE property_state SET status = 'owned', owner_kind = ?2,
                owner_id = ?3, acquired_at = ?4, updated_at = ?4, version = version + 1
                WHERE property_id = ?1 AND status = 'locked' AND owner_id IS NULL`,
            [request.propertyId, request.buyer.kind, request.buyer.id, now]);
            const purchase = this.database.run(`UPDATE property_purchase SET status = 'committed', updated_at = ?2,
                error = NULL WHERE transaction_id = ?1 AND status = 'pending'`, [request.transactionId, now]);
            if (state.changes !== 1 || purchase.changes !== 1) throw new Error('Reserved property transaction changed before commit');
        });
        transaction.immediate();
    }

    private reject(request: PropertyPurchaseRequest, error: string, now: string): void {
        const transaction = this.database.transaction(() => {
            this.releaseProperty(request.propertyId, now);
            this.database.run(`UPDATE property_purchase SET status = 'rejected', updated_at = ?2, error = ?3
                WHERE transaction_id = ?1 AND status = 'pending'`, [request.transactionId, now, error]);
        });
        transaction.immediate();
    }

    private compensate(request: PropertyPurchaseRequest, error: string, now: string): void {
        const transaction = this.database.transaction(() => {
            this.releaseProperty(request.propertyId, now);
            this.database.run(`UPDATE property_purchase SET status = 'compensated', updated_at = ?2, error = ?3
                WHERE transaction_id = ?1 AND status = 'pending'`, [request.transactionId, now, error]);
        });
        transaction.immediate();
    }

    private releaseProperty(propertyId: string, now: string): void {
        const result = this.database.run(`UPDATE property_state SET status = 'available', updated_at = ?2,
            version = version + 1 WHERE property_id = ?1 AND status = 'locked' AND owner_id IS NULL`, [propertyId, now]);
        if (result.changes !== 1) throw new Error('Reserved property could not be released');
    }
}
