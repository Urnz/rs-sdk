import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadItemLifecycleCatalog, loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { loadItemProvenancePolicyCatalog, resolveItemProvenanceRule,
    validateItemProvenancePolicyCatalog } from '../index.js';

const config = join(import.meta.dir, '..', '..', 'config');
function catalogs() { const lifecycle = loadItemLifecycleCatalog(join(config, 'item-lifecycle.json'));
    const state = loadItemStatePolicyCatalog(join(config, 'item-state-policies.json'), lifecycle);
    return { state, provenance: loadItemProvenancePolicyCatalog(join(config, 'item-provenance-policies.json'), state) }; }

describe('item provenance granularity policy', () => {
    test('reuses stack, batch and instance state modes without per-unit identity inflation', () => {
        const { provenance } = catalogs();
        expect(resolveItemProvenanceRule(provenance, 995).tier).toBe('value-restitution');
        expect(resolveItemProvenanceRule(provenance, 377).tier).toBe('provenance-lot');
        expect(resolveItemProvenanceRule(provenance, 1265).tier).toBe('identified-asset');
        expect(provenance.digest).toMatch(/^[0-9a-f]{64}$/);
    });
    test('rejects mode conflicts, missing decisions and tampered digests', () => {
        const { state, provenance } = catalogs();
        expect(() => validateItemProvenancePolicyCatalog({ schemaVersion: 1,
            rules: provenance.rules.map(rule => rule.itemId === 995 ? { ...rule, tier: 'identified-asset' } : rule) }, state))
            .toThrow('conflicts');
        expect(() => validateItemProvenancePolicyCatalog({ schemaVersion: 1,
            rules: provenance.rules.slice(1) }, state)).toThrow('Every item state rule');
        expect(() => resolveItemProvenanceRule({ ...provenance, digest: '0'.repeat(64) }, 995)).toThrow('digest mismatch');
    });
});
