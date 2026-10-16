import { productionWorkflowCatalogDigest } from '../production-workflow/catalog.js';
import type { ProductionItemQuantity, ProductionWorkflowCatalog } from '../production-workflow/types.js';
import { itemProvenancePolicyDigest } from '../item-provenance/policy.js';
import type { ItemProvenancePolicyCatalog, ItemProvenanceTier } from '../item-provenance/types.js';

export interface ClassifiedTransformationItem extends ProductionItemQuantity {
    provenanceTier: ItemProvenanceTier | null;
}

export interface TransformationSourceReadiness {
    schemaVersion: 1;
    recipeId: string;
    recipeVersion: string;
    recipeCatalogDigest: string;
    provenancePolicyDigest: string;
    inputs: ClassifiedTransformationItem[];
    outputs: ClassifiedTransformationItem[];
    exactAssetLineage: 'unavailable';
    recognizabilityChange: 'unverified';
    cleanTitleFinding: 'not-established';
    sourceGaps: readonly [
        'no-exact-consumed-asset-identities',
        'no-exact-created-asset-identities',
        'no-atomic-provenance-transfer'
    ];
}

/** Describes source capability only. It never authorizes production, sale or title changes. */
export function projectTransformationSourceReadiness(
    recipes: ProductionWorkflowCatalog, provenance: ItemProvenancePolicyCatalog,
    recipeId: string, recipeVersion: string
): TransformationSourceReadiness {
    const { digest: recipeDigest, ...recipeDefinition } = recipes;
    if (recipeDigest !== productionWorkflowCatalogDigest(recipeDefinition)) {
        throw new Error('Production workflow catalog digest mismatch');
    }
    const { digest: policyDigest, ...policyDefinition } = provenance;
    if (policyDigest !== itemProvenancePolicyDigest(policyDefinition)) {
        throw new Error('Item provenance policy digest mismatch');
    }
    const recipe = recipes.recipes.find(value => value.recipeId === recipeId && value.version === recipeVersion);
    if (!recipe) throw new Error('Unknown production recipe version');
    const classify = (items: ProductionItemQuantity[]): ClassifiedTransformationItem[] => items.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity,
        provenanceTier: provenance.rules.find(rule => rule.itemId === item.itemId)?.tier ?? null
    }));
    return {
        schemaVersion: 1,
        recipeId, recipeVersion,
        recipeCatalogDigest: recipes.digest,
        provenancePolicyDigest: provenance.digest,
        inputs: classify(recipe.inputs),
        outputs: classify(recipe.outputs),
        exactAssetLineage: 'unavailable',
        recognizabilityChange: 'unverified',
        cleanTitleFinding: 'not-established',
        sourceGaps: ['no-exact-consumed-asset-identities', 'no-exact-created-asset-identities',
            'no-atomic-provenance-transfer']
    };
}
