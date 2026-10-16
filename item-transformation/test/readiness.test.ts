import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadItemLifecycleCatalog, loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { loadItemProvenancePolicyCatalog } from '../../item-provenance/policy.js';
import { loadProductionWorkflowCatalog } from '../../production-workflow/catalog.js';
import { projectTransformationSourceReadiness } from '../readiness.js';

const config = join(import.meta.dir, '..', '..', 'config');
function catalogs() {
    const lifecycle = loadItemLifecycleCatalog(join(config, 'item-lifecycle.json'));
    const state = loadItemStatePolicyCatalog(join(config, 'item-state-policies.json'), lifecycle);
    return {
        recipes: loadProductionWorkflowCatalog(join(config, 'production-workflows.json')),
        provenance: loadItemProvenancePolicyCatalog(join(config, 'item-provenance-policies.json'), state)
    };
}

describe('physical transformation source readiness', () => {
    test('classifies known recipe quantities but never asserts clean title or exact asset lineage', () => {
        const { recipes, provenance } = catalogs();
        const result = projectTransformationSourceReadiness(recipes, provenance,
            'smithing.forge-bronze-pickaxe', '1.0.0');
        expect(result.inputs).toEqual([{ itemId: 2349, quantity: 3, provenanceTier: 'value-restitution' }]);
        expect(result.outputs).toEqual([{ itemId: 1265, quantity: 1, provenanceTier: 'identified-asset' }]);
        expect(result.exactAssetLineage).toBe('unavailable');
        expect(result.recognizabilityChange).toBe('unverified');
        expect(result.cleanTitleFinding).toBe('not-established');
        expect(result.sourceGaps).toHaveLength(3);
    });

    test('does not invent a provenance tier for recipe items outside the policy', () => {
        const { recipes, provenance } = catalogs();
        const result = projectTransformationSourceReadiness(recipes, provenance,
            'metallurgy.smelt-bronze-bar', '1.0.0');
        expect(result.inputs).toEqual([
            { itemId: 436, quantity: 1, provenanceTier: null },
            { itemId: 438, quantity: 1, provenanceTier: null }
        ]);
        expect(result.cleanTitleFinding).toBe('not-established');
    });

    test('rejects unknown versions and tampered catalogs', () => {
        const { recipes, provenance } = catalogs();
        expect(() => projectTransformationSourceReadiness(recipes, provenance, 'not-a-recipe', '1.0.0'))
            .toThrow('Unknown production recipe version');
        expect(() => projectTransformationSourceReadiness({ ...recipes, digest: '0'.repeat(64) }, provenance,
            'smithing.forge-bronze-pickaxe', '1.0.0')).toThrow('Production workflow catalog digest mismatch');
        expect(() => projectTransformationSourceReadiness(recipes, { ...provenance, digest: '0'.repeat(64) },
            'smithing.forge-bronze-pickaxe', '1.0.0')).toThrow('Item provenance policy digest mismatch');
    });
});
