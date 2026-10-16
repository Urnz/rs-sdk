import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FoodChainDefinition, FoodLoopCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[], name: string): void {
    if (Object.keys(value).sort().join(',') !== fields.sort().join(',')) throw new Error(`${name} fields are invalid`);
}
function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    } return Number(value);
}
function item(value: unknown, field: string, raw: boolean): FoodChainDefinition['rawItem'] {
    const input = record(value, field);
    exact(input, raw ? ['itemId', 'name', 'sourceSkill'] : ['itemId', 'name'], field);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
        throw new Error(`${field}.name is invalid`);
    }
    if (raw && !['Fishing', 'Farming'].includes(String(input.sourceSkill))) {
        throw new Error(`${field}.sourceSkill is invalid`);
    }
    return { itemId: integer(input.itemId, `${field}.itemId`, 0, 65_535), name: input.name.trim(),
        sourceSkill: (input.sourceSkill ?? 'Fishing') as 'Fishing' | 'Farming' };
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function foodLoopCatalogDigest(value: Omit<FoodLoopCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateFoodLoopCatalog(value: unknown): FoodLoopCatalog {
    const input = record(value, 'Food loop catalog');
    exact(input, ['schemaVersion', 'chains'], 'Food loop catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.chains)
        || input.chains.length < 1 || input.chains.length > 100) throw new Error('Food loop catalog is invalid');
    const chains = input.chains.map((value, index) => { const field = `chains[${index}]`, chain = record(value, field);
        exact(chain, ['foodChainId', 'rawItem', 'cookedItem', 'processingSkill', 'hungerRelief'], field);
        if (typeof chain.foodChainId !== 'string' || !ID.test(chain.foodChainId)) {
            throw new Error(`${field}.foodChainId is invalid`);
        }
        if (chain.processingSkill !== 'Cooking') throw new Error(`${field}.processingSkill must be Cooking`);
        const rawItem = item(chain.rawItem, `${field}.rawItem`, true);
        const cooked = item(chain.cookedItem, `${field}.cookedItem`, false);
        return { foodChainId: chain.foodChainId, rawItem,
            cookedItem: { itemId: cooked.itemId, name: cooked.name }, processingSkill: 'Cooking' as const,
            hungerRelief: integer(chain.hungerRelief, `${field}.hungerRelief`, 1, 1_000_000) }; });
    if (new Set(chains.map(chain => chain.foodChainId)).size !== chains.length) {
        throw new Error('Food chain identities must be unique');
    }
    const definition = { schemaVersion: 1 as const, chains };
    return { ...definition, digest: foodLoopCatalogDigest(definition) };
}
export function loadFoodLoopCatalog(path: string): FoodLoopCatalog {
    return validateFoodLoopCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
