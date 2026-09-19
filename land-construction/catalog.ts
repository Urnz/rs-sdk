import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ConstructionBlueprintDefinition, ConstructionPropertyType, LandConstructionCatalog,
    LandParcelDefinition } from './types.js';

const ID = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
const PROPERTY_TYPES: readonly ConstructionPropertyType[] =
    ['house', 'farm', 'shop', 'workshop', 'inn', 'warehouse'];
function object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[], name: string): void {
    if (Object.keys(value).sort().join(',') !== fields.sort().join(',')) throw new Error(`${name} fields are invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length > 128 || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error(`${field} is invalid`);
    return value.trim();
}
function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function landConstructionCatalogDigest(value: Omit<LandConstructionCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateLandConstructionCatalog(value: unknown): LandConstructionCatalog {
    const input = object(value, 'Land construction catalog');
    exact(input, ['schemaVersion', 'parcels', 'blueprints'], 'Land construction catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.parcels) || !Array.isArray(input.blueprints)
        || input.parcels.length > 1_000 || input.blueprints.length < 1 || input.blueprints.length > 100) {
        throw new Error('Land construction catalog is invalid');
    }
    const parcels: LandParcelDefinition[] = input.parcels.map((value, index) => {
        const field = `parcels[${index}]`, item = object(value, field);
        exact(item, ['landParcelId', 'label', 'region', 'enabled', 'purchasePriceGp', 'bounds'], field);
        if (typeof item.enabled !== 'boolean') throw new Error(`${field}.enabled must be boolean`);
        const bounds = object(item.bounds, `${field}.bounds`);
        exact(bounds, ['minX', 'maxX', 'minZ', 'maxZ', 'level'], `${field}.bounds`);
        const parsedBounds = { minX: integer(bounds.minX, `${field}.bounds.minX`, 0, 16_383),
            maxX: integer(bounds.maxX, `${field}.bounds.maxX`, 0, 16_383),
            minZ: integer(bounds.minZ, `${field}.bounds.minZ`, 0, 16_383),
            maxZ: integer(bounds.maxZ, `${field}.bounds.maxZ`, 0, 16_383),
            level: integer(bounds.level, `${field}.bounds.level`, 0, 3) };
        if (parsedBounds.minX > parsedBounds.maxX || parsedBounds.minZ > parsedBounds.maxZ) {
            throw new Error(`${field}.bounds are inverted`);
        }
        return { landParcelId: id(item.landParcelId, `${field}.landParcelId`), label: text(item.label, `${field}.label`),
            region: text(item.region, `${field}.region`), enabled: item.enabled,
            purchasePriceGp: integer(item.purchasePriceGp, `${field}.purchasePriceGp`, 1, 2_147_483_647),
            bounds: parsedBounds };
    });
    const blueprints: ConstructionBlueprintDefinition[] = input.blueprints.map((value, index) => {
        const field = `blueprints[${index}]`, item = object(value, field);
        exact(item, ['blueprintId', 'label', 'resultPropertyType', 'constructionCostGp', 'stages'], field);
        if (!PROPERTY_TYPES.includes(item.resultPropertyType as ConstructionPropertyType)) {
            throw new Error(`${field}.resultPropertyType is invalid`);
        }
        if (!Array.isArray(item.stages) || item.stages.length < 1 || item.stages.length > 16) {
            throw new Error(`${field}.stages is invalid`);
        }
        const stages = item.stages.map((value, stageIndex) => { const stage = object(value, `${field}.stages[${stageIndex}]`);
            exact(stage, ['stageId', 'label'], `${field}.stages[${stageIndex}]`);
            return { stageId: id(stage.stageId, `${field}.stages[${stageIndex}].stageId`),
                label: text(stage.label, `${field}.stages[${stageIndex}].label`) }; });
        if (new Set(stages.map(stage => stage.stageId)).size !== stages.length) {
            throw new Error(`${field}.stages contains duplicate ids`);
        }
        return { blueprintId: id(item.blueprintId, `${field}.blueprintId`), label: text(item.label, `${field}.label`),
            resultPropertyType: item.resultPropertyType as ConstructionPropertyType,
            constructionCostGp: integer(item.constructionCostGp, `${field}.constructionCostGp`, 1, 2_147_483_647), stages };
    });
    if (new Set(parcels.map(parcel => parcel.landParcelId)).size !== parcels.length
        || new Set(blueprints.map(blueprint => blueprint.blueprintId)).size !== blueprints.length) {
        throw new Error('Land construction catalog identities must be unique');
    }
    const definition = { schemaVersion: 1 as const, parcels, blueprints };
    return { ...definition, digest: landConstructionCatalogDigest(definition) };
}
export function loadLandConstructionCatalog(path: string): LandConstructionCatalog {
    return validateLandConstructionCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
