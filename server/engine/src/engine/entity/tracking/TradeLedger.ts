import fs from 'fs';
import path from 'path';

import { WealthEventItem } from '#/engine/entity/tracking/WealthEvent.js';
import { getTradeEvidenceStore } from '#/mods/TradeEvidenceStore.js';

// Append-only JSONL ledger of completed player<->player trades, written at the
// moment the engine executes the exchange (BOTH_MOVEINV from the trade-confirm
// script). One line per completed trade, both sides included - the single
// authoritative record of who traded what with whom, independent of any
// client/SDK session surviving to report it.
//
// Off by default: set TRADE_LEDGER_FILE to enable. The RuneBench images point
// it at /logs/tracking/trade_ledger.jsonl so the benchmark's market watcher
// can fold it into its tracking data.
const LEDGER_FILE = process.env.TRADE_LEDGER_FILE || '';

export type TradeLedgerEntry = {
    ts: string;
    tick: number;
    /** login username (not display name) of the side whose offer this event moved */
    from: string;
    to: string;
    fromItems: WealthEventItem[];
    toItems: WealthEventItem[];
    /** ObjType.cost totals of each side's items */
    fromValue: number;
    toValue: number;
};

let dirReady = false;
let warned = false;

export function recordTrade(entry: Omit<TradeLedgerEntry, 'ts'>): void {
    const committedAt = new Date().toISOString();
    // This SQLite evidence is authoritative for Phase 22.5. JSONL below remains
    // optional benchmark telemetry and must never be treated as trade authority.
    getTradeEvidenceStore().record({ tick:entry.tick,fromUsername:entry.from,toUsername:entry.to,
        fromItems:entry.fromItems,toItems:entry.toItems,fromValue:entry.fromValue,toValue:entry.toValue,committedAt });
    if (!LEDGER_FILE) {
        return;
    }
    try {
        if (!dirReady) {
            const dir = path.dirname(LEDGER_FILE);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            dirReady = true;
        }
        fs.appendFileSync(LEDGER_FILE, JSON.stringify({ ts: committedAt, ...entry }) + '\n');
    } catch (err) {
        if (!warned) {
            warned = true;
            console.error(`[trade-ledger] append to ${LEDGER_FILE} failed:`, err);
        }
    }
}
