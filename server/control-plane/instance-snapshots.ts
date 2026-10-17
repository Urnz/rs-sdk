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
async function hash(path: string) {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest('hex');
}
/** Exact tree inventory, including empty directories. Only the three dependency junctions are omitted. */
export async function inventory(root: string): Promise<SnapshotEntry[]> {
    await plainDirectory(root);
    const entries: SnapshotEntry[] = [];
    async function visit(relative: string) {
        for (const name of (await readdir(join(root, relative))).sort()) {
            const path = relative ? `${relative}/${name}` : name;
            if (dependencyTrees.includes(path)) continue;
            // Portable names also prevent Windows drive/ADS/path traversal in restored inventories.
            if (/[\\:\x00-\x1f]/.test(path) || name === '.' || name === '..') throw new Error('Invalid snapshot path.');
            const stat = await lstat(join(root, path));
            if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw new Error('Snapshot filesystem alias forbidden.');
            if (stat.isDirectory()) { entries.push({ path, sha256: null }); await visit(path); }
            else if (stat.isFile()) entries.push({ path, sha256: await hash(join(root, path)) });
            else throw new Error('Unsupported snapshot entry.');
        }
    }
    await visit(''); return entries;
}
export async function copyInventory(source: string, destination: string, entries: SnapshotEntry[]) {
    await mkdir(destination, { mode: 0o700 });
    for (const entry of entries) {
        // Never trust a manifest as a filesystem path authority.
        if (!entry.path || /[\\:\x00-\x1f]/.test(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..')
            || !resolve(destination, entry.path).startsWith(resolve(destination) + (process.platform === 'win32' ? '\\' : '/')))
            throw new Error('Invalid snapshot entry.');
        const target = join(destination, entry.path);
        if (entry.sha256 === null) await mkdir(target, { recursive: true, mode: 0o700 });
        else { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await copyFile(join(source, entry.path), target); }
    }
    if (JSON.stringify(await inventory(destination)) !== JSON.stringify(entries)) throw new Error('Snapshot copy verification failed.');
}
export async function readJson(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Maintenance metadata alias forbidden.');
    return JSON.parse(await readFile(path, 'utf8'));
}
