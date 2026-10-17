import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { IdentityError } from './identity-store.js';

export type LifecycleState = 'provisioning' | 'stopped' | 'starting' | 'running' | 'stopping' | 'restarting' | 'archiving' | 'archived' | 'failed' | 'maintenance';
export type LifecycleAction = 'create' | 'start' | 'stop' | 'restart' | 'archive' | 'backup' | 'restore' | 'migrate';
export interface ManagedServer { serverId: string; creatorId: string; version: string; template: string; ports: number[]; state: LifecycleState; revision: number; error: string | null }
export interface LifecycleOperation { id: string; serverId: string; actorId: string; action: LifecycleAction; state: 'running' | 'succeeded' | 'failed'; error: string | null }
export class LifecycleStore {
    constructor(private db: Database) {
        db.exec(`CREATE TABLE IF NOT EXISTS managed_servers (server_id TEXT PRIMARY KEY REFERENCES servers(id), creator_id TEXT NOT NULL, version TEXT NOT NULL, template TEXT NOT NULL,
            ports TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, error TEXT);
            CREATE TABLE IF NOT EXISTS managed_ports (port INTEGER PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id));
            CREATE TABLE IF NOT EXISTS lifecycle_operations (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
                state TEXT NOT NULL, error TEXT, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER,
                UNIQUE(actor_id,request_key));
            CREATE TABLE IF NOT EXISTS lifecycle_maintenance (operation_id TEXT PRIMARY KEY REFERENCES lifecycle_operations(id), payload TEXT NOT NULL);`);
    }
    managed(id: string): ManagedServer | null {
        const row = this.db.query('SELECT server_id AS serverId,creator_id AS creatorId,version,template,ports,state,revision,error FROM managed_servers WHERE server_id=?').get(id) as (Omit<ManagedServer, 'ports'> & { ports: string }) | null;
        return row ? { ...row, ports: JSON.parse(row.ports) } : null;
    }
    operation(id: string) { return this.db.query('SELECT id,server_id AS serverId,actor_id AS actorId,action,state,error FROM lifecycle_operations WHERE id=?').get(id) as LifecycleOperation | null; }
    pending() { return this.db.query("SELECT id,server_id AS serverId,actor_id AS actorId,action,state,error FROM lifecycle_operations WHERE state='running' ORDER BY created_at").all() as LifecycleOperation[]; }
    all() { return (this.db.query('SELECT server_id FROM managed_servers').all() as { server_id: string }[]).map(row => this.managed(row.server_id)!); }
    payload(id: string): { backupId?: string; targetVersion?: string } {
        const row = this.db.query('SELECT payload FROM lifecycle_maintenance WHERE operation_id=?').get(id) as { payload: string } | null;
        return row ? JSON.parse(row.payload) : {};
    }
    healthFailure(id: string, revision: number) {
        this.db.transaction(() => {
            const result = this.db.query("UPDATE managed_servers SET state='failed',error='HEALTH_CHECK_FAILED: Három egymást követő felügyeleti ellenőrzés nem igazolta a két folyamat futását. Ellenőrizd, majd indítsd újra.',revision=revision+1 WHERE server_id=? AND revision=? AND state='running' AND NOT EXISTS (SELECT 1 FROM lifecycle_operations WHERE server_id=? AND state='running')").run(id, revision, id);
            if (result.changes) this.db.query("INSERT INTO registry_audit(kind,server_id,created_at) VALUES ('health-check-failed',?,?)").run(id, Date.now());
        }).immediate();
    }
    fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
    replay(actor: string, key: string, fingerprint: string) {
        if (typeof key !== 'string' || key.length !== 36 || !/^[a-f0-9-]{36}$/.test(key)) throw new IdentityError(400, 'REQUEST_KEY_REQUIRED', 'Érvényes műveletazonosító szükséges.');
        const row = this.db.query('SELECT id,fingerprint FROM lifecycle_operations WHERE actor_id=? AND request_key=?').get(actor, key) as { id: string; fingerprint: string } | null;
        if (row && row.fingerprint !== fingerprint) throw new IdentityError(409, 'REQUEST_CONFLICT', 'Ez a műveletazonosító már más kéréshez tartozik.');
        return row ? this.operation(row.id) : null;
    }
    create(actor: string, key: string, fingerprint: string, input: { id: string; name: string; version: string; template: string }): LifecycleOperation {
        let operation!: LifecycleOperation;
        this.db.transaction(() => {
            const replay = this.replay(actor, key, fingerprint); if (replay) { operation = replay; return; }
            let ports: number[] | undefined;
            for (let base = 18000; base < 27990; base += 6) {
                const range = Array.from({ length: 6 }, (_, i) => base + i);
                if (!range.some(port => this.db.query('SELECT 1 FROM managed_ports WHERE port=?').get(port))) { ports = range; break; }
            }
            if (!ports) throw new IdentityError(409, 'PORT_POOL_FULL', 'Elfogyott a helyi szerverek porttartománya.');
            this.db.query('INSERT INTO servers VALUES (?,?,?,?,?)').run(input.id, input.name, `http://127.0.0.1:${ports[0]}`, `http://127.0.0.1:${ports[1]}`, Date.now());
            for (const port of ports) this.db.query('INSERT INTO managed_ports VALUES (?,?)').run(port, input.id);
            this.db.query("INSERT INTO managed_servers VALUES (?,?,?,?,?,'provisioning',1,NULL)").run(input.id, actor, input.version, input.template, JSON.stringify(ports));
            operation = this.insert(actor, key, fingerprint, input.id, 'create');
        }).immediate(); return operation;
    }
    begin(actor: string, key: string, fingerprint: string, id: string, action: Exclude<LifecycleAction, 'create'>, revision: number, payload: { backupId?: string; targetVersion?: string } = {}) {
        let operation!: LifecycleOperation;
        this.db.transaction(() => {
            const replay = this.replay(actor, key, fingerprint); if (replay) { operation = replay; return; }
            const server = this.managed(id);
            if (!server) throw new IdentityError(404, 'SERVER_NOT_FOUND', 'A kezelt szerver nem található.');
            if (!Number.isInteger(revision) || server.revision !== revision) throw new IdentityError(409, 'STALE_SERVER', 'A szerver állapota megváltozott; frissítsd a listát.');
            if (this.db.query("SELECT 1 FROM lifecycle_operations WHERE server_id=? AND state='running'").get(id)) throw new IdentityError(409, 'SERVER_BUSY', 'A szerveren már fut művelet.');
            if (server.state === 'archived') throw new IdentityError(409, 'SERVER_ARCHIVED', 'Az archivált szerver nem indítható vagy módosítható.');
            if (action === 'start' && server.state === 'running') throw new IdentityError(409, 'SERVER_RUNNING', 'A szerver már fut.');
            this.db.query('UPDATE managed_servers SET state=?,revision=revision+1,error=NULL WHERE server_id=?').run(
                { start: 'starting', stop: 'stopping', restart: 'restarting', archive: 'archiving', backup: 'maintenance', restore: 'maintenance', migrate: 'maintenance' }[action], id);
            operation = this.insert(actor, key, fingerprint, id, action);
            if (['backup', 'restore', 'migrate'].includes(action)) this.db.query('INSERT INTO lifecycle_maintenance VALUES (?,?)').run(operation.id, JSON.stringify(payload));
        }).immediate(); return operation;
    }
    private insert(actor: string, key: string, fingerprint: string, serverId: string, action: LifecycleAction): LifecycleOperation {
        const id = randomUUID();
        this.db.query("INSERT INTO lifecycle_operations VALUES (?,?,?,?,'running',NULL,?,?,?,NULL)").run(id, serverId, actor, action, key, fingerprint, Date.now());
        this.db.query('INSERT INTO registry_audit(kind,server_id,created_at) VALUES (?,?,?)').run(`lifecycle-${action}-requested`, serverId, Date.now());
        return this.operation(id)!;
    }
    finish(id: string, state: LifecycleState, error: string | null = null, version?: string) {
        this.db.transaction(() => {
            const operation = this.operation(id); if (!operation || operation.state !== 'running') return;
            this.db.query('UPDATE managed_servers SET state=?,error=?,revision=revision+1 WHERE server_id=?').run(state, error, operation.serverId);
            if (version && !error) this.db.query('UPDATE managed_servers SET version=? WHERE server_id=?').run(version, operation.serverId);
            this.db.query('UPDATE lifecycle_operations SET state=?,error=?,finished_at=? WHERE id=?').run(error ? 'failed' : 'succeeded', error, Date.now(), id);
            this.db.query('INSERT INTO registry_audit(kind,server_id,created_at) VALUES (?,?,?)').run(`lifecycle-${operation.action}-${error ? 'failed' : 'succeeded'}`, operation.serverId, Date.now());
        }).immediate();
    }
}
