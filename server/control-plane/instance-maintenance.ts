import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedServer } from './lifecycle-store.js';
import { verifyInstanceBinding } from './instance-files.js';
import { atomicJson, copyInventory, inventory, plainDirectory, readJson, type SnapshotEntry } from './instance-snapshots.js';

export const instanceBinding = (server: ManagedServer) => ({ id: server.serverId, version: server.version, template: server.template, ports: server.ports });
export interface WorldBackup { id: string; version: string; createdAt: number }
interface BackupManifest extends WorldBackup { schemaVersion: 1; binding: ReturnType<typeof instanceBinding>; files: SnapshotEntry[]; prepared: Record<string, unknown> }
const uuid = (value: string) => { if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid maintenance identifier.'); return value; };

/** Offline, same-path/same-OS-user recovery. Secrets remain in the OS vault and are never exported. */
export class InstanceMaintenance {
    constructor(private dir: string, private attachDependencies: (workspace: string) => Promise<void>) {}
    private async root() { await plainDirectory(this.dir); await plainDirectory(join(this.dir, 'workspace')); }
    private async backupsRoot() {
        await this.root(); await mkdir(join(this.dir, 'backups'), { recursive: true, mode: 0o700 });
        await plainDirectory(join(this.dir, 'backups')); return join(this.dir, 'backups');
    }
    async backup(server: ManagedServer, id: string): Promise<WorldBackup> {
        const root = await this.backupsRoot(), path = join(root, uuid(id)), workspace = join(this.dir, 'workspace');
        await verifyInstanceBinding(workspace, instanceBinding(server));
        if (existsSync(path)) { const previous = await this.verify(server, id); return previous; }
        const partial = join(root, `${id}.partial`);
        await mkdir(partial, { mode: 0o700 });
        const prepared = await readJson(join(this.dir, 'prepared.json'));
        if (prepared.isolationVersion !== 1 || JSON.stringify(prepared.binding) !== JSON.stringify(instanceBinding(server))) throw new Error('Prepared backup binding mismatch.');
        const files = await inventory(workspace);
        await copyInventory(workspace, join(partial, 'workspace'), files);
        // Also detect changes to source files while copying; callers must have stopped all owned writers.
        if (JSON.stringify(await inventory(workspace)) !== JSON.stringify(files)) throw new Error('World changed during backup.');
        const manifest: BackupManifest = { schemaVersion: 1, id, version: server.version, createdAt: Date.now(), binding: instanceBinding(server), files, prepared };
        await atomicJson(join(partial, 'manifest.json'), manifest); await rename(partial, path);
        return { id, version: manifest.version, createdAt: manifest.createdAt };
    }
    private async verify(server: ManagedServer, id: string): Promise<BackupManifest> {
        const path = join(await this.backupsRoot(), uuid(id)); await plainDirectory(path);
        const manifest = await readJson(join(path, 'manifest.json')) as BackupManifest;
        if (manifest.schemaVersion !== 1 || manifest.id !== id || !/^[a-f0-9]{40}$/.test(manifest.version)
            || JSON.stringify(manifest.binding) !== JSON.stringify(instanceBinding({ ...server, version: manifest.version }))
            || manifest.prepared.isolationVersion !== 1 || JSON.stringify(manifest.prepared.binding) !== JSON.stringify(manifest.binding)
            || JSON.stringify(await inventory(join(path, 'workspace'))) !== JSON.stringify(manifest.files)) throw new Error('Backup integrity or world binding mismatch.');
        return manifest;
    }
    async list(server: ManagedServer): Promise<WorldBackup[]> {
        const { readdir } = await import('node:fs/promises'), root = await this.backupsRoot(), result: WorldBackup[] = [];
        for (const id of await readdir(root)) if (/^[a-f0-9-]{36}$/.test(id)) {
            // Listing does not hash large saves. A restore always verifies the complete inventory.
            await plainDirectory(join(root, id));
            const manifest = await readJson(join(root, id, 'manifest.json')) as BackupManifest;
            if (manifest.schemaVersion !== 1 || manifest.id !== id || manifest.binding.id !== server.serverId) throw new Error('Backup catalog binding mismatch.');
            result.push({ id, version: manifest.version, createdAt: manifest.createdAt });
        }
        return result.sort((a, b) => b.createdAt - a.createdAt);
    }
    async restore(server: ManagedServer, id: string, operationId: string) {
        const manifest = await this.verify(server, id), stage = join(this.dir, `stage-${uuid(operationId)}`);
        await copyInventory(join(this.dir, 'backups', id, 'workspace'), stage, manifest.files);
        await this.attachDependencies(stage);
        await this.replace(server, stage, manifest.prepared, operationId);
        return manifest.version;
    }
    async replace(server: ManagedServer, stage: string, prepared: Record<string, unknown>, operationId: string) {
        const id = uuid(operationId), workspace = join(this.dir, 'workspace');
        if (stage !== join(this.dir, `stage-${id}`)) throw new Error('Invalid staging directory.');
        await this.root(); await plainDirectory(stage);
        if (existsSync(join(this.dir, 'maintenance.json'))) throw new Error('Unreconciled maintenance journal.');
        const before = await readJson(join(this.dir, 'prepared.json'));
        await atomicJson(join(this.dir, 'maintenance.json'), { schemaVersion: 1, operationId: id, before, after: prepared });
        await rename(workspace, join(this.dir, `retired-${id}`));
        await rename(stage, workspace);
        await atomicJson(join(this.dir, 'prepared.json'), prepared);
    }
    /** Pending operation => roll back. Completed SQL operation => keep the installed snapshot. */
    async recover(interrupted: boolean) {
        await plainDirectory(this.dir);
        const path = join(this.dir, 'maintenance.json'); if (!existsSync(path)) return;
        const journal = await readJson(path), id = uuid(journal.operationId);
        if (journal.schemaVersion !== 1) throw new Error('Unsupported maintenance journal.');
        const retired = join(this.dir, `retired-${id}`), workspace = join(this.dir, 'workspace');
        if (interrupted && existsSync(retired)) {
            await plainDirectory(retired);
            if (existsSync(workspace)) { await plainDirectory(workspace); await rename(workspace, join(this.dir, `aborted-${id}`)); }
            await rename(retired, workspace);
        }
        if (interrupted) await atomicJson(join(this.dir, 'prepared.json'), journal.before);
        await rm(path);
    }
}
