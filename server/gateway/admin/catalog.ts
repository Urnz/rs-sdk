import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { activeSkillsDir, botsDir, economyLogPath, playerSavesDir } from './paths';
import { readPlayerSave } from './save-reader';
import type {
    AdminItem,
    BotCatalogEntry,
    EconomySnapshot,
    GatewayBotSnapshot,
    ManagedProcessSnapshot,
    OfflineSaveSnapshot
} from './types';

type ActiveSkill = {
    username: string;
    skillId: string;
    version: string;
    runId: string;
    startedAt: string;
    pid: number;
};

async function listFiles(directory: string, suffix = ''): Promise<string[]> {
    try {
        return (await readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

async function managedBotNames(): Promise<string[]> {
    try {
        const entries = await readdir(botsDir, { withFileTypes: true });
        const names: string[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === '_template') continue;
            if (await Bun.file(join(botsDir, entry.name, 'bot.env')).exists()) names.push(entry.name);
        }
        return names;
    } catch {
        return [];
    }
}

async function activeSkills(): Promise<Map<string, ActiveSkill>> {
    const result = new Map<string, ActiveSkill>();
    for (const file of await listFiles(activeSkillsDir, '.json')) {
        try {
            const marker = JSON.parse(await readFile(join(activeSkillsDir, file), 'utf8')) as ActiveSkill;
            if (!marker.username || !marker.skillId || !marker.pid) continue;
            try {
                process.kill(marker.pid, 0);
                result.set(marker.username.toLowerCase(), marker);
            } catch {
                await unlink(join(activeSkillsDir, file)).catch(() => undefined);
            }
        } catch {
            // A partially written or stale marker must not break the admin table.
        }
    }
    return result;
}

function sumItems(items: AdminItem[], id: number): number {
    return items.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function liveActivity(session: GatewayBotSnapshot | undefined): string {
    const state = session?.state;
    if (!state?.inGame || !state.player) return 'Offline';
    if (state.player.isDead) return 'Respawning';
    if (state.player.combat.inCombat) return 'Combat';
    if (state.dialog.isOpen) return 'Dialog';
    if (state.bank.isOpen) return 'Banking';
    if (state.shop.isOpen) return 'Shopping';
    if (state.trade?.isOpen) return 'Trading';
    if (state.player.animId !== -1) return 'Working';
    return 'Idle';
}

function stateItems(items: Array<{ id: number; name: string; count: number; slot: number }>): AdminItem[] {
    return items.map(item => ({ id: item.id, name: item.name, count: item.count, slot: item.slot }));
}

async function readSaveSafe(path: string): Promise<OfflineSaveSnapshot | null> {
    try {
        return await readPlayerSave(path);
    } catch {
        return null;
    }
}

export async function buildBotCatalog(
    gatewayBots: Map<string, GatewayBotSnapshot>,
    processes: Map<string, ManagedProcessSnapshot>
): Promise<BotCatalogEntry[]> {
    const saveFiles = await listFiles(playerSavesDir, '.sav');
    const managedNames = await managedBotNames();
    const skills = await activeSkills();
    const names = new Map<string, string>();

    for (const file of saveFiles) names.set(basename(file, '.sav').toLowerCase(), basename(file, '.sav'));
    for (const name of managedNames) names.set(name.toLowerCase(), name);
    for (const [name, session] of gatewayBots) names.set(name.toLowerCase(), session.state?.player?.name || name);
    for (const name of processes.keys()) if (!names.has(name)) names.set(name, name);

    const managed = new Set(managedNames.map(name => name.toLowerCase()));
    const saveByName = new Map(saveFiles.map(file => [basename(file, '.sav').toLowerCase(), join(playerSavesDir, file)]));

    const entries = await Promise.all([...names].map(async ([key, fallbackName]): Promise<BotCatalogEntry> => {
        const session = [...gatewayBots.entries()].find(([name]) => name.toLowerCase() === key)?.[1];
        const process = processes.get(key) ?? null;
        const savePath = saveByName.get(key);
        const save = savePath ? await readSaveSafe(savePath) : null;
        const state = session?.state;
        const liveSkills = state?.skills?.filter(skill => !/^(?:stat|unused)\s*1[89]$/i.test(skill.name)).map(skill => ({
            name: skill.name,
            level: skill.baseLevel,
            experience: skill.experience
        })) ?? [];
        const reportingSkills = liveSkills.length > 0 ? liveSkills : (save?.skills ?? []);
        const totalLevel = reportingSkills.reduce((sum, skill) => sum + skill.level, 0);
        const totalXp = reportingSkills.reduce((sum, skill) => sum + skill.experience, 0);
        const inventory = state ? stateItems(state.inventory) : (save?.inventory ?? []);
        const equipment = state ? stateItems(state.equipment) : (save?.equipment ?? []);
        const bank = save?.bank ?? [];
        const coins = state
            ? sumItems(inventory, 995) + sumItems(bank, 995)
            : (save?.coins ?? 0);
        const activeSkill = skills.get(key);

        let status: BotCatalogEntry['status'] = 'offline';
        if (session?.status === 'active') status = 'active';
        else if (session?.status === 'stale') status = 'stale';
        else if (process?.status === 'starting') status = 'starting';
        else if (process?.status === 'stopping') status = 'stopping';
        else if (process?.status === 'error') status = 'error';

        return {
            username: key,
            displayName: state?.player?.name || fallbackName,
            status,
            managed: managed.has(key) || process !== null,
            hasSave: !!savePath,
            hasCredentials: managed.has(key),
            canSpawn: status === 'offline' || status === 'error',
            canDespawn: status === 'active' || status === 'stale' || status === 'starting',
            currentSkill: activeSkill ? `${activeSkill.skillId}@${activeSkill.version}` : null,
            runId: activeSkill?.runId ?? null,
            lastError: process?.error ?? save?.error ?? null,
            lastActivityAt: session?.lastStateReceivedAt
                ? new Date(session.lastStateReceivedAt).toISOString()
                : save?.savedAt ?? process?.startedAt ?? null,
            stateAgeMs: session?.lastStateReceivedAt ? Date.now() - session.lastStateReceivedAt : null,
            position: state?.player
                ? { x: state.player.worldX, z: state.player.worldZ, level: state.player.level }
                : save?.position ?? null,
            combatLevel: state?.player?.combatLevel ?? save?.combatLevel ?? 0,
            totalLevel,
            totalXp,
            coins,
            activity: activeSkill ? activeSkill.skillId : liveActivity(session),
            skills: reportingSkills,
            inventory,
            equipment,
            bank,
            process
        };
    }));

    return entries.sort((left, right) => {
        const rank = (status: BotCatalogEntry['status']) => ['active', 'starting', 'stale', 'stopping', 'error', 'offline'].indexOf(status);
        return rank(left.status) - rank(right.status) || left.displayName.localeCompare(right.displayName);
    });
}

export function economySnapshot(entries: BotCatalogEntry[]): EconomySnapshot {
    const stock = new Map<number, { name: string; count: number }>();
    for (const bot of entries) {
        for (const item of [...bot.inventory, ...bot.bank]) {
            const current = stock.get(item.id) ?? { name: item.name, count: 0 };
            current.count += item.count;
            stock.set(item.id, current);
        }
    }
    return {
        timestamp: new Date().toISOString(),
        bots: entries.length,
        online: entries.filter(entry => entry.status === 'active').length,
        totalCoins: entries.reduce((sum, entry) => sum + entry.coins, 0),
        totalXp: entries.reduce((sum, entry) => sum + entry.totalXp, 0),
        averageTotalLevel: entries.length === 0 ? 0 : Math.round(entries.reduce((sum, entry) => sum + entry.totalLevel, 0) / entries.length),
        itemStock: [...stock.entries()].map(([id, item]) => ({ id, ...item }))
            .sort((left, right) => right.count - left.count).slice(0, 20)
    };
}

let lastEconomyWrite = 0;
export async function recordEconomy(snapshot: EconomySnapshot): Promise<void> {
    if (Date.now() - lastEconomyWrite < 30_000) return;
    lastEconomyWrite = Date.now();
    await mkdir(dirname(economyLogPath), { recursive: true });
    await appendFile(economyLogPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
}

export async function readEconomy(limit = 240): Promise<EconomySnapshot[]> {
    try {
        const text = await readFile(economyLogPath, 'utf8');
        return text.trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(limit, 5000)))
            .map(line => JSON.parse(line) as EconomySnapshot);
    } catch {
        return [];
    }
}
