import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { EnginePlayerCustodyRequest, EnginePlayerCustodyResult } from '../server/gateway/admin/player-custody.js';
import type { EnginePlayerEscrowRequest, EnginePlayerEscrowResult } from '../server/gateway/admin/player-escrow.js';
import type { JusticeDecisionStore, RecordedJusticeDecision } from './justice-decision-store.js';

export type JusticeExecutionPhase = 'planned' | 'held' | 'restricted' | 'settled';
export interface JusticeExecutionPlan extends RecordedJusticeDecision {
    escrowId: string;
    custodyId: string;
    custodyStartedAt: string;
    custodyReleaseAt: string;
    planDigest: string;
}
export interface JusticeExecutionState { plan: JusticeExecutionPlan; phase: JusticeExecutionPhase; lastError: string | null }

type PlanRow = { decision_json: string; escrow_id: string; custody_id: string; custody_started_at: string;
    custody_release_at: string; plan_digest: string };
type EventRow = { sequence: number; decision_id: string; phase: JusticeExecutionPhase | 'failed'; detail: string | null;
    occurred_at: string; previous_hash: string; entry_hash: string };
const ZERO = '0'.repeat(64), VERIFIED_DECISION = Symbol('verified-justice-decision');
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function uuid(namespace: string, id: string): string {
    const bytes = Buffer.from(createHash('sha256').update(`${namespace}\0${id}`).digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const value = bytes.toString('hex');
    return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
function planFacts(decision: RecordedJusticeDecision, plannedAt: string) {
    const custodyStartedAt = plannedAt;
    const custodyReleaseAt = new Date(Date.parse(plannedAt) + decision.custodySeconds * 1000).toISOString();
    return { decision: structuredClone(decision), escrowId: uuid('justice-escrow/v1', decision.decisionId),
        custodyId: uuid('justice-custody/v1', decision.decisionId), custodyStartedAt, custodyReleaseAt };
}
function rowPlan(row: PlanRow): JusticeExecutionPlan {
    const decision = JSON.parse(row.decision_json) as RecordedJusticeDecision;
    return { ...decision, escrowId: row.escrow_id, custodyId: row.custody_id,
        custodyStartedAt: row.custody_started_at, custodyReleaseAt: row.custody_release_at,
        planDigest: row.plan_digest };
}
function hasRestitution(plan: JusticeExecutionPlan): boolean {
    return plan.restitution.gp > 0 || plan.restitution.items.length > 0;
}

/** Durable coordinator. It freezes a verified decision but cannot adjudicate or widen it. */
export class JusticeExecutionStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true }); this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS justice_execution(decision_id TEXT PRIMARY KEY,
            decision_json TEXT NOT NULL,escrow_id TEXT NOT NULL UNIQUE,custody_id TEXT NOT NULL UNIQUE,
            custody_started_at TEXT NOT NULL,custody_release_at TEXT NOT NULL,plan_digest TEXT NOT NULL UNIQUE)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS justice_execution_event(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_id TEXT NOT NULL,phase TEXT NOT NULL,detail TEXT,occurred_at TEXT NOT NULL,
            previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
            FOREIGN KEY(decision_id) REFERENCES justice_execution(decision_id))`);
    }
    close(): void { this.database.close(true); }

    begin(decision: RecordedJusticeDecision, authority: symbol, plannedAt = new Date().toISOString()): JusticeExecutionState {
        if (authority !== VERIFIED_DECISION) throw new Error('Justice execution requires a verified decision');
        if (decision.disposition !== 'approved') throw new Error('Rejected justice decisions cannot be executed');
        const existing = this.get(decision.decisionId);
        if (existing) {
            if (existing.plan.decisionDigest !== decision.decisionDigest)
                throw new Error('Justice execution decision changed after freezing');
            return existing;
        }
        const prepared = planFacts(decision, new Date(plannedAt).toISOString());
        const planDigest = hash(prepared);
        this.database.transaction(() => {
            this.database.run('INSERT INTO justice_execution VALUES(?1,?2,?3,?4,?5,?6,?7)',
            [decision.decisionId,JSON.stringify(prepared.decision),prepared.escrowId,prepared.custodyId,
                prepared.custodyStartedAt,prepared.custodyReleaseAt,planDigest]);
            this.append(decision.decisionId,'planned',null,plannedAt);
        }).immediate();
        return this.get(decision.decisionId)!;
    }

    get(decisionId: string): JusticeExecutionState | null {
        if (!this.verifyAuditChain()) throw new Error('Justice execution audit chain is invalid');
        const row = this.database.query('SELECT * FROM justice_execution WHERE decision_id=?1').get(decisionId) as PlanRow | null;
        if (!row) return null;
        const events = this.database.query('SELECT * FROM justice_execution_event WHERE decision_id=?1 ORDER BY sequence')
            .all(decisionId) as EventRow[];
        const phases = events.filter(event => event.phase !== 'failed') as Array<EventRow & { phase: JusticeExecutionPhase }>;
        const failure = [...events].reverse().find(event => event.phase === 'failed');
        return { plan: rowPlan(row), phase: phases.at(-1)!.phase,
            lastError: failure && failure.sequence > phases.at(-1)!.sequence ? failure.detail : null };
    }

    listPending(limit = 100): JusticeExecutionState[] {
        const rows = this.database.query('SELECT decision_id FROM justice_execution ORDER BY rowid LIMIT ?1')
            .all(limit) as Array<{ decision_id: string }>;
        return rows.map(row => this.get(row.decision_id)!).filter(value => value.phase !== 'settled');
    }

    advance(decisionId: string, expected: JusticeExecutionPhase, next: JusticeExecutionPhase,
        occurredAt = new Date().toISOString()): JusticeExecutionState {
        const current = this.get(decisionId); if (!current) throw new Error('Justice execution plan is absent');
        const order: JusticeExecutionPhase[] = ['planned','held','restricted','settled'];
        if (order.indexOf(current.phase) >= order.indexOf(next)) return current;
        if (current.phase !== expected || order.indexOf(next) !== order.indexOf(expected) + 1)
            throw new Error('Justice execution phase transition is invalid');
        this.append(decisionId,next,null,occurredAt); return this.get(decisionId)!;
    }
    fail(decisionId: string, detail: string, occurredAt = new Date().toISOString()): void {
        if (!this.get(decisionId)) throw new Error('Justice execution plan is absent');
        this.append(decisionId,'failed',detail.slice(0,500),occurredAt);
    }
    verifyAuditChain(): boolean {
        try {
            const plans = this.database.query('SELECT rowid,* FROM justice_execution').all() as Array<PlanRow & { rowid: number }>;
            const byId = new Map(plans.map(row => [(JSON.parse(row.decision_json) as RecordedJusticeDecision).decisionId,row]));
            const events = this.database.query('SELECT * FROM justice_execution_event ORDER BY sequence').all() as EventRow[];
            let previous = ZERO; const last = new Map<string,JusticeExecutionPhase>();
            const order: JusticeExecutionPhase[] = ['planned','held','restricted','settled'];
            for (const row of plans) {
                const decision = JSON.parse(row.decision_json) as RecordedJusticeDecision;
                const prepared = { decision, escrowId: row.escrow_id, custodyId: row.custody_id,
                    custodyStartedAt: row.custody_started_at, custodyReleaseAt: row.custody_release_at };
                if (row.plan_digest !== hash(prepared)) return false;
            }
            for (const event of events) {
                if (!byId.has(event.decision_id) || event.previous_hash !== previous) return false;
                const payload = { decisionId:event.decision_id,phase:event.phase,detail:event.detail,occurredAt:event.occurred_at };
                if (event.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = event.entry_hash;
                if (event.phase !== 'failed') { const prior = last.get(event.decision_id);
                    if ((!prior && event.phase !== 'planned') || (prior && order.indexOf(event.phase) !== order.indexOf(prior)+1)) return false;
                    last.set(event.decision_id,event.phase); }
            }
            return plans.length === last.size;
        } catch { return false; }
    }
    private append(decisionId: string, phase: JusticeExecutionPhase|'failed', detail: string|null, occurredAt: string): void {
        const previous = (this.database.query('SELECT entry_hash FROM justice_execution_event ORDER BY sequence DESC LIMIT 1')
            .get() as {entry_hash:string}|null)?.entry_hash ?? ZERO;
        const payload = { decisionId,phase,detail,occurredAt };
        this.database.run(`INSERT INTO justice_execution_event(decision_id,phase,detail,occurred_at,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4,?5,?6)`,[decisionId,phase,detail,occurredAt,previous,hash({previousHash:previous,payload})]);
    }
}

export interface JusticeExecutionPorts {
    journal: JusticeExecutionStore;
    escrower: (request: EnginePlayerEscrowRequest, commandId?: string) => Promise<EnginePlayerEscrowResult>;
    custodian: (request: EnginePlayerCustodyRequest, commandId?: string) => Promise<EnginePlayerCustodyResult>;
    now?: () => string;
    afterExternalStep?: (step: 'hold'|'custody'|'commit') => void;
}
function commandId(namespace: string, id: string): string { return uuid(`justice-command/${namespace}`,id); }

export function planJusticeExecution(decisionId: string, decisions: Pick<JusticeDecisionStore,'get'|'verifyAuditChain'>,
    journal: JusticeExecutionStore, plannedAt?: string): JusticeExecutionState {
    if (!decisions.verifyAuditChain()) throw new Error('Justice decision audit chain is invalid');
    const decision = decisions.get(decisionId); if (!decision) throw new Error('Justice decision is absent');
    return journal.begin(structuredClone(decision),VERIFIED_DECISION,plannedAt);
}

export async function executeJusticeDecision(decisionId: string, ports: JusticeExecutionPorts): Promise<JusticeExecutionState> {
    let current = ports.journal.get(decisionId); if (!current) throw new Error('Justice execution plan is absent');
    const now = ports.now ?? (()=>new Date().toISOString()), plan = current.plan;
    try {
        if (current.phase === 'planned') {
            if (hasRestitution(plan)) {
                const receipt = await ports.escrower({ escrowId:plan.escrowId,operation:'hold',username:plan.subjectUsername,
                    assets:{gp:plan.restitution.gp,items:plan.restitution.items} },commandId('hold',decisionId));
                if (!receipt.ok || receipt.escrowId !== plan.escrowId || receipt.operation !== 'hold'
                    || receipt.escrow?.status !== 'held' || receipt.escrow.assets.gp !== plan.restitution.gp
                    || JSON.stringify(receipt.escrow.assets.items) !== JSON.stringify(plan.restitution.items))
                    throw new Error('Engine returned a mismatched justice escrow hold');
                ports.afterExternalStep?.('hold');
            }
            current = ports.journal.advance(decisionId,'planned','held',now());
        }
        if (current.phase === 'held') {
            if (plan.custodySeconds > 0) {
                const request: EnginePlayerCustodyRequest = { custodyId:plan.custodyId,decisionId:plan.decisionId,
                    decisionDigest:plan.decisionDigest,username:plan.subjectUsername,jurisdictionId:plan.jurisdictionId,
                    ...plan.custodyLocation,startedAt:plan.custodyStartedAt,releaseAt:plan.custodyReleaseAt };
                const receipt = await ports.custodian(request,commandId('custody',decisionId));
                if (!receipt.ok || receipt.custodyId !== plan.custodyId || receipt.username !== plan.subjectUsername
                    || receipt.custody?.decisionDigest !== plan.decisionDigest)
                    throw new Error('Engine returned a mismatched custody receipt');
                ports.afterExternalStep?.('custody');
            }
            current = ports.journal.advance(decisionId,'held','restricted',now());
        }
        if (current.phase === 'restricted') {
            if (hasRestitution(plan)) {
                const receipt = await ports.escrower({escrowId:plan.escrowId,operation:'commit',
                    username:plan.subjectUsername,payeeUsername:plan.beneficiaryUsername!},commandId('commit',decisionId));
                if (!receipt.ok || receipt.escrowId !== plan.escrowId || receipt.operation !== 'commit'
                    || receipt.escrow?.status !== 'committed' || receipt.escrow.payeeUsername !== plan.beneficiaryUsername)
                    throw new Error('Engine returned a mismatched justice escrow commit');
                ports.afterExternalStep?.('commit');
            }
            current = ports.journal.advance(decisionId,'restricted','settled',now());
        }
        return current;
    } catch (error) { ports.journal.fail(decisionId,error instanceof Error?error.message:String(error),now()); throw error; }
}

export async function recoverJusticeExecutions(ports: JusticeExecutionPorts): Promise<{attempted:string[];settled:string[];
    errors:Array<{decisionId:string;message:string}>}> {
    const result:{attempted:string[];settled:string[];errors:Array<{decisionId:string;message:string}>}={attempted:[],settled:[],errors:[]};
    for (const current of ports.journal.listPending()) { result.attempted.push(current.plan.decisionId);
        try { if ((await executeJusticeDecision(current.plan.decisionId,ports)).phase==='settled') result.settled.push(current.plan.decisionId); }
        catch(error){result.errors.push({decisionId:current.plan.decisionId,message:error instanceof Error?error.message:String(error)});} }
    return result;
}
