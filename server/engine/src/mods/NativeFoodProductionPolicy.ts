import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProductionWorkflowCatalog } from '../../../../production-workflow/catalog-definition.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { LOBSTER } from './NativeFoodProductionStore.js';

export interface NativeFoodProductionPolicy {
    schemaVersion: 1; runId: string; foodChainId: 'lobster'; recipeId: string; recipeVersion: string;
    sources: Array<{ sourceId: string; npcDebugName: string; minX: number; maxX: number; minZ: number; maxZ: number; level: number; quantity: number }>;
    digest: string; catalogDigest: string;
}
export function loadNativeFoodProductionPolicy(root: string): NativeFoodProductionPolicy {
    const raw = JSON.parse(readFileSync(join(root, 'config/native-food-production.json'), 'utf8'));
    if (raw.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(raw.runId) || raw.foodChainId !== 'lobster'
        || raw.recipeId !== LOBSTER.recipeId || raw.recipeVersion !== LOBSTER.recipeVersion || !Array.isArray(raw.sources)
        || raw.sources.length !== 1 || raw.sources.some((s: NativeFoodProductionPolicy['sources'][number]) =>
            typeof s.sourceId !== 'string' || !s.sourceId.length || typeof s.npcDebugName !== 'string' || !s.npcDebugName.length
            || ![s.minX, s.maxX, s.minZ, s.maxZ, s.level, s.quantity].every(Number.isSafeInteger)
            || s.minX < 0 || s.maxX > 16383 || s.minZ < 0 || s.maxZ > 16383 || s.minX > s.maxX || s.minZ > s.maxZ
            || s.level < 0 || s.level > 3 || s.quantity < 1 || s.quantity > 100000))
        throw new Error('Invalid bounded native food production policy');
    const catalog = validateProductionWorkflowCatalog(JSON.parse(readFileSync(join(root, 'config/production-workflows.json'), 'utf8')));
    const recipe = catalog.recipes.find(row => row.recipeId === raw.recipeId && row.version === raw.recipeVersion);
    if (!recipe || foodDigest(recipe.inputs) !== foodDigest([{ itemId: LOBSTER.raw, quantity: 1 }])
        || foodDigest(recipe.outputs) !== foodDigest([{ itemId: LOBSTER.cooked, quantity: 1 }]))
        throw new Error('Native lobster recipe/catalog mismatch');
    const chain = JSON.parse(readFileSync(join(root, 'config/food-loops.json'), 'utf8')).chains.find((row: { foodChainId: string }) => row.foodChainId === 'lobster');
    if (chain?.rawItem.itemId !== LOBSTER.raw || chain?.cookedItem.itemId !== LOBSTER.cooked)
        throw new Error('Native lobster food-chain mismatch');
    return { ...raw, digest: foodDigest(raw), catalogDigest: catalog.digest };
}
