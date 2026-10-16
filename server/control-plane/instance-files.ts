import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export const instanceMutableTrees = ['.local', 'bots', 'config', 'server/engine/data', 'server/webclient/out'] as const;
/** Do not follow filesystem aliases from a mutable world into another world or the host. */
export async function assertPrivateInstanceTree(workspace: string) {
    const visit = async (path: string): Promise<void> => {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error('Instance mutable state contains a filesystem alias.');
        if (stat.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name));
    };
    if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Instance workspace cannot be a filesystem alias.');
    for (const relative of instanceMutableTrees) {
        try { await visit(join(workspace, relative)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
}

export async function verifyInstanceBinding(workspace: string, expected: { id: string; version: string; template: string; ports: number[] }) {
    const binding = JSON.parse(await readFile(join(workspace, '.local/instance.json'), 'utf8'));
    if (binding.schemaVersion !== 1 || JSON.stringify(binding.binding) !== JSON.stringify(expected)
        || await realpath(workspace) !== await realpath(binding.workspace)) throw new Error('Instance isolation binding mismatch.');
    await assertPrivateInstanceTree(workspace);
}
