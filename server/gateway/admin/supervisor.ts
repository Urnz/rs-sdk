import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activeSkillsDir, adminLogsDir, botsDir, repoRoot, webclientDir } from './paths';
import type { ManagedProcessSnapshot } from './types';

export interface SpawnBotOptions {
    username: string;
    password?: string;
    server?: string;
    rememberCredentials?: boolean;
}

type ManagedProcess = {
    process: ReturnType<typeof Bun.spawn>;
    snapshot: ManagedProcessSnapshot;
    logPath: string;
};

function assertUsername(username: string): string {
    const value = username.trim();
    if (!/^[a-zA-Z0-9]{1,12}$/.test(value)) {
        throw new Error('A bot neve 1–12 alfanumerikus karakter lehet.');
    }
    return value;
}

async function readBotEnvironment(username: string): Promise<Record<string, string>> {
    try {
        const text = await readFile(join(botsDir, username, 'bot.env'), 'utf8');
        return Object.fromEntries(text.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.includes('='))
            .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
    } catch {
        return {};
    }
}

export class BotSupervisor {
    private readonly processes = new Map<string, ManagedProcess>();

    constructor(private readonly requestDisconnect: (username: string, reason: string) => boolean) {}

    snapshot(username: string): ManagedProcessSnapshot | null {
        return this.processes.get(username.toLowerCase())?.snapshot ?? null;
    }

    list(): Map<string, ManagedProcessSnapshot> {
        return new Map([...this.processes].map(([name, managed]) => [name, managed.snapshot]));
    }

    async spawn(options: SpawnBotOptions): Promise<ManagedProcessSnapshot> {
        const username = assertUsername(options.username);
        const key = username.toLowerCase();
        const current = this.processes.get(key);
        if (current && (current.snapshot.status === 'starting' || current.snapshot.status === 'running')) {
            throw new Error(`${username} már fut vagy éppen indul.`);
        }

        const stored = await readBotEnvironment(username);
        const password = options.password?.trim() || stored.PASSWORD;
        if (!password) throw new Error('Ehhez a bothoz spawnkor jelszó szükséges.');
        const server = options.server?.trim() || stored.SERVER || 'localhost:8888';

        if (options.rememberCredentials) {
            const botDir = join(botsDir, username);
            await mkdir(botDir, { recursive: true });
            await writeFile(join(botDir, 'bot.env'), [
                `BOT_USERNAME=${username}`,
                `PASSWORD=${password}`,
                `SERVER=${server}`,
                'GATEWAY_URL=ws://localhost:7780',
                'SHOW_CHAT=true',
                'TELEMETRY=true',
                ''
            ].join('\n'), 'utf8');
        }

        const startedAt = new Date().toISOString();
        const logDirectory = join(adminLogsDir, key);
        await mkdir(logDirectory, { recursive: true });
        const logPath = join(logDirectory, `${startedAt.replace(/[:.]/g, '-')}.log`);
        const logFile = Bun.file(logPath);
        const child = Bun.spawn([
            process.execPath,
            'run',
            'src/lite/runner.ts',
            username
        ], {
            cwd: webclientDir,
            env: {
                ...process.env,
                BOT_USERNAME: username,
                PASSWORD: password,
                SERVER: server,
                GATEWAY_URL: process.env.GATEWAY_URL || 'ws://localhost:7780'
            },
            stdout: logFile,
            stderr: logFile
        });

        const snapshot: ManagedProcessSnapshot = {
            status: 'starting',
            pid: child.pid,
            startedAt,
            exitCode: null
        };
        this.processes.set(key, { process: child, snapshot, logPath });
        setTimeout(() => {
            const active = this.processes.get(key);
            if (active?.process === child && active.snapshot.status === 'starting') active.snapshot.status = 'running';
        }, 500);

        void child.exited.then(exitCode => {
            const active = this.processes.get(key);
            if (!active || active.process !== child) return;
            active.snapshot.exitCode = exitCode;
            active.snapshot.pid = null;
            active.snapshot.status = exitCode === 0 ? 'exited' : 'error';
            if (exitCode !== 0) active.snapshot.error = `A botfolyamat ${exitCode} kóddal leállt. Napló: ${logPath}`;
        });
        return snapshot;
    }

    async despawn(usernameInput: string, reason: string): Promise<ManagedProcessSnapshot | null> {
        const username = assertUsername(usernameInput);
        const key = username.toLowerCase();
        const managed = this.processes.get(key);
        if (managed) managed.snapshot.status = 'stopping';

        const requested = this.requestDisconnect(username, reason);
        if (!requested && !managed) throw new Error(`${username} nincs online és nem admin által indított folyamat.`);

        if (managed) {
            setTimeout(() => {
                if (managed.process.exitCode === null) managed.process.kill();
            }, 8_000);
        }
        return managed?.snapshot ?? null;
    }

    async restart(options: SpawnBotOptions, reason: string): Promise<ManagedProcessSnapshot> {
        try {
            await this.despawn(options.username, reason);
            await Bun.sleep(1_500);
        } catch (error) {
            if (!String(error).includes('nincs online')) throw error;
        }
        return this.spawn(options);
    }

    async stopSkill(usernameInput: string): Promise<boolean> {
        const username = assertUsername(usernameInput).toLowerCase();
        const marker = join(activeSkillsDir, `${username}.json`);
        const contents = await Bun.file(marker).json().catch(() => null) as { pid?: number } | null;
        if (!contents?.pid) return false;
        try {
            process.kill(contents.pid, 'SIGTERM');
            return true;
        } catch {
            return false;
        }
    }
}

export { assertUsername, readBotEnvironment };
