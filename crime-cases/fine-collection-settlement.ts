import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { EnginePlayerEscrowResult } from '../server/gateway/admin/player-escrow.js';
import type { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import type { FineCollectionIntentStore, RecordedFineCollectionIntent } from './fine-collection-intent-store.js';
import { fineLedgerIds } from './fine-ledger-reconciliation.js';

export type FineSettlementPhase = 'planned' | 'held' | 'credited' | 'settled';
export interface FineSettlementPlan extends RecordedFineCollectionIntent {
    escrowId: string;
    settlementId: string;
    planDigest: string;
}
export interface FineSettlementState {
    plan: FineSettlementPlan;
    phase: FineSettlementPhase;
    lastError: string | null;
}

type PlanRow = { collection_id: string; decision_id: string; decision_digest: string; amount_gp: number;
    payer_username: string; creditor_faction_id: string; treasury_actor_id: string; intent_digest: string;
    recorded_at: string; escrow_id: string; settlement_id: string; plan_digest: string };
type EventRow = { sequence: number; collection_id: string; phase: FineSettlementPhase | 'failed';
    detail: string | null; occurred_at: string; previous_hash: string; entry_hash: string };

const ZERO = '0'.repeat(64);
const VERIFIED_INTENT = Symbol('verified-fine-collection-intent');
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function facts(intent: RecordedFineCollectionIntent) {
    const ids = fineLedgerIds(intent.collectionId);
    return { collectionId: intent.collectionId, decisionId: intent.decisionId,
        decisionDigest: intent.decisionDigest, amountGp: intent.amountGp,
        payerUsername: intent.payerUsername, creditorFactionId: intent.creditorFactionId,
        treasuryActorId: intent.treasuryActorId, intentDigest: intent.intentDigest,
        recordedAt: intent.recordedAt, ...ids };
}
function plan(row: PlanRow): FineSettlementPlan {
    return { collectionId: row.collection_id, decisionId: row.decision_id, decisionDigest: row.decision_digest,
        amountGp: row.amount_gp, payerUsername: row.payer_username,
        creditorFactionId: row.creditor_faction_id, treasuryActorId: row.treasury_actor_id,
        intentDigest: row.intent_digest, recordedAt: row.recorded_at,
        escrowId: row.escrow_id, settlementId: row.settlement_id, planDigest: row.plan_digest };
}

/** Durable coordinator journal. It records facts and phases but never creates legal authority. */
export class FineCollectionSettlementStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS fine_collection_settlement(
            collection_id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,decision_digest TEXT NOT NULL,
            amount_gp INTEGER NOT NULL CHECK(amount_gp BETWEEN 1 AND 2147483647),payer_username TEXT NOT NULL,
            creditor_faction_id TEXT NOT NULL,treasury_actor_id TEXT NOT NULL,intent_digest TEXT NOT NULL,
            recorded_at TEXT NOT NULL,escrow_id TEXT NOT NULL UNIQUE,settlement_id TEXT NOT NULL UNIQUE,
            plan_digest TEXT NOT NULL UNIQUE)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS fine_collection_settlement_event(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,collection_id TEXT NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('planned','held','credited','settled','failed')),
            detail TEXT,occurred_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
            FOREIGN KEY(collection_id) REFERENCES fine_collection_settlement(collection_id))`);
    }
    close(): void { this.database.close(true); }

    /** @internal Only planFineCollection owns the unexported authority token. */
    begin(intent: RecordedFineCollectionIntent, authority: symbol,
        now = new Date().toISOString()): FineSettlementState {
        if (authority !== VERIFIED_INTENT) throw new Error('Fine settlement requires a verified intent authority');
        if (Number.isNaN(Date.parse(now))) throw new Error('Fine settlement timestamp is invalid');
        const expected = facts(intent), planDigest = hash(expected);
        const current = this.get(intent.collectionId);
        if (current) {
            if (current.plan.planDigest !== planDigest) throw new Error('Fine settlement intent changed after planning');
            return current;
        }
        this.database.transaction(() => {
            this.database.run(`INSERT INTO fine_collection_settlement VALUES(
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`, [intent.collectionId, intent.decisionId,
                intent.decisionDigest, intent.amountGp, intent.payerUsername, intent.creditorFactionId,
                intent.treasuryActorId, intent.intentDigest, intent.recordedAt,
                expected.escrowId, expected.settlementId, planDigest]);
            this.append(intent.collectionId, 'planned', null, new Date(now).toISOString());
        }).immediate();
        return this.get(intent.collectionId)!;
    }

    get(collectionId: string): FineSettlementState | null {
        if (!this.verifyAuditChain()) throw new Error('Fine settlement audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_collection_settlement WHERE collection_id=?1')
            .get(collectionId) as PlanRow | null;
        if (!row) return null;
        const events = this.database.query(`SELECT * FROM fine_collection_settlement_event
            WHERE collection_id=?1 ORDER BY sequence`).all(collectionId) as EventRow[];
        const phases = events.filter(event => event.phase !== 'failed') as Array<EventRow & { phase: FineSettlementPhase }>;
        const lastFailure = [...events].reverse().find(event => event.phase === 'failed');
        return { plan: plan(row), phase: phases.at(-1)!.phase,
            lastError: lastFailure && lastFailure.sequence > phases.at(-1)!.sequence ? lastFailure.detail : null };
    }

    listPending(limit = 100): FineSettlementState[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Fine settlement limit is invalid');
        const ids = this.database.query('SELECT collection_id FROM fine_collection_settlement ORDER BY rowid LIMIT ?1')
            .all(limit) as Array<{ collection_id: string }>;
        return ids.map(row => this.get(row.collection_id)!).filter(value => value.phase !== 'settled');
    }

    advance(collectionId: string, expected: FineSettlementPhase, next: FineSettlementPhase,
        now = new Date().toISOString()): FineSettlementState {
        const current = this.get(collectionId);
        if (!current) throw new Error('Fine settlement plan is absent');
        const order: FineSettlementPhase[] = ['planned', 'held', 'credited', 'settled'];
        if (order.indexOf(current.phase) >= order.indexOf(next)) return current;
        if (current.phase !== expected || order.indexOf(next) !== order.indexOf(expected) + 1)
            throw new Error('Fine settlement phase transition is invalid');
        this.append(collectionId, next, null, new Date(now).toISOString());
        return this.get(collectionId)!;
    }

    fail(collectionId: string, message: string, now = new Date().toISOString()): void {
        if (!this.get(collectionId)) throw new Error('Fine settlement plan is absent');
        this.append(collectionId, 'failed', message.slice(0, 500), new Date(now).toISOString());
    }

    verifyAuditChain(): boolean {
        try {
            const plans = this.database.query('SELECT * FROM fine_collection_settlement').all() as PlanRow[];
            const byId = new Map(plans.map(row => [row.collection_id, row]));
            const events = this.database.query('SELECT * FROM fine_collection_settlement_event ORDER BY sequence')
                .all() as EventRow[];
            if (plans.some(row => row.plan_digest !== hash(facts(plan(row))))) return false;
            let previous = ZERO;
            const lastPhase = new Map<string, FineSettlementPhase>();
            const order: FineSettlementPhase[] = ['planned', 'held', 'credited', 'settled'];
            for (const event of events) {
                if (!byId.has(event.collection_id) || event.previous_hash !== previous) return false;
                const payload = { collectionId: event.collection_id, phase: event.phase,
                    detail: event.detail, occurredAt: event.occurred_at };
                if (event.entry_hash !== hash({ previous, payload })) return false;
                if (event.phase !== 'failed') {
                    const prior = lastPhase.get(event.collection_id);
                    if ((!prior && event.phase !== 'planned')
                        || (prior && order.indexOf(event.phase) !== order.indexOf(prior) + 1)) return false;
                    lastPhase.set(event.collection_id, event.phase);
                }
                previous = event.entry_hash;
            }
            return plans.length === lastPhase.size;
        } catch { return false; }
    }

    private append(collectionId: string, phase: FineSettlementPhase | 'failed', detail: string | null,
        occurredAt: string): void {
        const previous = (this.database.query(`SELECT entry_hash FROM fine_collection_settlement_event
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        const payload = { collectionId, phase, detail, occurredAt };
        this.database.run(`INSERT INTO fine_collection_settlement_event
            (collection_id,phase,detail,occurred_at,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5,?6)`,
        [collectionId, phase, detail, occurredAt, previous, hash({ previous, payload })]);
    }
}

type Escrower = (request: { escrowId: string; operation: 'hold' | 'consume'; username: string;
    assets?: { gp: number; items: [] } }, commandId?: string) => Promise<EnginePlayerEscrowResult>;
export interface FineSettlementExecution {
    journal: FineCollectionSettlementStore;
    treasury: InstitutionTreasuryStore;
    escrower: Escrower;
    now?: () => string;
    afterExternalStep?: (step: 'hold' | 'credit' | 'consume') => void;
}

function commandId(plan: FineSettlementPlan, operation: 'hold' | 'consume'): string {
    const bytes = Buffer.from(createHash('sha256').update(`fine-command/v1/${operation}\0${plan.collectionId}`)
        .digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const value = bytes.toString('hex');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function validateEscrow(receipt: EnginePlayerEscrowResult, value: FineSettlementPlan,
    operation: 'hold' | 'consume'): void {
    const expected = operation === 'hold' ? 'held' : 'committed';
    if (!receipt.ok || receipt.escrowId !== value.escrowId || receipt.operation !== operation
        || receipt.username.trim().toLowerCase() !== value.payerUsername || receipt.escrow?.status !== expected
        || receipt.escrow.assets.gp !== value.amountGp || receipt.escrow.assets.items.length !== 0
        || receipt.escrow.payeeUsername !== null) throw new Error('Engine returned a mismatched fine escrow receipt');
}

export async function settleFineCollection(collectionId: string, execution: FineSettlementExecution): Promise<FineSettlementState> {
    let current = execution.journal.get(collectionId);
    if (!current) throw new Error('Fine settlement plan is absent');
    const now = execution.now ?? (() => new Date().toISOString());
    try {
        if (current.phase === 'planned') {
            const receipt = await execution.escrower({ escrowId: current.plan.escrowId, operation: 'hold',
                username: current.plan.payerUsername, assets: { gp: current.plan.amountGp, items: [] } },
            commandId(current.plan, 'hold'));
            validateEscrow(receipt, current.plan, 'hold');
            execution.afterExternalStep?.('hold');
            current = execution.journal.advance(collectionId, 'planned', 'held', now());
        }
        if (current.phase === 'held') {
            const occurredAt = now();
            execution.treasury.creditExternalSettlement({ settlementId: current.plan.settlementId, kind: 'faction',
                actorId: current.plan.treasuryActorId, amountGp: current.plan.amountGp,
                sourceRef: current.plan.collectionId, status: 'committed', occurredAt }, evidence => {
                const proof = execution.journal.get(collectionId);
                return proof?.phase === 'held' && proof.plan.settlementId === evidence.settlementId
                    && proof.plan.treasuryActorId === evidence.actorId && proof.plan.amountGp === evidence.amountGp
                    && proof.plan.collectionId === evidence.sourceRef;
            }, occurredAt);
            execution.afterExternalStep?.('credit');
            current = execution.journal.advance(collectionId, 'held', 'credited', now());
        }
        if (current.phase === 'credited') {
            const receipt = await execution.escrower({ escrowId: current.plan.escrowId, operation: 'consume',
                username: current.plan.payerUsername }, commandId(current.plan, 'consume'));
            validateEscrow(receipt, current.plan, 'consume');
            execution.afterExternalStep?.('consume');
            current = execution.journal.advance(collectionId, 'credited', 'settled', now());
        }
        return current;
    } catch (error) {
        execution.journal.fail(collectionId, error instanceof Error ? error.message : String(error), now());
        throw error;
    }
}

/** Freeze a verified intent into the execution journal; later recovery never re-decides the fine. */
export function planFineCollection(collectionId: string, intents: Pick<FineCollectionIntentStore,
    'verifyAuditChain' | 'get'>, journal: FineCollectionSettlementStore, now?: string): FineSettlementState {
    if (!intents.verifyAuditChain()) throw new Error('Fine collection intent audit chain is invalid');
    const intent = intents.get(collectionId);
    if (!intent || intent.collectionId !== collectionId) throw new Error('Fine collection intent is absent');
    return journal.begin(structuredClone(intent), VERIFIED_INTENT, now);
}

export async function recoverFineCollections(execution: FineSettlementExecution): Promise<{
    attempted: string[]; settled: string[]; errors: Array<{ collectionId: string; message: string }> }> {
    const result: { attempted: string[]; settled: string[];
        errors: Array<{ collectionId: string; message: string }> } = { attempted: [], settled: [], errors: [] };
    for (const state of execution.journal.listPending(100)) {
        result.attempted.push(state.plan.collectionId);
        try {
            const settled = await settleFineCollection(state.plan.collectionId, execution);
            if (settled.phase === 'settled') result.settled.push(state.plan.collectionId);
        } catch (error) { result.errors.push({ collectionId: state.plan.collectionId,
            message: (error instanceof Error ? error.message : String(error)).slice(0, 500) }); }
    }
    return result;
}
