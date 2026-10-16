import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { healthDigest, healthInteger, healthObject, healthTime } from '../../../../population-health/policy.js';
import { validatePopulationDeathEvidence, type PopulationDeathEvidence, type PopulationDeathRecord } from '../../../../population-lifecycle/death.js';
import type { AgentPopulationMember } from '../../../../agent-state/types.js';

export interface EngineHealthDamage {
    eventId: string; username: string; sessionId: string; engineTick: number; occurredAt: string;
    hpBefore: number; hpAfter: number; maxHp: number; damageType: number;
}
export interface EngineHealthDamageRecord extends EngineHealthDamage { sequence: number; eventDigest: string }
interface Row { sequence: number; event_id: string; event_json: string; event_digest: string; previous_hash: string; entry_hash: string }
const ZERO = '0'.repeat(64);
export function validateEngineHealthDamage(raw: unknown): EngineHealthDamage {
    const value = healthObject(raw, ['eventId', 'username', 'sessionId', 'engineTick', 'occurredAt', 'hpBefore', 'hpAfter', 'maxHp', 'damageType'], 'Engine health evidence');
    if (typeof value.eventId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.eventId)
        || typeof value.username !== 'string' || !/^[a-z0-9][a-z0-9 _]{0,11}$/.test(value.username)
        || typeof value.sessionId !== 'string' || value.sessionId.length < 1 || value.sessionId.length > 128
        || typeof value.occurredAt !== 'string') throw new Error('Engine health evidence identity is invalid');
    healthTime(value.occurredAt);
    const before = healthInteger(value.hpBefore, 1, 255), after = healthInteger(value.hpAfter, 0, before - 1);
    return { eventId: value.eventId, username: value.username, sessionId: value.sessionId,
        occurredAt: value.occurredAt, engineTick: healthInteger(value.engineTick, 0, Number.MAX_SAFE_INTEGER),
        hpBefore: before, hpAfter: after, maxHp: healthInteger(value.maxHp, 1, 255), damageType: healthInteger(value.damageType, 0, 255) };
}

/** Only the local engine writes this source; gateway opens it read-only and verifies its entire chain. */
export class PlayerHealthEvidenceStore {
    private readonly database: Database;
    private readonly statements = new Set<{finalize():void}>();
    readonly schemaVersion: number;
    constructor(path: string, readonly readOnly = false) {
        if (!readOnly) mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, readOnly ? { readonly: true, strict: true } : { create: true, strict: true });
        this.database.query = new Proxy(this.database.query,{apply:(target,receiver,args)=>{
            const statement = Reflect.apply(target,receiver,args); this.statements.add(statement); return statement;
        }});
        try {
            const schemaVersion = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (schemaVersion > 2 || (readOnly && schemaVersion < 1)) throw new Error('Engine health schema is unsupported');
            if (!readOnly) {
                this.database.run('PRAGMA journal_mode=WAL');
                this.database.transaction(() => {
                    this.database.run(`CREATE TABLE IF NOT EXISTS engine_health_damage(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_id TEXT NOT NULL UNIQUE,event_json TEXT NOT NULL,event_digest TEXT NOT NULL,
                        previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
                    this.database.run('CREATE TABLE IF NOT EXISTS engine_health_producer(producer_id TEXT PRIMARY KEY,observed_at TEXT NOT NULL,protocol INTEGER NOT NULL)');
                    this.database.run(`CREATE TABLE IF NOT EXISTS engine_population_death(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,
                        event_json TEXT NOT NULL,event_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
                    this.database.run(`CREATE TABLE IF NOT EXISTS engine_health_audit_tail(
                        domain TEXT PRIMARY KEY,sequence INTEGER NOT NULL,entry_hash TEXT NOT NULL)`);
                    this.database.run(`CREATE TABLE IF NOT EXISTS engine_population_binding(
                        username TEXT PRIMARY KEY,agent_id TEXT NOT NULL UNIQUE,identity_digest TEXT NOT NULL)`);
                    if (schemaVersion < 2) {
                        for (const domain of ['damage','death'] as const) this.updateTail(domain);
                        this.updateBindingAnchor();
                    }
                    this.database.run('PRAGMA user_version=2');
                }).immediate();
            }
            this.schemaVersion = readOnly ? schemaVersion : 2;
            this.verify();
        } catch (error) { this.close(); throw error; }
    }
    close() { for (const statement of this.statements) statement.finalize(); this.statements.clear(); this.database.close(true); }
    readSnapshot<T>(read: () => T): T {
        if (!this.readOnly) throw new Error('Read snapshots require a read-only engine authority');
        let result!: T; this.database.transaction(() => { this.verify(); result = read(); }).deferred(); return result;
    }
    heartbeat(at: string): void {
        if (this.readOnly) throw new Error('Gateway cannot write engine health heartbeat');
        healthTime(at);
        this.database.run(`INSERT INTO engine_health_producer VALUES('local-engine',?1,1)
            ON CONFLICT(producer_id) DO UPDATE SET observed_at=MAX(observed_at,excluded.observed_at),protocol=1`, [at]);
    }
    isReady(at: string): boolean {
        const now = healthTime(at), row = this.database.query("SELECT observed_at,protocol FROM engine_health_producer WHERE producer_id='local-engine'")
            .get() as { observed_at: string; protocol: number } | null;
        if (!row || row.protocol !== 1) return false;
        const observed = healthTime(row.observed_at);
        return observed <= now + 5000 && observed >= now - 30000;
    }
    verify(): void {
        let previous = ZERO;
        for (const row of this.database.query('SELECT * FROM engine_health_damage ORDER BY sequence').all() as Row[]) {
            const event = validateEngineHealthDamage(JSON.parse(row.event_json)), digest = healthDigest(event);
            if (row.event_id !== event.eventId || row.event_digest !== digest || row.previous_hash !== previous
                || row.entry_hash !== healthDigest({ previous, sequence: row.sequence, eventId: event.eventId, digest })) {
                throw new Error('Engine health evidence audit is invalid');
            }
            previous = row.entry_hash;
        }
        if (this.schemaVersion >= 2) {
            previous = ZERO;
            const deathRows = this.database.query('SELECT * FROM engine_population_death ORDER BY sequence').all() as (Row & { agent_id: string; username: string })[];
            for (const row of deathRows) {
                const event = validatePopulationDeathEvidence(JSON.parse(row.event_json)), digest = healthDigest(event);
                if (row.event_id !== event.eventId || row.agent_id !== event.agentId || row.username !== event.playerUsername
                    || row.event_digest !== digest || row.previous_hash !== previous
                    || row.entry_hash !== healthDigest({ previous, sequence: row.sequence, eventId: event.eventId, digest }))
                    throw new Error('Engine death evidence audit is invalid');
                if (event.cause.kind === 'engine-hp-zero') {
                    const damage = this.database.query('SELECT event_json FROM engine_health_damage WHERE event_id=?1')
                        .get(event.cause.damageEventId) as { event_json: string } | null;
                    const proof = damage && validateEngineHealthDamage(JSON.parse(damage.event_json));
                    if (!proof || proof.hpAfter !== 0 || proof.username !== event.playerUsername
                        || proof.sessionId !== event.cause.sessionId || proof.engineTick !== event.cause.engineTick
                        || event.recordedAt < proof.occurredAt)
                        throw new Error('Engine death lacks lethal HP evidence');
                }
                previous = row.entry_hash;
            }
            for (const domain of ['damage','death'] as const) {
                const table = domain === 'damage' ? 'engine_health_damage' : 'engine_population_death';
                const last = this.database.query(`SELECT sequence,entry_hash FROM ${table} ORDER BY sequence DESC LIMIT 1`)
                    .get() as { sequence: number; entry_hash: string } | null;
                const anchor = this.database.query('SELECT sequence,entry_hash FROM engine_health_audit_tail WHERE domain=?1')
                    .get(domain) as { sequence: number; entry_hash: string } | null;
                if (!anchor || anchor.sequence !== (last?.sequence ?? 0) || anchor.entry_hash !== (last?.entry_hash ?? ZERO))
                    throw new Error('Engine health/death audit tail was truncated');
            }
            const bindings = this.database.query('SELECT * FROM engine_population_binding ORDER BY username').all();
            const anchor = this.database.query("SELECT sequence,entry_hash FROM engine_health_audit_tail WHERE domain='binding'")
                .get() as { sequence: number; entry_hash: string } | null;
            if (!anchor || anchor.sequence !== bindings.length || anchor.entry_hash !== healthDigest(bindings))
                throw new Error('Engine finite avatar bindings were altered');
        }
    }
    private updateBindingAnchor(): void {
        const bindings = this.database.query('SELECT * FROM engine_population_binding ORDER BY username').all();
        this.database.run(`INSERT INTO engine_health_audit_tail VALUES('binding',?1,?2)
            ON CONFLICT(domain) DO UPDATE SET sequence=excluded.sequence,entry_hash=excluded.entry_hash`,
            [bindings.length,healthDigest(bindings)]);
    }
    finiteAvatar(username: string): { agent_id: string; identity_digest: string } | null {
        this.verify(); if (this.schemaVersion < 2) return null;
        return this.database.query('SELECT agent_id,identity_digest FROM engine_population_binding WHERE username=?1')
            .get(username.toLowerCase()) as { agent_id: string; identity_digest: string } | null;
    }
    bindFiniteAvatar(member: AgentPopulationMember): void {
        if (this.readOnly) throw new Error('Only engine can persist finite avatar bindings');
        const identity = healthDigest({ agentId: member.agentId, username: member.playerUsername, worldProfile: member.worldProfile,
            lifecyclePolicy: member.lifecyclePolicy, clock: member.simulationClock, joinedAt: member.joinedAtSimulationTime,
            genesisId: member.sourceResultId, genesisDigest: member.sourceResultDigest, createdAt: member.createdAt });
        this.database.transaction(() => {
            const existing = this.finiteAvatar(member.playerUsername);
            if (existing) {
                if (existing.agent_id !== member.agentId || existing.identity_digest !== identity) throw new Error('Finite avatar binding conflicts');
                return;
            }
            this.database.run('INSERT INTO engine_population_binding VALUES(?1,?2,?3)', [member.playerUsername,member.agentId,identity]);
            this.updateBindingAnchor();
        }).immediate();
    }
    private updateTail(domain: 'damage' | 'death'): void {
        const table = domain === 'damage' ? 'engine_health_damage' : 'engine_population_death';
        const last = this.database.query(`SELECT sequence,entry_hash FROM ${table} ORDER BY sequence DESC LIMIT 1`)
            .get() as { sequence: number; entry_hash: string } | null;
        this.database.run(`INSERT INTO engine_health_audit_tail VALUES(?1,?2,?3)
            ON CONFLICT(domain) DO UPDATE SET sequence=excluded.sequence,entry_hash=excluded.entry_hash`,
            [domain,last?.sequence ?? 0,last?.entry_hash ?? ZERO]);
    }
    listDeaths(): PopulationDeathRecord[] {
        this.verify(); if (this.schemaVersion < 2) return [];
        return (this.database.query('SELECT * FROM engine_population_death ORDER BY sequence').all() as Row[])
            .map(row => ({ ...validatePopulationDeathEvidence(JSON.parse(row.event_json)), sequence: row.sequence, eventDigest: row.event_digest }));
    }
    deathFor(username: string): PopulationDeathRecord | null {
        return this.listDeaths().find(event => event.playerUsername === username.toLowerCase()) ?? null;
    }
    private insertDeath(raw: PopulationDeathEvidence): void {
        const event = validatePopulationDeathEvidence(raw), digest = healthDigest(event);
        const existing = this.database.query('SELECT * FROM engine_population_death WHERE agent_id=?1 OR username=?2')
            .get(event.agentId, event.playerUsername) as Row | null;
        if (existing) {
            if (existing.event_digest !== digest) throw new Error('Terminal avatar death binding conflicts');
            return;
        }
        const last = this.database.query('SELECT sequence,entry_hash FROM engine_population_death ORDER BY sequence DESC LIMIT 1')
            .get() as { sequence: number; entry_hash: string } | null;
        const sequence = (last?.sequence ?? 0) + 1, previous = last?.entry_hash ?? ZERO;
        this.database.run('INSERT INTO engine_population_death VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
            [sequence,event.eventId,event.agentId,event.playerUsername,JSON.stringify(event),digest,previous,
                healthDigest({ previous, sequence, eventId: event.eventId, digest })]);
        this.updateTail('death');
    }
    recordNaturalDeath(event: PopulationDeathEvidence): void {
        if (this.readOnly || event.cause.kind !== 'natural-mortality') throw new Error('Only engine natural mortality can create this death');
        this.database.transaction(() => { this.verify(); this.insertDeath(event); this.verify(); }).immediate();
    }
    list(afterSequence = 0, limit = 1000): EngineHealthDamageRecord[] {
        healthInteger(afterSequence, 0, Number.MAX_SAFE_INTEGER); healthInteger(limit, 1, 1000); this.verify();
        return (this.database.query('SELECT * FROM engine_health_damage WHERE sequence>?1 ORDER BY sequence LIMIT ?2')
            .all(afterSequence, limit) as Row[]).map(row => ({ ...validateEngineHealthDamage(JSON.parse(row.event_json)), sequence: row.sequence, eventDigest: row.event_digest }));
    }
    record(input: Omit<EngineHealthDamage, 'eventId'>, eventId: string = randomUUID(), death?: PopulationDeathEvidence): EngineHealthDamageRecord {
        if (this.readOnly) throw new Error('Gateway cannot write engine health evidence');
        const event = validateEngineHealthDamage({ ...input, eventId }), digest = healthDigest(event);
        let committedSequence = 0;
        this.database.transaction(() => {
            this.verify();
            if (this.deathFor(event.username) && !death) throw new Error('Terminal avatar cannot receive new damage');
            const existing = this.database.query('SELECT * FROM engine_health_damage WHERE event_id=?1').get(eventId) as Row | null;
            if (existing) { if (existing.event_digest !== digest) throw new Error('Engine health event id conflict');
                if (death) { this.insertDeath(death); this.verify(); } committedSequence = existing.sequence; return; }
            const last = this.database.query('SELECT sequence,entry_hash FROM engine_health_damage ORDER BY sequence DESC LIMIT 1')
                .get() as { sequence: number; entry_hash: string } | null;
            const sequence = (last?.sequence ?? 0) + 1, previous = last?.entry_hash ?? ZERO;
            committedSequence = sequence;
            this.database.run('INSERT INTO engine_health_damage VALUES(?1,?2,?3,?4,?5,?6)',
                [sequence, eventId, JSON.stringify(event), digest, previous, healthDigest({ previous, sequence, eventId, digest })]);
            this.updateTail('damage');
            this.heartbeat(event.occurredAt);
            if (death) {
                if (death.cause.kind !== 'engine-hp-zero' || death.cause.damageEventId !== event.eventId)
                    throw new Error('Death does not bind this lethal damage');
                this.insertDeath(death); this.verify();
            }
        }).immediate();
        return { ...event, sequence: committedSequence, eventDigest: digest };
    }
}
let runtime: PlayerHealthEvidenceStore | null = null;
export function engineHealthRuntime() {
    return runtime ??= new PlayerHealthEvidenceStore(fileURLToPath(new URL('../../data/mods/player-health-evidence.sqlite', import.meta.url)));
}
export function recordPlayerHealthDamage(input: Omit<EngineHealthDamage, 'eventId'>, eventId?: string, death?: PopulationDeathEvidence) {
    return engineHealthRuntime().record(input, eventId, death);
}
let lastHeartbeatAttempt = 0;
export function recordPlayerHealthHeartbeat() {
    const now = Date.now();
    if (now - lastHeartbeatAttempt < 10000) return;
    lastHeartbeatAttempt = now;
    engineHealthRuntime().heartbeat(new Date(now).toISOString());
}
