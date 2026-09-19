import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ItemLifecycleCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])); }
export function itemLifecycleCatalogDigest(value: Omit<ItemLifecycleCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateItemLifecycleCatalog(value: unknown): ItemLifecycleCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Item lifecycle catalog is invalid');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'items,schemaVersion' || input.schemaVersion !== 1
        || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 1_000) {
        throw new Error('Item lifecycle catalog is invalid');
    }
    const items = input.items.map((value, index) => { const field = `items[${index}]`;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} is invalid`);
        const item = value as Record<string, unknown>;
        if (Object.keys(item).sort().join(',') !== 'itemId,itemName,lifecycleTypeId,maxDurability,repairable,wearPerUse'
            || typeof item.lifecycleTypeId !== 'string' || !ID.test(item.lifecycleTypeId)
            || !Number.isSafeInteger(item.itemId) || Number(item.itemId) < 0 || Number(item.itemId) > 65_535
            || typeof item.itemName !== 'string' || !item.itemName.trim() || item.itemName.length > 80
            || !Number.isSafeInteger(item.maxDurability) || Number(item.maxDurability) < 1
            || Number(item.maxDurability) > 1_000_000 || !Number.isSafeInteger(item.wearPerUse)
            || Number(item.wearPerUse) < 1 || Number(item.wearPerUse) > Number(item.maxDurability)
            || typeof item.repairable !== 'boolean') throw new Error(`${field} is invalid`);
        return { lifecycleTypeId: item.lifecycleTypeId, itemId: Number(item.itemId), itemName: item.itemName.trim(),
            maxDurability: Number(item.maxDurability), wearPerUse: Number(item.wearPerUse), repairable: item.repairable }; });
    if (new Set(items.map(item => item.lifecycleTypeId)).size !== items.length
        || new Set(items.map(item => item.itemId)).size !== items.length) throw new Error('Item lifecycle identities must be unique');
    const definition = { schemaVersion: 1 as const, items };
    return { ...definition, digest: itemLifecycleCatalogDigest(definition) };
}
export function loadItemLifecycleCatalog(path: string): ItemLifecycleCatalog {
    return validateItemLifecycleCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
