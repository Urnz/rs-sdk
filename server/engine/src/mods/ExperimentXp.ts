import type { XpActivityContext } from '#/mods/DiminishingXp.js';

export interface ExperimentXpReward {
    activityKey: string;
    multiplier: number;
}

export interface ExperimentXpConfig {
    profileId: string;
    profileVersion: string;
    profileDigest: string;
    rewards: Map<string, number>;
}

const PROFILE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const SELECTOR = /^(?:all|skill:[a-z]+|script:[a-z0-9_.-]+|target:(?:loc|npc|obj|none):(?:\d+|none)|activity:[a-z0-9_.:/-]+)$/;

function requiredString(config: Record<string, boolean | number | string>, key: string): string {
    const value = config[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid experiment XP setting: ${key}`);
    return value.trim();
}

export function parseExperimentXpRewards(value: string): ExperimentXpReward[] {
    let parsed: unknown;
    try { parsed = JSON.parse(value) as unknown; }
    catch { throw new Error('Experiment XP rewardsJson must be valid JSON'); }
    if (!Array.isArray(parsed) || parsed.length > 500) throw new Error('Experiment XP rewardsJson must be a bounded array');
    const seen = new Set<string>();
    return parsed.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid experiment XP reward at index ${index}`);
        const row = entry as Record<string, unknown>;
        const activityKey = typeof row.activityKey === 'string' ? row.activityKey.trim().toLowerCase() : '';
        if (!SELECTOR.test(activityKey) || seen.has(activityKey)) throw new Error(`Invalid or duplicate experiment XP selector: ${activityKey || index}`);
        if (typeof row.multiplier !== 'number' || !Number.isFinite(row.multiplier) || row.multiplier < 0 || row.multiplier > 10) {
            throw new Error(`Invalid experiment XP multiplier for ${activityKey}`);
        }
        seen.add(activityKey);
        return { activityKey, multiplier: Number(row.multiplier.toFixed(6)) };
    });
}

export function parseExperimentXpConfig(config: Record<string, boolean | number | string>): ExperimentXpConfig {
    const profileId = requiredString(config, 'profileId').toLowerCase();
    const profileVersion = requiredString(config, 'profileVersion');
    const profileDigest = requiredString(config, 'profileDigest').toLowerCase();
    if (!PROFILE_ID.test(profileId)) throw new Error('Invalid experiment XP setting: profileId');
    if (!VERSION.test(profileVersion)) throw new Error('Invalid experiment XP setting: profileVersion');
    if (!DIGEST.test(profileDigest)) throw new Error('Invalid experiment XP setting: profileDigest');
    const rewards = new Map(parseExperimentXpRewards(requiredString(config, 'rewardsJson'))
        .map(entry => [entry.activityKey, entry.multiplier]));
    if (rewards.size === 0) throw new Error('Experiment XP profile contains no XP rewards');
    return { profileId, profileVersion, profileDigest, rewards };
}

function normalizedScript(script: string): string {
    return script.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

export function experimentXpSelectors(skill: string, context: XpActivityContext): string[] {
    const normalizedSkill = skill.trim().toLowerCase();
    const script = normalizedScript(context.script);
    const targetId = context.targetId === null ? 'none' : String(context.targetId);
    return [
        `activity:${normalizedSkill}/${script}/${context.targetKind}/${targetId}/${context.level}/${context.x}/${context.z}`,
        `target:${context.targetKind}:${targetId}`,
        `script:${script}`,
        `skill:${normalizedSkill}`,
        'all'
    ];
}

export function applyExperimentXpMultiplier(baseXp: number, skill: string, context: XpActivityContext,
    config: ExperimentXpConfig): { grantedXp: number; multiplier: number; selector: string | null } {
    const selector = experimentXpSelectors(skill, context).find(candidate => config.rewards.has(candidate)) ?? null;
    const multiplier = selector === null ? 1 : config.rewards.get(selector)!;
    const grantedXp = baseXp === 0 || multiplier === 0 ? 0 : Math.max(1, Math.round(baseXp * multiplier));
    return { grantedXp, multiplier, selector };
}
