import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
export interface NativeKitchenPolicy { schemaVersion: 1; recipeId: 'food.cook-lobster'; recipeVersion: '1.0.0';
    facilityId: string; capabilityId: 'cooking.heat-source'; heat: { debugName: string; x: number; z: number; level: number }; digest: string }
export function loadNativeKitchenPolicy(root: string): NativeKitchenPolicy {
    const input = JSON.parse(readFileSync(join(root, 'config/native-kitchen.json'), 'utf8'));
    if (Object.keys(input).sort().join(',') !== 'capabilityId,facilityId,heat,recipeId,recipeVersion,schemaVersion'
        || input.schemaVersion !== 1 || input.recipeId !== 'food.cook-lobster' || input.recipeVersion !== '1.0.0'
        || input.capabilityId !== 'cooking.heat-source' || typeof input.facilityId !== 'string' || !input.facilityId
        || !input.heat || typeof input.heat.debugName !== 'string' || !input.heat.debugName
        || ![input.heat.x, input.heat.z].every(n => Number.isInteger(n) && n >= 0 && n <= 16383)
        || !Number.isInteger(input.heat.level) || input.heat.level < 0 || input.heat.level > 3) throw new Error('Invalid native kitchen policy');
    return { ...input, digest: foodDigest(input) };
}
