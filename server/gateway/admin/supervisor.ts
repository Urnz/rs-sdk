import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activeSkillsDir, adminLogsDir, adminSkillLogsDir, botsDir, repoRoot, webclientDir } from './paths';
import type { ManagedProcessSnapshot, ManagedSkillRunSnapshot } from './types';
import type { SkillRuntimeAuthorization } from '../../../agent-skills/types';

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

type ManagedSkillProcess = {
    process: ReturnType<typeof Bun.spawn>;
    snapshot: ManagedSkillRunSnapshot;
};

interface ActiveSkillMarker {
    username: string;
    skillId: string;
    version: string;
    runId: string;
    startedAt: string;
    heartbeatAt: string;
    progressAt: string;
    progressSequence: number;
    pid: number;
}

export interface SkillMarkerReconciliation {
    username: string;
    status: 'adopted' | 'managed' | 'stalled' | 'stale-removed' | 'unverified';
    reason: string;
    snapshot: ManagedSkillRunSnapshot | null;
}

export interface ManagedSkillExitEvent {
    username: string;
    snapshot: ManagedSkillRunSnapshot;
}

export function isActiveSkillSnapshot(snapshot: ManagedSkillRunSnapshot | null):
    snapshot is ManagedSkillRunSnapshot {
    return !!snapshot && (snapshot.status === 'starting' || snapshot.status === 'running'
        || snapshot.status === 'stopping');
}

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
    private readonly skillProcesses = new Map<string, ManagedSkillProcess>();
    private readonly adoptedSkillProcesses = new Map<string, ManagedSkillRunSnapshot>();
    private readonly skillStarts = new Set<string>();
    private readonly skillExitHandlers = new Set<(event: ManagedSkillExitEvent) => void>();

    constructor(
        private readonly requestDisconnect: (username: string, reason: string) => boolean,
        private readonly pause: (milliseconds: number) => Promise<unknown> = milliseconds => Bun.sleep(milliseconds),
        private readonly isProcessAlive: (pid: number) => boolean = pid => {
            try { process.kill(pid, 0); return true; }
            catch { return false; }
        },
        private readonly skillMarkerDirectory = activeSkillsDir,
        private readonly loadBotEnvironment: (username: string) => Promise<Record<string, string>> = readBotEnvironment,
        private readonly terminateProcess: (pid: number) => void = pid => process.kill(pid, 'SIGTERM')
    ) {}

    snapshot(username: string): ManagedProcessSnapshot | null {
        return this.processes.get(username.toLowerCase())?.snapshot ?? null;
    }

    list(): Map<string, ManagedProcessSnapshot> {
        return new Map([...this.processes].map(([name, managed]) => [name, managed.snapshot]));
    }

    skillSnapshot(username: string): ManagedSkillRunSnapshot | null {
        const key = username.toLowerCase();
        return this.skillProcesses.get(key)?.snapshot ?? this.adoptedSkillProcesses.get(key) ?? null;
    }

    activeSkillSnapshot(username: string): ManagedSkillRunSnapshot | null {
        const snapshot = this.skillSnapshot(username);
        return isActiveSkillSnapshot(snapshot) ? snapshot : null;
    }

    async reconcileSkillMarkers(now = new Date().toISOString(), maximumHeartbeatAgeMs = 15_000,
        maximumProgressAgeMs = 5 * 60_000): Promise<SkillMarkerReconciliation[]> {
        const currentTime = Date.parse(now);
        if (Number.isNaN(currentTime)) throw new Error('Skill marker reconciliation time must be an ISO timestamp');
        if (!Number.isInteger(maximumHeartbeatAgeMs) || maximumHeartbeatAgeMs < 5_000
            || maximumHeartbeatAgeMs > 5 * 60_000) throw new Error('Skill marker heartbeat age is out of range');
        if (!Number.isInteger(maximumProgressAgeMs) || maximumProgressAgeMs < 30_000
            || maximumProgressAgeMs > 15 * 60_000) throw new Error('Skill marker progress age is out of range');
        const files = await readdir(this.skillMarkerDirectory).catch(() => []);
        const seen = new Set<string>();
        const results: SkillMarkerReconciliation[] = [];
        for (const file of files.filter(name => /^[a-z0-9]{1,12}\.json$/i.test(name)).sort()) {
            const key = file.slice(0, -5).toLowerCase();
            seen.add(key);
            const markerPath = join(this.skillMarkerDirectory, file);
            const raw = await Bun.file(markerPath).json().catch(() => null) as Partial<ActiveSkillMarker> | null;
            const valid = raw && typeof raw.username === 'string' && raw.username.toLowerCase() === key
                && typeof raw.skillId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(raw.skillId)
                && typeof raw.version === 'string' && /^\d+\.\d+\.\d+$/.test(raw.version)
                && typeof raw.runId === 'string'
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.runId)
                && typeof raw.pid === 'number' && Number.isSafeInteger(raw.pid) && raw.pid > 0
                && typeof raw.startedAt === 'string' && !Number.isNaN(Date.parse(raw.startedAt))
                && typeof raw.heartbeatAt === 'string' && !Number.isNaN(Date.parse(raw.heartbeatAt))
                && typeof raw.progressAt === 'string' && !Number.isNaN(Date.parse(raw.progressAt))
                && typeof raw.progressSequence === 'number' && Number.isSafeInteger(raw.progressSequence)
                && raw.progressSequence >= 0;
            if (!valid) {
                this.adoptedSkillProcesses.delete(key);
                results.push({ username: key, status: 'unverified',
                    reason: 'Marker contents are invalid, pre-heartbeat, or pre-progress.', snapshot: null });
                continue;
            }
            const marker = raw as ActiveSkillMarker;
            if (!this.isProcessAlive(marker.pid)) {
                this.adoptedSkillProcesses.delete(key);
                await unlink(markerPath).catch(() => undefined);
                const snapshot: ManagedSkillRunSnapshot = { runId: marker.runId, status: 'error', pid: null,
                    skill: `${marker.skillId}@${marker.version}`, startedAt: marker.startedAt, exitCode: null,
                    logPath: join(adminSkillLogsDir, key), error: 'Marker PID is no longer alive.' };
                results.push({ username: key, status: 'stale-removed',
                    reason: 'Marker PID is no longer alive.', snapshot });
                continue;
            }
            const heartbeatTime = Date.parse(marker.heartbeatAt);
            const progressTime = Date.parse(marker.progressAt);
            const heartbeatInvalid = currentTime - heartbeatTime > maximumHeartbeatAgeMs
                || heartbeatTime > currentTime + 5_000;
            const progressInvalid = currentTime - progressTime > maximumProgressAgeMs
                || progressTime > currentTime + 5_000;
            const managedProcess = this.skillProcesses.get(key);
            const managed = managedProcess?.snapshot;
            if (heartbeatInvalid || progressInvalid) {
                const reason = heartbeatInvalid
                    ? 'Live PID has no fresh trusted skill heartbeat.'
                    : 'Live PID exceeded the journal progress deadline.';
                const snapshot: ManagedSkillRunSnapshot = managed?.pid === marker.pid && managed.runId === marker.runId
                    ? managed
                    : { runId: marker.runId, status: 'stopping', pid: marker.pid,
                        skill: `${marker.skillId}@${marker.version}`, startedAt: marker.startedAt, exitCode: null,
                        logPath: join(adminSkillLogsDir, key) };
                snapshot.status = 'stopping';
                snapshot.heartbeatAt = marker.heartbeatAt;
                snapshot.progressAt = marker.progressAt;
                snapshot.progressSequence = marker.progressSequence;
                snapshot.error = reason;
                this.adoptedSkillProcesses.set(key, snapshot);
                try {
                    if (managedProcess?.snapshot === snapshot) managedProcess.process.kill();
                    else this.terminateProcess(marker.pid);
                } catch { /* The next reconciliation proves whether the PID exited. */ }
                results.push({ username: key, status: 'stalled', reason, snapshot });
                continue;
            }
            if (managed?.pid === marker.pid && managed.runId === marker.runId) {
                managed.heartbeatAt = marker.heartbeatAt;
                managed.progressAt = marker.progressAt;
                managed.progressSequence = marker.progressSequence;
                results.push({ username: key, status: 'managed',
                    reason: 'Skill process has a fresh heartbeat and journal progress.', snapshot: managed });
                continue;
            }
            const snapshot: ManagedSkillRunSnapshot = { runId: marker.runId, status: 'running', pid: marker.pid,
                skill: `${marker.skillId}@${marker.version}`, startedAt: marker.startedAt, exitCode: null,
                logPath: join(adminSkillLogsDir, key), heartbeatAt: marker.heartbeatAt,
                progressAt: marker.progressAt, progressSequence: marker.progressSequence };
            this.adoptedSkillProcesses.set(key, snapshot);
            results.push({ username: key, status: 'adopted',
                reason: 'Fresh heartbeat and journal progress were adopted.', snapshot });
        }
        for (const key of this.adoptedSkillProcesses.keys()) if (!seen.has(key)) this.adoptedSkillProcesses.delete(key);
        return results;
    }

    onSkillExit(handler: (event: ManagedSkillExitEvent) => void): () => void {
        this.skillExitHandlers.add(handler);
        return () => this.skillExitHandlers.delete(handler);
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
            await this.pause(1_500);
        } catch (error) {
            if (!String(error).includes('nincs online')) throw error;
        }
        return this.spawn(options);
    }

    async stopSkill(usernameInput: string): Promise<boolean> {
        const username = assertUsername(usernameInput).toLowerCase();
        const managed = this.skillProcesses.get(username);
        if (!managed) await this.reconcileSkillMarkers();
        const adopted = this.adoptedSkillProcesses.get(username);
        const pid = managed?.snapshot.pid ?? adopted?.pid;
        if (!pid) return false;
        try {
            if (managed) managed.snapshot.status = 'stopping';
            if (adopted) adopted.status = 'stopping';
            process.kill(pid, 'SIGTERM');
            return true;
        } catch {
            return false;
        }
    }

    async startSkill(
        usernameInput: string,
        skill: string,
        parameters: Record<string, string | number | boolean>,
        options: { allowDraft?: boolean; runId?: string; runtimeAuthorization?: SkillRuntimeAuthorization } = {}
    ): Promise<ManagedSkillRunSnapshot> {
        const username = assertUsername(usernameInput);
        const key = username.toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+$/i.test(skill)) throw new Error('Érvénytelen skill hivatkozás.');
        if (this.skillStarts.has(key)) throw new Error(`${username} agent skill indítása már folyamatban van.`);
        this.skillStarts.add(key);
        try {
        const current = this.skillProcesses.get(key);
        const adopted = this.adoptedSkillProcesses.get(key);
        if (current && (current.snapshot.status === 'starting' || current.snapshot.status === 'running' || current.snapshot.status === 'stopping')) {
            throw new Error(`${username} már futtat agent skillt.`);
        }
        if (adopted?.status === 'running') throw new Error(`${username} már futtat adoptált agent skillt.`);
        const markerPath = join(this.skillMarkerDirectory, `${key}.json`);
        const marker = await Bun.file(markerPath).json().catch(() => null) as { pid?: number } | null;
        if (marker?.pid) {
            try {
                process.kill(marker.pid, 0);
                throw new Error(`${username} már futtat agent skillt.`);
            } catch (error) {
                if (error instanceof Error && error.message.includes('már futtat')) throw error;
            }
        }

        const stored = await this.loadBotEnvironment(username);
        if (!stored.PASSWORD) throw new Error('Skill indításához a bot helyi bot.env hitelesítő adata szükséges.');
        const startedAt = new Date().toISOString();
        const logDirectory = join(adminSkillLogsDir, key);
        await mkdir(logDirectory, { recursive: true });
        await mkdir(this.skillMarkerDirectory, { recursive: true });
        const logPath = join(logDirectory, `${startedAt.replace(/[:.]/g, '-')}.log`);
        const args = [process.execPath, 'run', 'agent-skills/run.ts', username, skill];
        if (options.allowDraft) args.push('--allow-draft');
        const runId = options.runId ?? crypto.randomUUID();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
            throw new Error('Érvénytelen skill run ID.');
        }
        args.push(`--run-id=${runId}`);
        if (options.runtimeAuthorization) {
            const encoded = Buffer.from(JSON.stringify(options.runtimeAuthorization), 'utf8').toString('base64url');
            if (encoded.length > 16_384) throw new Error('A runtime authorization túl nagy.');
            args.push(`--runtime-authorization=${encoded}`);
        }
        for (const [name, value] of Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))) {
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                throw new Error(`Nem támogatott skill paraméter: ${name}`);
            }
            args.push(`--param=${name}=${String(value)}`);
        }
        const logFile = Bun.file(logPath);
        const child = Bun.spawn(args, {
            cwd: repoRoot,
            env: {
                ...process.env,
                ...stored,
                BOT_USERNAME: stored.BOT_USERNAME || username,
                GATEWAY_URL: stored.GATEWAY_URL || process.env.GATEWAY_URL || 'ws://localhost:7780'
            },
            stdout: logFile,
            stderr: logFile
        });
        const snapshot: ManagedSkillRunSnapshot = {
            runId, status: 'starting', pid: child.pid, skill, startedAt, exitCode: null, logPath
        };
        this.skillProcesses.set(key, { process: child, snapshot });
        const separator = skill.lastIndexOf('@');
        await writeFile(markerPath, JSON.stringify({
            username,
            skillId: skill.slice(0, separator),
            version: skill.slice(separator + 1),
            runId,
            startedAt,
            heartbeatAt: startedAt,
            progressAt: startedAt,
            progressSequence: 0,
            pid: child.pid
        }, null, 2), 'utf8');
        setTimeout(() => {
            const active = this.skillProcesses.get(key);
            if (active?.process === child && active.snapshot.status === 'starting') active.snapshot.status = 'running';
        }, 500);
        void child.exited.then(async exitCode => {
            const active = this.skillProcesses.get(key);
            if (!active || active.process !== child) return;
            active.snapshot.exitCode = exitCode;
            active.snapshot.pid = null;
            active.snapshot.status = exitCode === 0 ? 'exited' : (active.snapshot.status === 'stopping' ? 'exited' : 'error');
            if (exitCode !== 0 && active.snapshot.status === 'error') {
                active.snapshot.error = `A skillfolyamat ${exitCode} kóddal leállt. Napló: ${logPath}`;
            }
            const currentMarker = await Bun.file(markerPath).json().catch(() => null) as { pid?: number } | null;
            if (currentMarker?.pid === child.pid) await unlink(markerPath).catch(() => undefined);
            const event = { username: key, snapshot: structuredClone(active.snapshot) };
            for (const handler of this.skillExitHandlers) {
                try { handler(event); }
                catch (error) { console.error('[AgentReplan] Skill exit handler failed:', error); }
            }
        });
        return snapshot;
        } finally { this.skillStarts.delete(key); }
    }
}

export { assertUsername, readBotEnvironment };
