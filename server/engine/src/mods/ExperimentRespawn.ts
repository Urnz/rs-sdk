export type RespawnTargetKind = 'loc' | 'obj' | 'npc';

export interface RespawnTargetContext {
    kind: RespawnTargetKind;
    targetId: number;
    level: number;
    x: number;
    z: number;
}

export interface ExperimentRespawnConfig {
    profileId: string;
    profileVersion: string;
    profileDigest: string;
    targets: Map<string, number>;
}

const PROFILE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[a-f0-9]{64}$/;
export const RESPAWN_SELECTOR = /^(?:loc|obj|npc):\d+(?::\d+:\d+:\d+)?$/;

function requiredString(config: Record<string, boolean | number | string>, key: string): string {
    const value = config[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid experiment respawn setting: ${key}`);
    return value.trim();
}

export function parseExperimentRespawnTargets(value: string): Array<{ targetKey: string; ticks: number }> {
    let parsed: unknown;
    try { parsed = JSON.parse(value) as unknown; }
    catch { throw new Error('Experiment respawn targetsJson must be valid JSON'); }
    if (!Array.isArray(parsed) || parsed.length > 500) throw new Error('Experiment respawn targetsJson must be a bounded array');
    const seen = new Set<string>();
    return parsed.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid experiment respawn target at index ${index}`);
        const row = entry as Record<string, unknown>;
        const targetKey = typeof row.targetKey === 'string' ? row.targetKey.trim().toLowerCase() : '';
        if (!RESPAWN_SELECTOR.test(targetKey) || seen.has(targetKey)) {
            throw new Error(`Invalid or duplicate experiment respawn selector: ${targetKey || index}`);
        }
        if (!Number.isSafeInteger(row.ticks) || Number(row.ticks) < 1 || Number(row.ticks) > 12_000) {
            throw new Error(`Invalid experiment respawn ticks for ${targetKey}`);
        }
        seen.add(targetKey);
        return { targetKey, ticks: Number(row.ticks) };
    });
}

export function parseExperimentRespawnConfig(config: Record<string, boolean | number | string>): ExperimentRespawnConfig {
    const profileId = requiredString(config, 'profileId').toLowerCase();
    const profileVersion = requiredString(config, 'profileVersion');
    const profileDigest = requiredString(config, 'profileDigest').toLowerCase();
    if (!PROFILE_ID.test(profileId)) throw new Error('Invalid experiment respawn setting: profileId');
    if (!VERSION.test(profileVersion)) throw new Error('Invalid experiment respawn setting: profileVersion');
    if (!DIGEST.test(profileDigest)) throw new Error('Invalid experiment respawn setting: profileDigest');
    const targets = new Map(parseExperimentRespawnTargets(requiredString(config, 'targetsJson'))
        .map(entry => [entry.targetKey, entry.ticks]));
    if (targets.size === 0) throw new Error('Experiment profile contains no respawn targets');
    return { profileId, profileVersion, profileDigest, targets };
}

export function experimentRespawnSelectors(context: RespawnTargetContext): [string, string] {
    return [`${context.kind}:${context.targetId}:${context.level}:${context.x}:${context.z}`,
        `${context.kind}:${context.targetId}`];
}

export function applyExperimentRespawnTicks(baseTicks: number, context: RespawnTargetContext,
    config: ExperimentRespawnConfig): { scheduledTicks: number; selector: string | null } {
    const selector = experimentRespawnSelectors(context).find(candidate => config.targets.has(candidate)) ?? null;
    return { scheduledTicks: selector === null ? baseTicks : config.targets.get(selector)!, selector };
}
