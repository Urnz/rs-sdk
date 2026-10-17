import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const dependencyTrees = ['node_modules', 'server/engine/node_modules', 'server/webclient/node_modules'];
export interface SnapshotEntry { path: string; sha256: string | null }
export async function plainDirectory(path: string) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Maintenance directory alias forbidden.');
}
export async function atomicJson(path: string, value: unknown) {
    const temporary = `${path}.tmp-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
}
async function hash(path: string, size: number) {
    if (size <= 8 * 1024 * 1024) return createHash('sha256').update(await readFile(path)).digest('hex');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest('hex');
}
async function batches<T, R>(values: T[], action: (value: T) => Promise<R>): Promise<R[]> {
    const result: R[] = [];
    for (let index = 0; index < values.length; index += 16) {
        const settled = await Promise.allSettled(values.slice(index, index + 16).map(action));
        const failure = settled.find(value => value.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        for (const value of settled) if (value.status === 'fulfilled') result.push(value.value);
    }
    return result;
}
function boundedIO() {
    let active = 0; const queue: (() => void)[] = [];
    return async <T>(action: () => Promise<T>): Promise<T> => {
        await new Promise<void>(resolve => { if (active < 16) { active++; resolve(); } else queue.push(resolve); });
        try { return await action(); }
        finally { const next = queue.shift(); if (next) next(); else active--; }
    };
}
async function settled<T>(values: Promise<T>[]): Promise<T[]> {
    const result = await Promise.allSettled(values), failure = result.find(value => value.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return result.map(value => (value as PromiseFulfilledResult<T>).value);
}
/** Exact tree inventory, including empty directories. Only the three dependency junctions are omitted. */
export async function inventory(root: string): Promise<SnapshotEntry[]> {
    root = resolve(root);
    await plainDirectory(root);
    const io = boundedIO();
    async function visit(relative: string): Promise<SnapshotEntry[]> {
        const names = (await io(() => readdir(join(root, relative)))).sort();
        const children = await settled(names.map(name => io(async () => {
            const path = relative ? `${relative}/${name}` : name;
            if (dependencyTrees.includes(path)) return null;
            // Portable names also prevent Windows drive/ADS/path traversal in restored inventories.
            if (/[\\:\x00-\x1f]/.test(path) || name === '.' || name === '..') throw new Error('Invalid snapshot path.');
            const stat = await lstat(join(root, path));
            if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw new Error('Snapshot filesystem alias forbidden.');
            if (!stat.isDirectory() && !stat.isFile()) throw new Error('Unsupported snapshot entry.');
            return { path, sha256: stat.isDirectory() ? null : await hash(join(root, path), stat.size) };
        })));
        return (await settled(children.map(async child => child === null ? [] : child.sha256 === null ? [child, ...await visit(child.path)] : [child]))).flat();
    }
    return visit('');
}
export async function copyInventory(source: string, destination: string, entries: SnapshotEntry[]) {
    source = resolve(source); destination = resolve(destination);
    for (const entry of entries) {
        // Never trust a manifest as a filesystem path authority.
        if (!entry.path || /[\\:\x00-\x1f]/.test(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..')
            || !resolve(destination, entry.path).startsWith(resolve(destination) + (process.platform === 'win32' ? '\\' : '/')))
            throw new Error('Invalid snapshot entry.');
    }
    await mkdir(destination, { mode: 0o700 });
    await batches(entries, async entry => {
        const target = join(destination, entry.path);
        if (entry.sha256 === null) await mkdir(target, { recursive: true, mode: 0o700 });
        else { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await copyFile(join(source, entry.path), target); }
    });
    if (JSON.stringify(await inventory(destination)) !== JSON.stringify(entries)) throw new Error('Snapshot copy verification failed.');
}
export async function readJson(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Maintenance metadata alias forbidden.');
    return JSON.parse(await readFile(path, 'utf8'));
}
