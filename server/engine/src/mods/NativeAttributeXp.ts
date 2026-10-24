import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { characterBindingDigest, type CharacterAttributeBinding } from '../../../../character-attributes/binding-store.js';
import { applySkillPotentialProgression } from '../../../../character-attributes/progression.js';
import { POTENTIAL_ENABLED_SKILLS } from '../../../../character-attributes/types.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import type { XpActivityContext } from './DiminishingXp.js';
import { populationAttributeContext } from './PopulationDeathRuntime.js';
import { PlayerStatMap } from '../engine/entity/PlayerStat.js';

export interface NativeAttributeContext {
    binding: CharacterAttributeBinding;
    clock: SimulationClockObservation;
    worldId: string;
}
export interface NativeAttributeXpReceipt {
    schemaVersion: 1;
    awardId: string;
    context: NativeAttributeContext;
    skill: string;
    activity: XpActivityContext;
    requestedXp: number;
    worldModXp: number;
    potentialXp: number;
    globalMultiplier: number;
    worldPolicyDigest: string | null;
    allowMulti: boolean;
    beforeXp: number;
    grantedXp: number;
    afterXp: number;
    progression: ReturnType<typeof applySkillPotentialProgression>;
}
export interface NativeAttributeXpTarget {
    username: string;
    nativeAttributeXpReceipts: NativeAttributeXpReceipt[];
    /** Internal fixture port, not exposed by any client/SDK tool. */
    nativeAttributeXpContext?: (username: string, tick: number) => NativeAttributeContext | null;
}

export function prepareNativeAttributeXp(player: NativeAttributeXpTarget, skill: string, requestedXp: number,
    beforeXp: number, currentLevel: number, tick: number, allowMulti: boolean, multiplier: number,
    activity: XpActivityContext, worldAward: () => number, worldPolicyDigest: () => string | null,
    xpAtLevel: (level: number) => number, requireCheckpoint: () => void): NativeAttributeXpReceipt | null {
    skill = skill.toLowerCase();
    if (!(POTENTIAL_ENABLED_SKILLS as readonly string[]).includes(skill)) return null;
    const context = (player.nativeAttributeXpContext ?? populationAttributeContext)(player.username, tick);
    if (!context) return null;
    requireCheckpoint();
    const { binding, clock } = context;
    if (binding.username !== player.username || clock.clockId !== binding.clockId
        || clock.profileDigest !== binding.clockProfileDigest || clock.status !== 'running'
        || clock.simulationTime < binding.attributes.lifecycleCreatedAtSimulationTime)
        throw new Error('Native attribute XP identity/clock mismatch');
    if (!Number.isSafeInteger(requestedXp) || requestedXp < 0 || !Number.isSafeInteger(beforeXp)
        || !Number.isFinite(multiplier) || multiplier < 0) throw new Error('Invalid native attribute XP inputs');
    // Resolve/validate the policy before mutating repetition state in the preceding hooks.
    applySkillPotentialProgression(0, skill, currentLevel, binding.potential, binding.capPolicy);
    const worldModXp = allowMulti ? worldAward() : requestedXp;
    const progression = applySkillPotentialProgression(worldModXp, skill, currentLevel, binding.potential, binding.capPolicy);
    const cap = progression.capDecision!;
    const hardLimit = cap.personalHardCapLevel <= 1 ? 0 : xpAtLevel(cap.personalHardCapLevel);
    const potentialXp = progression.grantedXp;
    const grantedXp = Math.max(0, Math.min(Math.floor(potentialXp * multiplier), hardLimit - beforeXp, 2_000_000_000 - beforeXp));
    return { schemaVersion: 1, awardId: randomUUID(), context: structuredClone(context), skill, activity: structuredClone(activity), requestedXp,
        worldModXp, potentialXp, globalMultiplier: multiplier, worldPolicyDigest: allowMulti ? worldPolicyDigest() : null,
        allowMulti, beforeXp, grantedXp, afterXp: beforeXp + grantedXp, progression };
}

/** Called inside the existing Player checkpoint transaction. Pending receipts survive rollback. */
export function checkpointNativeAttributeXp(db: Database, player: NativeAttributeXpTarget, save: Uint8Array): void {
    if (!player.nativeAttributeXpReceipts.length) return;
    // Native SAV v8: fixed 28-byte header, followed by 21 (p4 XP, p1 boosted level) pairs.
    // Refuse a stale/caller-supplied save rather than attest an XP value absent from the checkpoint.
    const bytes = new DataView(save.buffer, save.byteOffset, save.byteLength);
    if (save.length < 133 || bytes.getUint16(0) !== 0x2004 || bytes.getUint16(2) !== 8)
        throw new Error('Unsupported native attribute XP checkpoint');
    const latest = new Map(player.nativeAttributeXpReceipts.map(receipt => [receipt.skill, receipt]));
    for (const [skill, receipt] of latest) {
        const stat = PlayerStatMap.get(skill.toUpperCase());
        if (stat === undefined || bytes.getInt32(28 + stat * 5) !== receipt.afterXp)
            throw new Error('Native attribute XP differs from Player checkpoint');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS native_attribute_xp_receipt(
        award_id TEXT PRIMARY KEY, username TEXT NOT NULL, payload TEXT NOT NULL, checkpoint_digest TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS native_attribute_xp_no_update BEFORE UPDATE ON native_attribute_xp_receipt
        BEGIN SELECT RAISE(ABORT,'Native XP receipts are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS native_attribute_xp_no_delete BEFORE DELETE ON native_attribute_xp_receipt
        BEGIN SELECT RAISE(ABORT,'Native XP receipts are immutable'); END;`);
    const checkpointDigest = characterBindingDigest([...save]);
    for (const receipt of player.nativeAttributeXpReceipts) {
        const prior = db.query<{ payload: string }, [string]>('SELECT payload FROM native_attribute_xp_receipt WHERE award_id=?').get(receipt.awardId);
        const payload = JSON.stringify(receipt);
        if (prior) {
            if (prior.payload !== payload) throw new Error('Native XP receipt identity conflict');
            continue;
        }
        db.query('INSERT INTO native_attribute_xp_receipt VALUES(?,?,?,?)')
            .run(receipt.awardId, player.username, payload, checkpointDigest);
    }
}
