import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { SkillEvent, SkillOperationName } from '../../../agent-skills/types';
import { economyEventsDbPath, skillRunsDir } from './paths';

export type EconomyEventKind = 'production' | 'consumption' | 'shop-buy' | 'shop-sell' | 'player-trade' | 'bank-transfer';

export interface EconomyEventItem {
    id: number | null;
    name: string;
    quantity: number;
}

export interface EconomyEvent {
    id: string;
    timestamp: string;
    runId: string;
    username: string | null;
    skillId: string;
    stepId: string | null;
    kind: EconomyEventKind;
    itemsIn: EconomyEventItem[];
    itemsOut: EconomyEventItem[];
    coinsDelta: number;
    counterparty: string | null;
    partial: boolean;
}

export interface EconomyEventSummary {
    producedItems: number;
    consumedItems: number;
    shopTransactions: number;
    playerTrades: number;
    netCoins: number;
}

interface InventoryDelta {
    id: number;
    name: string;
    delta: number;
}

export interface EconomyJournalRun {
    runId: string;
    username: string | null;
    skillId: string;
    events: SkillEvent[];
}

interface EconomyEventRow {
    event_id: string;
    timestamp: string;
    run_id: string;
    username: string | null;
    skill_id: string;
    step_id: string | null;
    kind: EconomyEventKind;
    items_in_json: string;
    items_out_json: string;
    coins_delta: number;
    counterparty: string | null;
    partial: number;
    sequence: number;
}

const economicOperations = new Set<SkillOperationName>([
    'gather-loc', 'gather-npc', 'smith-at-anvil', 'buy-from-shop', 'sell-to-shop',
    'trade-give-item', 'deposit-item', 'withdraw-item'
]);

function finiteInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function inventoryDeltas(data: Record<string, unknown>): InventoryDelta[] {
    if (!Array.isArray(data.inventoryDelta)) return [];
    return data.inventoryDelta.flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const id = finiteInteger(item.id);
        const delta = finiteInteger(item.delta);
        if (id === null || delta === null || delta === 0 || typeof item.name !== 'string') return [];
        return [{ id, name: item.name, delta }];
    });
}

function tradeItems(value: unknown): EconomyEventItem[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const quantity = finiteInteger(item.count ?? item.amount);
        if (quantity === null || quantity <= 0 || typeof item.name !== 'string') return [];
        const id = finiteInteger(item.id);
        return id === 995 ? [] : [{ id, name: item.name, quantity }];
    });
}

function changedItems(deltas: InventoryDelta[], sign: 1 | -1): EconomyEventItem[] {
    return deltas.filter(item => item.id !== 995 && Math.sign(item.delta) === sign)
        .map(item => ({ id: item.id, name: item.name, quantity: Math.abs(item.delta) }));
}

function eventFor(
    run: EconomyJournalRun,
    event: SkillEvent,
    ordinal: number,
    kind: EconomyEventKind,
    itemsIn: EconomyEventItem[],
    itemsOut: EconomyEventItem[],
    coinsDelta: number,
    counterparty: string | null,
    partial: boolean
): EconomyEvent {
    return {
        id: `${run.runId}:${ordinal}:${kind}`,
        timestamp: event.timestamp,
        runId: run.runId,
        username: run.username,
        skillId: run.skillId,
        stepId: event.stepId ?? null,
        kind,
        itemsIn,
        itemsOut,
        coinsDelta,
        counterparty,
        partial
    };
}

export function extractEconomyEvents(run: EconomyJournalRun): EconomyEvent[] {
    const result: EconomyEvent[] = [];
    run.events.forEach((event, ordinal) => {
        if ((event.type !== 'step.succeeded' && event.type !== 'step.failed')
            || typeof event.timestamp !== 'string' || !event.operation || !economicOperations.has(event.operation)
            || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
        const data = event.data;
        const deltas = inventoryDeltas(data);
        const coinsDelta = deltas.find(item => item.id === 995)?.delta ?? 0;
        const incoming = changedItems(deltas, 1);
        const outgoing = changedItems(deltas, -1);
        const partial = data.partial === true || event.type === 'step.failed';

        if (event.operation === 'gather-loc' || event.operation === 'gather-npc') {
            if (incoming.length) result.push(eventFor(run, event, ordinal, 'production', incoming, [], coinsDelta, null, partial));
            return;
        }
        if (event.operation === 'smith-at-anvil') {
            if (incoming.length) result.push(eventFor(run, event, ordinal, 'production', incoming, [], coinsDelta, null, partial));
            if (outgoing.length) result.push(eventFor(run, event, ordinal, 'consumption', [], outgoing, coinsDelta, null, partial));
            return;
        }
        if (event.operation === 'buy-from-shop' || event.operation === 'sell-to-shop') {
            const kind = event.operation === 'buy-from-shop' ? 'shop-buy' : 'shop-sell';
            const amount = finiteInteger(data[event.operation === 'buy-from-shop' ? 'amountBought' : 'amountSold']) ?? 0;
            const fallbackName = typeof data.item === 'string' ? data.item : 'Ismeretlen tárgy';
            const itemsIn = kind === 'shop-buy' && !incoming.length && amount > 0 ? [{ id: null, name: fallbackName, quantity: amount }] : incoming;
            const itemsOut = kind === 'shop-sell' && !outgoing.length && amount > 0 ? [{ id: null, name: fallbackName, quantity: amount }] : outgoing;
            if (itemsIn.length || itemsOut.length || coinsDelta !== 0 || amount > 0) {
                result.push(eventFor(run, event, ordinal, kind, itemsIn, itemsOut, coinsDelta, null, partial));
            }
            return;
        }
        if (event.operation === 'trade-give-item') {
            const gave = tradeItems(data.gave);
            const received = tradeItems(data.received);
            if (gave.length || received.length) result.push(eventFor(
                run, event, ordinal, 'player-trade', received, gave, coinsDelta,
                typeof data.partner === 'string' ? data.partner : null, partial
            ));
            return;
        }
        if (incoming.length || outgoing.length || coinsDelta !== 0) {
            result.push(eventFor(run, event, ordinal, 'bank-transfer', incoming, outgoing, coinsDelta, null, partial));
        }
    });
    return result;
}

export function parseEconomyJournalRun(value: unknown): EconomyJournalRun | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const skill = raw.skill as Record<string, unknown> | undefined;
    if (typeof raw.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.runId)
        || !skill || typeof skill.id !== 'string' || !Array.isArray(raw.events)) return null;
    const username = typeof raw.username === 'string' && /^[a-zA-Z0-9 _-]{1,12}$/.test(raw.username)
        ? raw.username.toLowerCase() : null;
    const events = raw.events.filter(event => !!event && typeof event === 'object') as SkillEvent[];
    return { runId: raw.runId, username, skillId: skill.id, events };
}

function eventFromRow(row: EconomyEventRow): EconomyEvent {
    return { id: row.event_id, timestamp: row.timestamp, runId: row.run_id,
        username: row.username, skillId: row.skill_id, stepId: row.step_id, kind: row.kind,
        itemsIn: JSON.parse(row.items_in_json) as EconomyEventItem[],
        itemsOut: JSON.parse(row.items_out_json) as EconomyEventItem[], coinsDelta: row.coins_delta,
        counterparty: row.counterparty, partial: row.partial === 1 };
}

function digestRun(run: EconomyJournalRun): string {
    return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, ...run })).digest('hex');
}

export class EconomyEventStore {
    private readonly database: Database;

    constructor(path = economyEventsDbPath) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS economy_run_ingestion (
            run_id TEXT PRIMARY KEY, digest TEXT NOT NULL, username TEXT, skill_id TEXT NOT NULL,
            event_count INTEGER NOT NULL CHECK (event_count >= 0), ingested_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economy_event (
            event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES economy_run_ingestion(run_id),
            timestamp TEXT NOT NULL, username TEXT, skill_id TEXT NOT NULL, step_id TEXT,
            kind TEXT NOT NULL CHECK (kind IN ('production', 'consumption', 'shop-buy', 'shop-sell',
                'player-trade', 'bank-transfer')), items_in_json TEXT NOT NULL, items_out_json TEXT NOT NULL,
            coins_delta INTEGER NOT NULL, counterparty TEXT, partial INTEGER NOT NULL CHECK (partial IN (0, 1)),
            sequence INTEGER NOT NULL)`);
        const columns = this.database.query('PRAGMA table_info(economy_event)').all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === 'sequence')) {
            this.database.run('ALTER TABLE economy_event ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
        }
        this.database.run('CREATE INDEX IF NOT EXISTS economy_event_time ON economy_event(timestamp DESC, event_id)');
        this.database.run('CREATE INDEX IF NOT EXISTS economy_event_actor ON economy_event(username, timestamp DESC)');
        this.database.run('CREATE INDEX IF NOT EXISTS economy_event_kind ON economy_event(kind, timestamp DESC)');
    }

    close(): void { this.database.close(true); }

    ingest(run: EconomyJournalRun, now = new Date().toISOString()): { created: boolean; eventCount: number } {
        const normalized = parseEconomyJournalRun({ runId: run.runId, username: run.username,
            skill: { id: run.skillId }, events: run.events });
        if (!normalized) throw new Error('Economy journal run is invalid');
        if (Number.isNaN(Date.parse(now))) throw new Error('Economy ingestion timestamp is invalid');
        const digest = digestRun(normalized);
        const existing = this.database.query('SELECT digest, event_count FROM economy_run_ingestion WHERE run_id = ?1')
            .get(normalized.runId) as { digest: string; event_count: number } | null;
        if (existing) {
            if (existing.digest !== digest) throw new Error('Economy journal run changed after ingestion');
            return { created: false, eventCount: existing.event_count };
        }
        const events = extractEconomyEvents(normalized);
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO economy_run_ingestion
                (run_id, digest, username, skill_id, event_count, ingested_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)`, [normalized.runId, digest, normalized.username,
                normalized.skillId, events.length, new Date(now).toISOString()]);
            events.forEach((event, sequence) => this.database.run(`INSERT INTO economy_event
                (event_id, run_id, timestamp, username, skill_id, step_id, kind, items_in_json,
                    items_out_json, coins_delta, counterparty, partial, sequence)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`, [event.id,
                event.runId, event.timestamp, event.username, event.skillId, event.stepId, event.kind,
                JSON.stringify(event.itemsIn), JSON.stringify(event.itemsOut), event.coinsDelta,
                event.counterparty, event.partial ? 1 : 0, sequence]));
        });
        try {
            transaction.immediate();
        } catch (error) {
            const raced = this.database.query(`SELECT digest, event_count FROM economy_run_ingestion
                WHERE run_id = ?1`).get(normalized.runId) as { digest: string; event_count: number } | null;
            if (raced?.digest === digest) return { created: false, eventCount: raced.event_count };
            if (raced) throw new Error('Economy journal run changed after ingestion');
            throw error;
        }
        return { created: true, eventCount: events.length };
    }

    query(options: { limit?: number; username?: string; kind?: EconomyEventKind } = {}):
        { events: EconomyEvent[]; summary: EconomyEventSummary } {
        const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100) || 100));
        const username = options.username?.trim().toLowerCase() || null;
        const kind = options.kind ?? null;
        const rows = this.database.query(`SELECT * FROM economy_event
            WHERE (?1 IS NULL OR username = ?1) AND (?2 IS NULL OR kind = ?2)
            ORDER BY timestamp DESC, sequence, event_id LIMIT 50000`).all(username, kind) as EconomyEventRow[];
        const events = rows.map(eventFromRow);
        return { events: events.slice(0, limit), summary: summarizeEconomyEvents(events) };
    }

    replay(runId: string): { events: EconomyEvent[]; summary: EconomyEventSummary } {
        if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Economy replay run id is invalid');
        const events = (this.database.query(`SELECT * FROM economy_event WHERE run_id = ?1
            ORDER BY sequence, event_id`).all(runId) as EconomyEventRow[]).map(eventFromRow);
        const known = this.database.query('SELECT 1 FROM economy_run_ingestion WHERE run_id = ?1').get(runId);
        if (!known) throw new Error('Economy journal run was not ingested');
        return { events, summary: summarizeEconomyEvents(events) };
    }
}

export function summarizeEconomyEvents(events: EconomyEvent[]): EconomyEventSummary {
    return events.reduce((summary, event) => {
        if (event.kind === 'production') summary.producedItems += event.itemsIn.reduce((total, item) => total + item.quantity, 0);
        if (event.kind === 'consumption') summary.consumedItems += event.itemsOut.reduce((total, item) => total + item.quantity, 0);
        if (event.kind === 'shop-buy' || event.kind === 'shop-sell') summary.shopTransactions++;
        if (event.kind === 'player-trade') summary.playerTrades++;
        summary.netCoins += event.coinsDelta;
        return summary;
    }, { producedItems: 0, consumedItems: 0, shopTransactions: 0, playerTrades: 0, netCoins: 0 });
}

export async function readEconomyEvents(options: {
    limit?: number;
    username?: string;
    kind?: EconomyEventKind;
    root?: string;
    ledgerPath?: string;
} = {}): Promise<{ events: EconomyEvent[]; summary: EconomyEventSummary;
    ingestion: { createdRuns: number; replayedRuns: number; rejectedRuns: number } }> {
    const root = options.root ?? skillRunsDir;
    const ledgerPath = options.ledgerPath ?? (options.root ? join(root, 'economy-events.sqlite') : economyEventsDbPath);
    const files = (await readdir(root).catch(() => []))
        .filter(file => /^[0-9a-f-]{36}\.json$/i.test(file))
        .slice(0, 2_000);
    const runs = await Promise.all(files.map(async file => {
        try {
            const contents = await readFile(join(root, file), 'utf8');
            if (contents.length > 1_000_000) return null;
            return parseEconomyJournalRun(JSON.parse(contents));
        } catch {
            return null;
        }
    }));
    const ledger = new EconomyEventStore(ledgerPath);
    let createdRuns = 0, replayedRuns = 0, rejectedRuns = 0;
    try {
        for (const run of runs) {
            if (!run) continue;
            try {
                const result = ledger.ingest(run);
                result.created ? createdRuns++ : replayedRuns++;
            } catch { rejectedRuns++; }
        }
        return { ...ledger.query(options), ingestion: { createdRuns, replayedRuns, rejectedRuns } };
    } finally { ledger.close(); }
}
