import { readFileSync } from 'node:fs';
import { societyMinimumDigest } from '../society-minimum/policy.js';

export interface InputCategories { schemaVersion: 1; categories: Array<{ categoryId: string; itemIds: number[] }>; digest: string }
export function validateInputCategories(value: unknown): InputCategories {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input categories');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'categories,schemaVersion' || input.schemaVersion !== 1
        || !Array.isArray(input.categories) || input.categories.length < 1 || input.categories.length > 100)
        throw new Error('Invalid input categories');
    const ids = new Set<string>(), items = new Set<number>();
    const categories = input.categories.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).sort().join(',') !== 'categoryId,itemIds'
            || typeof entry.categoryId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.categoryId)
            || ids.has(entry.categoryId) || !Array.isArray(entry.itemIds) || entry.itemIds.length < 1 || entry.itemIds.length > 1000)
            throw new Error('Invalid input category');
        ids.add(entry.categoryId);
        const itemIds = entry.itemIds.map((item: unknown) => {
            if (!Number.isSafeInteger(item) || Number(item) < 0 || Number(item) > 65535 || items.has(Number(item)))
                throw new Error('Input item ids must be valid and disjoint');
            items.add(Number(item)); return Number(item);
        }).sort((a: number, b: number) => a - b);
        return { categoryId: entry.categoryId as string, itemIds };
    }).sort((a, b) => a.categoryId.localeCompare(b.categoryId));
    const definition = { schemaVersion: 1 as const, categories };
    return { ...definition, digest: societyMinimumDigest(definition) };
}
export function loadInputCategories(path: string): InputCategories {
    return validateInputCategories(JSON.parse(readFileSync(path, 'utf8')));
}

export function timestamp(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Invalid simulation time');
    return parsed;
}
export function integer(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid nonnegative safe integer');
    return Number(value);
}
export function sum(values: number[]): number { return integer(values.reduce((a, b) => a + integer(b), 0)); }
/** Ratios are diagnostic only; exact terms are retained and rounding is downward. */
export function ratio(numerator: number, denominator: number) {
    integer(numerator); integer(denominator);
    const quotient = denominator === 0 ? null : BigInt(numerator) * 10000n / BigInt(denominator);
    if (quotient !== null && quotient > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Ratio exceeds safe integer range');
    return { numerator, denominator, basisPoints: quotient === null ? null : Number(quotient) };
}
