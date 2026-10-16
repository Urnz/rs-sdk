interface DamageTarget {
    levels: Uint8Array; masks: number; hitmarkSlot: number;
    hitmarkDamage: number; hitmarkType: number; hitmark2Damage: number; hitmark2Type: number;
}

/** HP/hitmark changes and their durable injury proof succeed together or fail closed. */
export function applyHealthAuditedDamage(target: DamageTarget, hpIndex: number, amount: number,
    apply: () => void, record: (before: number, after: number) => void): void {
    const before = target.levels[hpIndex]!;
    const previous = { masks: target.masks, hitmarkSlot: target.hitmarkSlot,
        hitmarkDamage: target.hitmarkDamage, hitmarkType: target.hitmarkType,
        hitmark2Damage: target.hitmark2Damage, hitmark2Type: target.hitmark2Type };
    try {
        apply();
        const after = target.levels[hpIndex]!;
        if (amount > 0 && after < before) record(before, after);
    } catch (error) {
        target.levels[hpIndex] = before;
        Object.assign(target, previous);
        throw error;
    }
}
