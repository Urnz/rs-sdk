import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { healthDigest, healthTime } from '../population-health/policy.js';
import type { EstateDomain } from './schema.js';
import type { EstatePolicy } from './policy.js';
import { VerifiedEstateDeath, assertVerifiedEstateDeath } from './authority.js';
import type { EstateInheritance, InheritancePlan } from './inheritance-policy.js';

export interface EstateCase {
    estateId: string; agentId: string; username: string; deathEventId: string; deathDigest: string;
    deathAtSimulationTime: string; policyDigest: string; sourcesDigest: string;
    status: 'open' | 'blocked' | 'custody-ready'; receipts: Partial<Record<EstateDomain, string>>;
    blockers: string[]; createdAt: string; updatedAt: string; revision: number;
    inheritance?: EstateInheritance;
}
export class PopulationEstateStore {
    private readonly db: Database;
    private readonly statements = new Set<{finalize():void}>();
    constructor(path: string, readonly readOnly = false) {
        if (!readOnly) mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, readOnly ? { readonly: true, strict: true } : { create: true, strict: true });
        this.db.query = new Proxy(this.db.query,{apply:(target,receiver,args)=>{
            const statement = Reflect.apply(target,receiver,args); this.statements.add(statement); return statement;
        }});
        try {
            const version = (this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (readOnly) { if (version !== 1) throw new Error('Read-only estate schema is unavailable or unsupported'); this.verify(); return; }
            if (version > 1) throw new Error('Unsupported population estate schema');
            this.db.run('PRAGMA journal_mode=WAL');
            this.db.transaction(() => {
                this.db.run('CREATE TABLE IF NOT EXISTS estate_case(estate_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL UNIQUE,record_json TEXT NOT NULL,record_digest TEXT NOT NULL)');
                this.db.run(`CREATE TABLE IF NOT EXISTS estate_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    estate_id TEXT NOT NULL,event_json TEXT NOT NULL,event_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
                this.db.run('CREATE TABLE IF NOT EXISTS estate_audit_tail(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,entry_hash TEXT NOT NULL)');
                this.db.run('INSERT OR IGNORE INTO estate_audit_tail VALUES(1,0,?1)', ['0'.repeat(64)]);
                this.db.run('PRAGMA user_version=1');
            }).immediate(); this.verify();
        } catch (error) { this.close(); throw error; }
    }
    close(): void { for (const statement of this.statements) statement.finalize(); this.statements.clear(); this.db.close(true); }
    readSnapshot<T>(read: () => T): T {
        if (!this.readOnly) throw new Error('Read snapshots require a read-only estate connection');
        let result!: T; this.db.transaction(() => { this.verify(); result = read(); }).deferred(); return result;
    }
    verify(): void {
        let previous = '0'.repeat(64), sequence = 0; const latest = new Map<string, string>();
        for (const row of this.db.query('SELECT * FROM estate_audit ORDER BY sequence').all() as Array<{
            sequence: number; estate_id: string; event_json: string; event_digest: string; previous_hash: string; entry_hash: string }>) {
            const event = JSON.parse(row.event_json) as { estateId: string; stateDigest: string };
            if (row.sequence !== ++sequence || event.estateId !== row.estate_id || row.event_digest !== healthDigest(event)
                || row.previous_hash !== previous || row.entry_hash !== healthDigest({ previous, sequence, digest: row.event_digest }))
                throw new Error('Estate audit chain is invalid');
            previous = row.entry_hash; latest.set(row.estate_id, event.stateDigest);
        }
        const tail = this.db.query('SELECT * FROM estate_audit_tail WHERE singleton=1').get() as { sequence: number; entry_hash: string };
        if (!tail || tail.sequence !== sequence || tail.entry_hash !== previous) throw new Error('Estate audit was truncated');
        const cases = this.db.query('SELECT * FROM estate_case').all() as Array<{ estate_id: string; agent_id: string; record_json: string; record_digest: string }>;
        if (cases.length !== latest.size) throw new Error('Estate case history is incomplete');
        for (const row of cases) {
            const current = JSON.parse(row.record_json) as EstateCase;
            if (current.estateId !== row.estate_id || current.agentId !== row.agent_id || healthDigest(current) !== row.record_digest
                || latest.get(row.estate_id) !== row.record_digest) throw new Error('Estate case was altered');
        }
    }
    private write(current: EstateCase, kind: string): void {
        const digest = healthDigest(current);
        this.db.run(`INSERT INTO estate_case VALUES(?1,?2,?3,?4) ON CONFLICT(estate_id)
            DO UPDATE SET record_json=excluded.record_json,record_digest=excluded.record_digest`,
            [current.estateId,current.agentId,JSON.stringify(current),digest]);
        const last = this.db.query('SELECT sequence,entry_hash FROM estate_audit_tail WHERE singleton=1').get() as { sequence: number; entry_hash: string };
        const sequence = last.sequence + 1, event = { estateId: current.estateId, kind, stateDigest: digest, at: current.updatedAt };
        const eventDigest = healthDigest(event), entry = healthDigest({ previous: last.entry_hash, sequence, digest: eventDigest });
        this.db.run('INSERT INTO estate_audit VALUES(?1,?2,?3,?4,?5,?6)', [sequence,current.estateId,JSON.stringify(event),eventDigest,last.entry_hash,entry]);
        this.db.run('UPDATE estate_audit_tail SET sequence=?1,entry_hash=?2 WHERE singleton=1', [sequence,entry]);
    }
    get(estateId: string): EstateCase | null {
        this.verify(); const row = this.db.query('SELECT record_json FROM estate_case WHERE estate_id=?1').get(estateId) as { record_json: string } | null;
        return row ? JSON.parse(row.record_json) as EstateCase : null;
    }
    list(): EstateCase[] { this.verify(); return (this.db.query('SELECT record_json FROM estate_case ORDER BY agent_id').all() as { record_json: string }[])
        .map(row => JSON.parse(row.record_json) as EstateCase); }
    prepareInheritance(estateId: string, expectedRevision: number, plan: InheritancePlan, now: string): EstateCase {
        healthTime(now);
        this.db.transaction(() => {
            const current = this.get(estateId); if (!current || current.status !== 'custody-ready') throw new Error('Inheritance requires ready custody');
            if (current.inheritance) {
                if (current.inheritance.digest !== healthDigest(plan)) throw new Error('Inheritance decision conflicts'); return;
            }
            if (current.revision !== expectedRevision || plan.estateId !== estateId || plan.deathDigest !== current.deathDigest
                || plan.custodyReceiptDigest !== current.receipts.property || !plan.assets.length) throw new Error('Inheritance preview changed');
            this.write({...current,inheritance:{plan,digest:healthDigest(plan),status:'prepared',completedAt:null},updatedAt:now,revision:current.revision+1},'inheritance-prepared');
        }).immediate(); return this.get(estateId)!;
    }
    completeInheritance(estateId: string, digest: string, now: string): EstateCase {
        this.db.transaction(() => {
            const current = this.get(estateId);
            if (!current?.inheritance || current.inheritance.digest !== digest) throw new Error('Inheritance completion conflicts');
            if (current.inheritance.status === 'completed') return;
            this.write({...current,inheritance:{...current.inheritance,status:'completed',completedAt:now},updatedAt:now,revision:current.revision+1},'inheritance-completed');
        }).immediate(); return this.get(estateId)!;
    }
    open(authority: VerifiedEstateDeath, policy: EstatePolicy, sources: Record<EstateDomain, string>, now: string): EstateCase {
        assertVerifiedEstateDeath(authority); healthTime(now);
        this.db.transaction(() => {
            const existing = this.get(authority.estateId);
            if (existing) {
                if (existing.deathDigest !== authority.death.eventDigest || existing.policyDigest !== policy.digest
                    || existing.sourcesDigest !== healthDigest({sources,enginePath:authority.enginePath})) throw new Error('Estate identity/policy/source binding conflicts');
                return;
            }
            this.write({ estateId: authority.estateId, agentId: authority.death.agentId, username: authority.death.playerUsername,
                deathEventId: authority.death.eventId, deathDigest: authority.death.eventDigest,
                deathAtSimulationTime: authority.death.atSimulationTime, policyDigest: policy.digest, sourcesDigest: healthDigest({sources,enginePath:authority.enginePath}),
                status: 'open', receipts: {}, blockers: [], createdAt: now, updatedAt: now, revision: 1 }, 'opened');
        }).immediate(); return this.get(authority.estateId)!;
    }
    checkpoint(estateId: string, domain: EstateDomain, digest: string, now: string): EstateCase {
        this.db.transaction(() => {
            const current = this.get(estateId); if (!current) throw new Error('Estate case is missing');
            if (current.receipts[domain]) {
                if (current.receipts[domain] !== digest) throw new Error('Estate receipt replay conflicts'); return;
            }
            this.write({ ...current, receipts: { ...current.receipts, [domain]: digest }, status: 'open',
                updatedAt: now, revision: current.revision + 1 }, `source:${domain}`);
        }).immediate(); return this.get(estateId)!;
    }
    finish(estateId: string, policy: EstatePolicy, blockers: string[], now: string): EstateCase {
        this.db.transaction(() => {
            const current = this.get(estateId); if (!current) throw new Error('Estate case is missing');
            const reasons = [...new Set([...blockers, ...policy.requiredDomains.filter(domain => !current.receipts[domain])
                .map(domain => `${domain}: custody receipt missing`)])].sort();
            const status = reasons.length ? 'blocked' : 'custody-ready';
            if (current.status === status && JSON.stringify(current.blockers) === JSON.stringify(reasons)) return;
            this.write({ ...current, status, blockers: reasons, updatedAt: now, revision: current.revision + 1 }, status);
        }).immediate(); return this.get(estateId)!;
    }
}
