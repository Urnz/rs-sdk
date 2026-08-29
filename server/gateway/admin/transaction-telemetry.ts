import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillEvent, SkillOperationName } from '../../../agent-skills/types';
import { skillRunsDir } from './paths';

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

interface JournalRun {
    runId: string;
    username: string | null;
    skillId: string;
    events: SkillEvent[];
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
    run: JournalRun,
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

export function extractEconomyEvents(run: JournalRun): EconomyEvent[] {
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

function parseRun(value: unknown): JournalRun | null {
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
} = {}): Promise<{ events: EconomyEvent[]; summary: EconomyEventSummary }> {
    const root = options.root ?? skillRunsDir;
    const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100) || 100));
    const files = (await readdir(root).catch(() => []))
        .filter(file => /^[0-9a-f-]{36}\.json$/i.test(file))
        .slice(0, 2_000);
    const runs = await Promise.all(files.map(async file => {
        try {
            const contents = await readFile(join(root, file), 'utf8');
            if (contents.length > 1_000_000) return null;
            return parseRun(JSON.parse(contents));
        } catch {
            return null;
        }
    }));
    const matching = runs.filter((run): run is JournalRun => !!run)
        .flatMap(extractEconomyEvents)
        .filter(event => !options.username || event.username === options.username.toLowerCase())
        .filter(event => !options.kind || event.kind === options.kind)
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return { events: matching.slice(0, limit), summary: summarizeEconomyEvents(matching) };
}
