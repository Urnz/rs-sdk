import type { FoodProductionAction } from '../server/engine/src/mods/NativeFoodProductionStore.js';
import { readNativeFoodProductionSource } from '../server/gateway/admin/native-food-production-source.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { validateProductionWorkflowCatalog } from '../production-workflow/catalog-definition.js';
import { readFileSync } from 'node:fs';

/** Read-only native quantity evidence. It cannot invent asset identities, clean title or a WIP commit. */
export function readNativeFoodTransformation(checkpointPath: string, action: FoodProductionAction, catalogPath: string) {
    const source = readNativeFoodProductionSource(checkpointPath, action);
    if (source.status !== 'completed') return source;
    const catalog = validateProductionWorkflowCatalog(JSON.parse(readFileSync(catalogPath, 'utf8'))), { receipt } = source;
    const recipe = catalog.recipes.find(row => row.recipeId === action.recipeId && row.version === action.recipeVersion);
    if (!recipe || catalog.digest !== action.catalogDigest || (action.kind === 'cook' && foodDigest(receipt.inputs) !== foodDigest(recipe.inputs))
        || (receipt.outcome === 'cooked' && foodDigest(receipt.outputs) !== foodDigest(recipe.outputs)))
        throw new Error('Native food transformation recipe/catalog mismatch');
    return { status: 'completed' as const, receipt, nativeEvidenceDigest: foodDigest(receipt),
        workerAgentId: action.actorId, batchId: action.batchId, source: action.source,
        businessCustody: receipt.custody ?? null,
        successfulRecipeOutput: receipt.outcome === 'cooked',
        exactAssetLineage: 'unavailable' as const, cleanTitleFinding: 'not-established' as const };
}
