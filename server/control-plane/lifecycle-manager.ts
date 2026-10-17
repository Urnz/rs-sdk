import { randomUUID } from 'node:crypto';
import { IdentityError, type IdentityStore } from './identity-store.js';
import { worldTemplates, type ManagedRuntime } from './managed-runtime.js';
import type { ServerRegistry } from './server-registry.js';
import type { LifecycleAction, LifecycleOperation } from './lifecycle-store.js';

export class LifecycleManager {
    private jobs = new Set<Promise<void>>();
    private misses = new Map<string, { revision: number; count: number; checkedAt: number }>();
    private supervising = false;
    private busyServers = new Set<string>();
    constructor(private registry: ServerRegistry, private identities: IdentityStore, private runtime: ManagedRuntime) {}
    catalog() { return { versions: [{ id: this.runtime.version, label: `Helyi LostCity · ${this.runtime.version.slice(0, 8)}` }],
        templates: worldTemplates.map(({ id, label }) => ({ id, label })) }; }
    private owned(actor: string, id: string, access: 'read' | 'operate' | 'owner' = 'owner') {
        const server = this.registry.lifecycle.managed(id);
        const role = this.identities.role(actor, id);
        if (!server || !role) throw new IdentityError(404, 'SERVER_NOT_FOUND', 'A kezelt szerver nem található.');
        if (access === 'owner' && role !== 'owner' || access === 'operate' && role === 'viewer')
            throw new IdentityError(403, 'ROLE_REQUIRED', 'Ehhez a szerverművelethez magasabb jogosultság szükséges.');
        return server;
    }
    async view(id: string) {
        const server = this.registry.lifecycle.managed(id); if (!server) return null;
        let observedState: 'running' | 'stopped' | 'unknown' | null = null;
        if (server.state === 'running') try { observedState = await this.runtime.inspect(server); } catch { observedState = 'unknown'; }
        const health = this.misses.get(id);
        return { state: server.state, revision: server.revision, version: server.version, template: server.template, error: server.error,
            observedState, health: health ? { consecutiveFailures: health.count, checkedAt: health.checkedAt } : null,
            migrationAvailable: server.version !== this.runtime.version, maintenanceAvailable: !!this.runtime.backup };
    }
    async backups(actor: string, id: string) { const server = this.owned(actor, id); return this.runtime.backups ? this.runtime.backups(server) : []; }
    async connection(actor: string, id: string) {
        const server = this.owned(actor, id, 'read');
        if (server.state !== 'running') return { gateway: false, engine: false };
        if (this.runtime.connection) return this.runtime.connection(server);
        const running = await this.runtime.inspect(server) === 'running';
        return { gateway: running, engine: running };
    }
    operation(actor: string, id: string) {
        const operation = this.registry.lifecycle.operation(id);
        if (!operation || !this.identities.role(actor, operation.serverId)) throw new IdentityError(404, 'OPERATION_NOT_FOUND', 'A művelet nem található.');
        return { id: operation.id, serverId: operation.serverId, action: operation.action, state: operation.state, error: operation.error };
    }
    create(actor: string, data: Record<string, unknown>) {
        const { name, version, template, requestKey } = data;
        if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new IdentityError(400, 'INVALID_SERVER_NAME', 'A szerver neve 1–80 látható karakter legyen.');
        if (typeof version !== 'string' || typeof template !== 'string') throw new IdentityError(400, 'SELECTION_REQUIRED', 'Válassz forrásverziót és világsablont.');
        const fingerprint = this.registry.lifecycle.fingerprint({ name, version, template });
        const replay = this.registry.lifecycle.replay(actor, requestKey as string, fingerprint); if (replay) return this.operation(actor, replay.id);
        if (version !== this.runtime.version || !worldTemplates.some(value => value.id === template)) throw new IdentityError(400, 'UNSUPPORTED_TEMPLATE', 'A kiválasztott verzió vagy sablon nem támogatott.');
        const operation = this.registry.lifecycle.create(actor, requestKey as string, fingerprint, { id: `srv-${randomUUID()}`, name, version, template });
        this.identities.initializeManagedOwnership(actor, operation.serverId);
        this.launch(operation); return this.operation(actor, operation.id);
    }
    action(actor: string, id: string, action: string, data: Record<string, unknown>) {
        this.owned(actor, id, ['start', 'stop', 'restart'].includes(action) ? 'operate' : 'owner');
        if (!['start', 'stop', 'restart', 'archive', 'backup', 'restore', 'migrate'].includes(action)) throw new IdentityError(404, 'ACTION_NOT_FOUND', 'Ismeretlen szerverművelet.');
        const payload: { backupId?: string; targetVersion?: string } = {};
        if (['backup', 'restore', 'migrate'].includes(action) && !this.runtime.backup) throw new IdentityError(409, 'MAINTENANCE_UNAVAILABLE', 'A runtime nem támogat karbantartást.');
        if (action === 'restore') {
            if (typeof data.backupId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.backupId)) throw new IdentityError(400, 'BACKUP_REQUIRED', 'Válassz világmentést.');
            payload.backupId = data.backupId;
        }
        if (action === 'migrate') {
            if (data.targetVersion !== this.runtime.version) throw new IdentityError(400, 'VERSION_UNSUPPORTED', 'Csak az aktuális helyi forrásverzió támogatott.');
            payload.targetVersion = data.targetVersion;
        }
        const fingerprint = this.registry.lifecycle.fingerprint({ id, action, revision: data.expectedRevision, ...payload });
        const replay = this.registry.lifecycle.replay(actor, data.requestKey as string, fingerprint); if (replay) return this.operation(actor, replay.id);
        if (this.busyServers.has(id)) throw new IdentityError(409, 'SERVER_BUSY', 'A szerveren már fut művelet.');
        const operation = this.registry.lifecycle.begin(actor, data.requestKey as string, fingerprint, id, action as Exclude<LifecycleAction, 'create'>, data.expectedRevision as number, payload);
        this.launch(operation); return this.operation(actor, operation.id);
    }
    private async reconcile(server: import('./lifecycle-store.js').ManagedServer) {
        const id = await this.runtime.pendingMaintenance?.(server);
        if (id) {
            const operation = this.registry.lifecycle.operation(id);
            if (!operation || operation.serverId !== server.serverId) throw new IdentityError(409, 'RECOVERY_REQUIRED', 'A karbantartási napló műveletkötése nem igazolható.');
            await this.runtime.recover?.(server, operation.state !== 'succeeded');
        }
    }
    private launch(operation: LifecycleOperation, recovery = false) {
        this.busyServers.add(operation.serverId);
        const job = (async () => {
            try {
                const server = this.registry.lifecycle.managed(operation.serverId)!;
                if (operation.action === 'create') this.identities.initializeManagedOwnership(server.creatorId, server.serverId);
                if (recovery) { await this.runtime.stop(server); await this.reconcile(server); throw new IdentityError(409, 'OPERATION_INTERRUPTED', 'Az admin újraindult a művelet közben. A folyamatot leállítottuk, a félbeszakadt cserét visszaállítottuk; ellenőrzés után indítsd újra.'); }
                await this.reconcile(server);
                let version: string | undefined;
                if (operation.action === 'create') await this.runtime.prepare(server);
                else {
                    if (operation.action !== 'start') await this.runtime.stop(server);
                    if (operation.action === 'start' || operation.action === 'restart') {
                        await this.runtime.prepare(server); await this.runtime.start(server);
                    }
                    const payload = this.registry.lifecycle.payload(operation.id);
                    if (operation.action === 'backup') await this.runtime.backup!(server, operation.id);
                    if (operation.action === 'restore') version = await this.runtime.restore!(server, payload.backupId!, operation.id);
                    if (operation.action === 'migrate') version = await this.runtime.migrate!(server, payload.targetVersion!, operation.id);
                }
                this.registry.lifecycle.finish(operation.id, operation.action === 'archive' ? 'archived' : ['start', 'restart'].includes(operation.action) ? 'running' : 'stopped', null, version);
                // SQL success is authoritative; a cleanup failure must never roll back a committed swap.
                try { await this.reconcile({ ...server, version: version ?? server.version }); } catch { /* retained journal is reconciled on admin restart */ }
            } catch (error) {
                let rollbackFailed = false;
                if (['restore', 'migrate'].includes(operation.action)) try { await this.reconcile(this.registry.lifecycle.managed(operation.serverId)!); } catch { rollbackFailed = true; }
                const message = rollbackFailed ? 'RECOVERY_REQUIRED: A visszaállítás nem fejeződött be. A karbantartási napló és mentések megmaradtak; indítás előtt helyreállítás szükséges.'
                    : error instanceof IdentityError ? `${error.code}: ${error.message}` : 'LIFECYCLE_FAILED: A művelet nem sikerült. A privát naplók és adatok megmaradtak.';
                this.registry.lifecycle.finish(operation.id, 'failed', message);
            }
        })();
        this.jobs.add(job); void job.finally(() => { this.jobs.delete(job); this.busyServers.delete(operation.serverId); });
    }
    recover() {
        const pending = this.registry.lifecycle.pending(), ids = new Set(pending.map(operation => operation.serverId));
        for (const operation of pending) this.launch(operation, true);
        for (const server of this.registry.lifecycle.all()) if (!ids.has(server.serverId) && this.runtime.recover) {
            const job = this.reconcile(server).catch(() => {
                // Keep the journal and require an explicit maintenance recovery; never start unverified state.
            });
            this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
        }
    }
    /** Three scheduled failures, never three browser reads. No automatic mutation/restart replay. */
    async supervise(now = Date.now()) {
        if (this.supervising) return;
        this.supervising = true;
        try {
            for (const server of this.registry.lifecycle.all()) {
                if (server.state !== 'running') { this.misses.delete(server.serverId); continue; }
                let healthy = false; try { healthy = await this.runtime.inspect(server) === 'running'; } catch { /* unavailable vault/control endpoint */ }
                const previous = this.misses.get(server.serverId);
                const count = healthy ? 0 : previous?.revision === server.revision ? previous.count + 1 : 1;
                this.misses.set(server.serverId, { revision: server.revision, count, checkedAt: now });
                if (count >= 3) this.registry.lifecycle.healthFailure(server.serverId, server.revision);
            }
        } finally { this.supervising = false; }
    }
    async idle() { await Promise.all([...this.jobs]); }
}
