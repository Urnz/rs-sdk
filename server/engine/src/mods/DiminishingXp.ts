import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface XpActivityContext {
    script: string;
    targetKind: 'loc' | 'npc' | 'obj' | 'none';
    targetId: number | null;
    x: number;
    z: number;
    level: number;
}

export interface DiminishingXpConfig {
    affectedSkills: Set<string>;
    regionSize: number;
    recoveryMinutes: number;
    tierStarts: [number, number, number, number, number];
    multipliers: [number, number, number, number, number];
}

export interface DiminishingXpAward {
    activityKey: string;
    baseXp: number;
    grantedXp: number;
    multiplier: number;
    repetitionScore: number;
    nextRecoveryAt: string | null;
}

interface ActivityState {
    repetitionScore: number;
    updatedAt: number;
    awards: number;
    baseXp: number;
    grantedXp: number;
}

interface PlayerState {
    activities: Record<string, ActivityState>;
}

interface PersistedState {
    schemaVersion: 1;
    players: Record<string, PlayerState>;
}

export interface DiminishingXpSummary {
    playersTracked: number;
    activitiesTracked: number;
}

export interface DiminishingXpActivityView {
    username: string;
    activityKey: string;
    repetitionScore: number;
    nextMultiplier: number;
    updatedAt: string;
    nextRecoveryAt: string;
}

const defaultStatePath = fileURLToPath(new URL('../../../../.local/admin/diminishing-xp-state.json', import.meta.url));

function finiteNumber(config: Record<string, boolean | number | string>, key: string): number {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid diminishing XP setting: ${key}`);
    return value;
}

export function parseDiminishingXpConfig(config: Record<string, boolean | number | string>): DiminishingXpConfig {
    const affectedSkillsValue = config.affectedSkills;
    if (typeof affectedSkillsValue !== 'string') throw new Error('Invalid diminishing XP setting: affectedSkills');
    const affectedSkills = new Set(affectedSkillsValue.split(',').map(value => value.trim().toUpperCase()).filter(Boolean));
    if (affectedSkills.size === 0) throw new Error('At least one affected skill is required');

    const regionSize = finiteNumber(config, 'regionSize');
    const recoveryMinutes = finiteNumber(config, 'recoveryMinutes');
    const tierStarts = [1, finiteNumber(config, 'tier2At'), finiteNumber(config, 'tier3At'), finiteNumber(config, 'tier4At'), finiteNumber(config, 'tier5At')] as DiminishingXpConfig['tierStarts'];
    const multipliers = [1, finiteNumber(config, 'multiplier2'), finiteNumber(config, 'multiplier3'), finiteNumber(config, 'multiplier4'), finiteNumber(config, 'multiplier5')] as DiminishingXpConfig['multipliers'];
    if (!Number.isInteger(regionSize) || regionSize < 8 || regionSize > 256) throw new Error('regionSize must be an integer between 8 and 256');
    if (recoveryMinutes <= 0 || recoveryMinutes > 10080) throw new Error('recoveryMinutes must be between 0 and 10080');
    if (tierStarts.some(value => !Number.isInteger(value) || value < 1)
        || tierStarts.some((value, index) => index > 0 && value <= tierStarts[index - 1]!)) {
        throw new Error('Diminishing XP tier thresholds must be strictly increasing positive integers');
    }
    if (multipliers.some(value => value < 0 || value > 1)
        || multipliers.some((value, index) => index > 0 && value > multipliers[index - 1]!)) {
        throw new Error('Diminishing XP multipliers must be between 0 and 1 and must not increase');
    }
    return { affectedSkills, regionSize, recoveryMinutes, tierStarts, multipliers };
}

function validActivityState(value: unknown): value is ActivityState {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.repetitionScore === 'number' && Number.isFinite(entry.repetitionScore) && entry.repetitionScore >= 0
        && typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0
        && Number.isInteger(entry.awards) && Number(entry.awards) >= 0
        && typeof entry.baseXp === 'number' && Number.isFinite(entry.baseXp) && entry.baseXp >= 0
        && typeof entry.grantedXp === 'number' && Number.isFinite(entry.grantedXp) && entry.grantedXp >= 0;
}

function loadState(path: string): PersistedState {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
            throw new Error('unsupported state schema');
        }
        const players = (parsed as { players?: unknown }).players;
        if (!players || typeof players !== 'object' || Array.isArray(players)) throw new Error('invalid players');
        for (const player of Object.values(players as Record<string, unknown>)) {
            if (!player || typeof player !== 'object') throw new Error('invalid player state');
            const activities = (player as { activities?: unknown }).activities;
            if (!activities || typeof activities !== 'object' || Array.isArray(activities)
                || !Object.values(activities as Record<string, unknown>).every(validActivityState)) throw new Error('invalid activity state');
        }
        return parsed as PersistedState;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, players: {} };
        throw new Error(`Diminishing XP state cannot be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function buildXpActivityKey(skill: string, context: XpActivityContext, regionSize: number): string {
    const regionX = Math.floor(context.x / regionSize);
    const regionZ = Math.floor(context.z / regionSize);
    const target = context.targetId === null ? context.targetKind : `${context.targetKind}:${context.targetId}`;
    return `${skill.toUpperCase()}|${context.script || 'unknown'}|${target}|${context.level}:${regionX},${regionZ}`;
}

export function decayRepetitionScore(score: number, updatedAt: number, now: number, recoveryMinutes: number): number {
    if (now <= updatedAt) return score;
    return Math.max(0, score - (now - updatedAt) / (recoveryMinutes * 60_000));
}

export function multiplierForRepetition(repetition: number, config: DiminishingXpConfig): number {
    let tier = 0;
    for (let index = 1; index < config.tierStarts.length; index++) {
        if (repetition >= config.tierStarts[index]!) tier = index;
    }
    return config.multipliers[tier]!;
}

export class DiminishingXpStore {
    private readonly state: PersistedState;

    constructor(private readonly path = defaultStatePath) {
        this.state = loadState(path);
    }

    award(
        username: string,
        skill: string,
        context: XpActivityContext,
        baseXp: number,
        config: DiminishingXpConfig,
        now = Date.now()
    ): DiminishingXpAward {
        const playerKey = username.trim().toLowerCase();
        if (!playerKey) throw new Error('Diminishing XP award requires a player identity');
        const activityKey = buildXpActivityKey(skill, context, config.regionSize);
        const player = this.state.players[playerKey] ?? { activities: {} };
        const previous = player.activities[activityKey];
        const repetitionScore = previous
            ? decayRepetitionScore(previous.repetitionScore, previous.updatedAt, now, config.recoveryMinutes)
            : 0;
        const multiplier = multiplierForRepetition(Math.ceil(repetitionScore) + 1, config);
        const grantedXp = baseXp === 0 || multiplier === 0 ? 0 : Math.max(1, Math.round(baseXp * multiplier));
        player.activities[activityKey] = {
            repetitionScore: repetitionScore + 1,
            updatedAt: now,
            awards: (previous?.awards ?? 0) + 1,
            baseXp: (previous?.baseXp ?? 0) + baseXp,
            grantedXp: (previous?.grantedXp ?? 0) + grantedXp
        };
        this.state.players[playerKey] = player;
        this.persist();
        return {
            activityKey, baseXp, grantedXp, multiplier, repetitionScore: repetitionScore + 1,
            nextRecoveryAt: repetitionScore + 1 > 0 ? new Date(now + config.recoveryMinutes * 60_000).toISOString() : null
        };
    }

    summary(): DiminishingXpSummary {
        return {
            playersTracked: Object.keys(this.state.players).length,
            activitiesTracked: Object.values(this.state.players).reduce((total, player) => total + Object.keys(player.activities).length, 0)
        };
    }

    inspect(config: DiminishingXpConfig, now = Date.now(), limit = 100): DiminishingXpActivityView[] {
        const activities: DiminishingXpActivityView[] = [];
        for (const [username, player] of Object.entries(this.state.players)) {
            for (const [activityKey, activity] of Object.entries(player.activities)) {
                const repetitionScore = decayRepetitionScore(
                    activity.repetitionScore,
                    activity.updatedAt,
                    now,
                    config.recoveryMinutes
                );
                activities.push({
                    username,
                    activityKey,
                    repetitionScore,
                    nextMultiplier: multiplierForRepetition(Math.ceil(repetitionScore) + 1, config),
                    updatedAt: new Date(activity.updatedAt).toISOString(),
                    nextRecoveryAt: new Date(now + Math.min(1, repetitionScore) * config.recoveryMinutes * 60_000).toISOString()
                });
            }
        }
        return activities.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, limit));
    }

    private persist(): void {
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
            renameSync(temporary, this.path);
        } catch (error) {
            try { unlinkSync(temporary); } catch { /* nothing to clean up */ }
            throw error;
        }
    }
}
