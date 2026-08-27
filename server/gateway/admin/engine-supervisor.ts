import { join } from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { repoRoot } from './paths';

export interface EngineRestartResult {
    ok: true;
    previousPid: number;
    pid: number;
    restartedAt: string;
    logDirectory: string;
}

type RestartExecutor = () => Promise<{ exitCode: number; stdout: string; stderr: string }>;

let restartInProgress = false;

async function defaultExecutor(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const resultDirectory = join(repoRoot, '.local', 'admin', 'engine-restarts');
    const resultPath = join(resultDirectory, `${crypto.randomUUID()}.json`);
    await mkdir(resultDirectory, { recursive: true });
    const child = Bun.spawn([
        'pwsh.exe', '-NoProfile', '-NonInteractive', '-File',
        join(repoRoot, 'scripts', 'restart-engine.ps1'),
        '-GatewayPid', String(process.pid),
        '-ResultPath', resultPath
    ], {
        cwd: repoRoot,
        env: process.env,
        stdout: 'ignore',
        stderr: 'ignore'
    });
    const exitCode = await child.exited;
    const stdout = await readFile(resultPath, 'utf8').catch(() => '');
    await unlink(resultPath).catch(() => undefined);
    return { exitCode, stdout, stderr: exitCode === 0 ? '' : 'Az engine restart segéd hibával leállt.' };
}

export async function restartLocalEngine(executor: RestartExecutor = defaultExecutor): Promise<EngineRestartResult> {
    if (restartInProgress) throw new Error('Az engine újraindítása már folyamatban van.');
    restartInProgress = true;
    try {
        const result = await executor();
        if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Az engine restart ${result.exitCode} kóddal leállt.`);
        const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        const parsed = line ? JSON.parse(line) as Partial<EngineRestartResult> : null;
        if (!parsed?.ok || !Number.isInteger(parsed.previousPid) || !Number.isInteger(parsed.pid)
            || typeof parsed.restartedAt !== 'string' || typeof parsed.logDirectory !== 'string') {
            throw new Error('Az engine restart érvénytelen eredményt adott.');
        }
        return parsed as EngineRestartResult;
    } finally {
        restartInProgress = false;
    }
}
