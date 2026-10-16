import { randomUUID } from 'node:crypto';
import { IdentityError, type IdentityStore } from './identity-store.js';
import { worldTemplates, type ManagedRuntime } from './managed-runtime.js';
import type { ServerRegistry } from './server-registry.js';
import type { LifecycleAction, LifecycleOperation } from './lifecycle-store.js';

export class LifecycleManager {
    private jobs = new Set<Promise<void>>();
    constructor(private registry: ServerRegistry, private identities: IdentityStore, private runtime: ManagedRuntime) {}
    catalog() { return { versions: [{ id: this.runtime.version, label: `Helyi LostCity · ${this.runtime.version.slice(0, 8)}` }],
        templates: worldTemplates.map(({ id, label }) => ({ id, label })) }; }
    private owned(actor: string, id: string) {
        const server = this.registry.lifecycle.managed(id);
        if (!server || !this.identities.owns(actor, id)) throw new IdentityError(404, 'SERVER_NOT_FOUND', 'A kezelt szerver nem található.');
        return server;
    }
    async view(id: string) {
        const server = this.registry.lifecycle.managed(id); if (!server) return null;
        return { state: server.state, revision: server.revision, version: server.version, template: server.template, error: server.error,
            observedState: server.state === 'running' ? await this.runtime.inspect(server) : null };
    }
    async connection(actor: string, id: string) {
        const server = this.owned(actor, id);
        if (server.state !== 'running') return { gateway: false, engine: false };
        if (this.runtime.connection) return this.runtime.connection(server);
        const running = await this.runtime.inspect(server) === 'running';
        return { gateway: running, engine: running };
    }
    operation(actor: string, id: string) {
        const operation = this.registry.lifecycle.operation(id);
        if (!operation || !this.identities.owns(actor, operation.serverId)) throw new IdentityError(404, 'OPERATION_NOT_FOUND', 'A művelet nem található.');
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
        this.owned(actor, id);
        if (!['start', 'stop', 'restart', 'archive'].includes(action)) throw new IdentityError(404, 'ACTION_NOT_FOUND', 'Ismeretlen szerverművelet.');
        const fingerprint = this.registry.lifecycle.fingerprint({ id, action, revision: data.expectedRevision });
        const replay = this.registry.lifecycle.replay(actor, data.requestKey as string, fingerprint); if (replay) return this.operation(actor, replay.id);
        const operation = this.registry.lifecycle.begin(actor, data.requestKey as string, fingerprint, id, action as Exclude<LifecycleAction, 'create'>, data.expectedRevision as number);
        this.launch(operation); return this.operation(actor, operation.id);
    }
    private launch(operation: LifecycleOperation, recovery = false) {
        const job = (async () => {
            try {
                const server = this.registry.lifecycle.managed(operation.serverId)!;
                if (operation.action === 'create') this.identities.initializeManagedOwnership(server.creatorId, server.serverId);
                if (recovery) { await this.runtime.stop(server); throw new IdentityError(409, 'OPERATION_INTERRUPTED', 'Az admin újraindult a művelet közben. A folyamatot leállítottuk, az adatokat megőriztük; ellenőrzés után indítsd újra.'); }
                if (operation.action === 'create') await this.runtime.prepare(server);
                else {
                    if (operation.action !== 'start') await this.runtime.stop(server);
                    if (operation.action === 'start' || operation.action === 'restart') {
                        await this.runtime.prepare(server); await this.runtime.start(server);
                    }
                }
                this.registry.lifecycle.finish(operation.id, operation.action === 'archive' ? 'archived' : ['start', 'restart'].includes(operation.action) ? 'running' : 'stopped');
            } catch (error) {
                const message = error instanceof IdentityError ? `${error.code}: ${error.message}` : 'LIFECYCLE_FAILED: A művelet nem sikerült. A privát naplók és adatok megmaradtak.';
                this.registry.lifecycle.finish(operation.id, 'failed', message);
            }
        })();
        this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    }
    recover() { for (const operation of this.registry.lifecycle.pending()) this.launch(operation, true); }
    async idle() { await Promise.all([...this.jobs]); }
}
