import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { itemStatePolicyDigest, resolveItemStateRule } from '../item-lifecycle/classification.js';
import type { ItemStatePolicyCatalog } from '../item-lifecycle/types.js';
import type { ItemProvenancePolicyCatalog, ItemProvenanceRule, ItemProvenanceTier } from './types.js';

function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])); }
export function itemProvenancePolicyDigest(value: Omit<ItemProvenancePolicyCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateItemProvenancePolicyCatalog(value: unknown,
    statePolicy: ItemStatePolicyCatalog): ItemProvenancePolicyCatalog {
    const { digest, ...stateDefinition } = statePolicy;
    if (digest !== itemStatePolicyDigest(stateDefinition)) throw new Error('Item state policy digest mismatch');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Item provenance policy is invalid');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'rules,schemaVersion' || input.schemaVersion !== 1
        || !Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 10_000) {
        throw new Error('Item provenance policy is invalid');
    }
    const rules: ItemProvenanceRule[] = input.rules.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`rules[${index}] is invalid`);
        const rule = value as Record<string, unknown>, keys = Object.keys(rule).sort().join(',');
        if (keys !== 'itemId,itemName,rationale,tier' || !Number.isSafeInteger(rule.itemId)
            || Number(rule.itemId) < 0 || Number(rule.itemId) > 65_535 || typeof rule.itemName !== 'string'
            || !rule.itemName.trim() || rule.itemName.length > 80 || typeof rule.rationale !== 'string'
            || !rule.rationale.trim() || rule.rationale.length > 240
            || !['value-restitution', 'provenance-lot', 'identified-asset'].includes(String(rule.tier))) {
            throw new Error(`rules[${index}] is invalid`);
        }
        const itemId = Number(rule.itemId), tier = rule.tier as ItemProvenanceTier;
        const state = resolveItemStateRule(statePolicy, itemId);
        if ((state.mode === 'instance') !== (tier === 'identified-asset')
            || (state.mode === 'stack' && tier !== 'value-restitution')
            || (state.mode === 'batch' && tier !== 'provenance-lot')) {
            throw new Error(`rules[${index}] conflicts with item state mode`);
        }
        return { itemId, itemName: rule.itemName.trim(), tier, rationale: rule.rationale.trim() };
    });
    if (new Set(rules.map(rule => rule.itemId)).size !== rules.length) {
        throw new Error('Item provenance rules must have unique item ids');
    }
    if (rules.length !== statePolicy.rules.length || statePolicy.rules.some(state => !rules.some(rule => rule.itemId === state.itemId))) {
        throw new Error('Every item state rule requires an item provenance rule');
    }
    const definition = { schemaVersion: 1 as const, rules };
    return { ...definition, digest: itemProvenancePolicyDigest(definition) };
}
export function loadItemProvenancePolicyCatalog(path: string,
    statePolicy: ItemStatePolicyCatalog): ItemProvenancePolicyCatalog {
    return validateItemProvenancePolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown, statePolicy);
}
export function resolveItemProvenanceRule(catalog: ItemProvenancePolicyCatalog, itemId: number): ItemProvenanceRule {
    const { digest, ...definition } = catalog;
    if (digest !== itemProvenancePolicyDigest(definition)) throw new Error('Item provenance policy digest mismatch');
    const rule = catalog.rules.find(candidate => candidate.itemId === itemId);
    if (!rule) throw new Error(`Item ${itemId} has no provenance policy`);
    return rule;
}
