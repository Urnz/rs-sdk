import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { localOrigin, type ControlPlaneConfig } from './config.js';
import { IdentityError, localServerId } from './identity-store.js';

export interface RegisteredServer { id: string; name: string; gatewayOrigin: string; engineOrigin: string; registeredAt: number }
export function serverRegistryPath(identityFile: string) {
    const path = resolve(process.env.CONTROL_PLANE_REGISTRY_PATH || join(dirname(identityFile), 'servers.sqlite'));
    if (path === resolve(identityFile)) throw new Error('Identity and server registry paths must differ');
    return path;
}

/** Metadata only. Ownership remains authoritative in IdentityStore; registration never starts a server. */
export class ServerRegistry {
    private db: Database;
    constructor(path: string, private now = () => Date.now()) {
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.db = new Database(path, { create: true });
        try {
            if (path !== ':memory:') chmodSync(path, 0o600);
            this.db.exec('PRAGMA busy_timeout=5000');
            const version = (this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version !== 0 && version !== 1) throw new Error('Unsupported server registry schema');
            this.db.exec('PRAGMA journal_mode=WAL');
            if (version === 0) this.db.transaction(() => {
                if ((this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version === 1) return;
                this.db.exec(`CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, gateway_origin TEXT NOT NULL, engine_origin TEXT NOT NULL, registered_at INTEGER NOT NULL);
                    CREATE TABLE registry_audit (sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, server_id TEXT NOT NULL, created_at INTEGER NOT NULL);
                    PRAGMA user_version=1`);
            }).immediate();
        } catch (error) { this.db.close(); throw error; }
    }
    close() { this.db.close(); }
    /** Trusted provisioning primitive for the next phase; no HTTP registration endpoint is exposed here. */
    register(input: Omit<RegisteredServer, 'registeredAt'>): RegisteredServer {
        if (typeof input.id !== 'string' || input.id.length > 64 || !/^[a-z0-9]/.test(input.id) || /[^a-z0-9-]/.test(input.id))
            throw new IdentityError(400, 'INVALID_SERVER_ID', 'Érvénytelen szerverazonosító.');
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name))
            throw new IdentityError(400, 'INVALID_SERVER_NAME', 'A szerver neve 1–80 látható karakter legyen.');
        const gatewayOrigin = localOrigin(input.gatewayOrigin), engineOrigin = localOrigin(input.engineOrigin);
        let result!: RegisteredServer;
        this.db.transaction(() => {
            const previous = this.get(input.id);
            if (previous) {
                if (previous.name !== input.name || previous.gatewayOrigin !== gatewayOrigin || previous.engineOrigin !== engineOrigin)
                    throw new IdentityError(409, 'SERVER_BINDING_CONFLICT', 'A szerverazonosítóhoz már más regisztráció tartozik.');
                result = previous; return;
            }
            result = { id: input.id, name: input.name, gatewayOrigin, engineOrigin, registeredAt: this.now() };
            this.db.query('INSERT INTO servers VALUES (?,?,?,?,?)').run(result.id, result.name, result.gatewayOrigin, result.engineOrigin, result.registeredAt);
            this.db.query("INSERT INTO registry_audit(kind,server_id,created_at) VALUES ('registered',?,?)").run(result.id, result.registeredAt);
        }).immediate();
        return result;
    }
    ensureConfiguredLocal(config: ControlPlaneConfig) {
        return this.register({ id: localServerId, name: 'Helyi szerver', gatewayOrigin: config.gatewayOrigin, engineOrigin: config.engineOrigin });
    }
    get(id: string): RegisteredServer | null {
        return this.db.query('SELECT id,name,gateway_origin AS gatewayOrigin,engine_origin AS engineOrigin,registered_at AS registeredAt FROM servers WHERE id=?').get(id) as RegisteredServer | null;
    }
    visibleTo(owns: (id: string) => boolean): RegisteredServer[] {
        return (this.db.query('SELECT id,name,gateway_origin AS gatewayOrigin,engine_origin AS engineOrigin,registered_at AS registeredAt FROM servers ORDER BY name COLLATE NOCASE,id').all() as RegisteredServer[])
            .filter(server => owns(server.id));
    }
}
