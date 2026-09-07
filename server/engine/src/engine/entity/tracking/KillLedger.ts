import fs from 'fs';
import path from 'path';

// Append-only JSONL ledger of NPC deaths credited to players, written at the
// NPC_DEL opcode (the single chokepoint every scripted death path funnels
// through) while the npc's heroPoints damage table is still intact. One line
// per death: the credited killer (highest damage — the same findHero() rule
// the engine uses to award loot) plus the full damage split, so team kills
// can be attributed and audited independently of any client/SDK session.
//
// Off by default: set KILL_LEDGER_FILE to enable. The RuneBench images point
// it at /logs/tracking/kill_ledger.jsonl so benchmark watchers/verifiers can
// count boss kills authoritatively.
const LEDGER_FILE = process.env.KILL_LEDGER_FILE || '';

export type KillLedgerEntry = {
    ts: string;
    tick: number;
    /** npc config id (e.g. 50 = king_dragon) */
    npcId: number;
    /** npc debugname when present, else display name */
    npcName: string | null;
    /** login username of the highest-damage player; null if no hero recorded */
    killer: string | null;
    /** full damage split, highest first */
    contributors: Array<{ username: string | null; damage: number }>;
    x: number;
    z: number;
    level: number;
};

let dirReady = false;
let warned = false;

export function recordKill(entry: Omit<KillLedgerEntry, 'ts'>): void {
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
        fs.appendFileSync(LEDGER_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    } catch (err) {
        if (!warned) {
            warned = true;
            console.error(`[kill-ledger] append to ${LEDGER_FILE} failed:`, err);
        }
    }
}
