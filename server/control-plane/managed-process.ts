import { resolve } from 'node:path';

/** The Windows launcher owns the real Process handle until authenticated readiness is accepted. */
export function spawnManagedProcess(input: { executable: string; worker: string; cwd: string; environment: Record<string, string>; stdout: string; stderr: string; launchError: string }) {
    const host = Bun.spawn(['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(import.meta.dir, 'windows-managed-process.ps1')], {
        env: Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
        stdin: 'pipe', stdout: 'ignore', stderr: Bun.file(input.launchError), windowsHide: true
    });
    host.stdin.write(JSON.stringify(input) + '\n'); void host.stdin.flush();
    const command = async (value: 'release' | 'abort') => {
        try { host.stdin.write(value + '\n'); await host.stdin.flush(); host.stdin.end(); }
        catch { /* A failed launcher has already released its owned child in finally. */ }
        return host.exited;
    };
    return { get exitCode() { return host.exitCode; }, exited: host.exited,
        async release() { if (await command('release') !== 0) throw new Error('Managed process handoff failed.'); },
        async kill() { await command('abort'); } };
}
