import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { reportSelfSufficiency, ratio, validateInputCategories } from '../index.js';
import { reservationCoverage } from '../housing.js';
import { closeFoodLoop, FoodConsumptionStore, loadFoodLoopCatalog } from '../../food-loop/index.js';
import { createInitialNeedsState, loadNeedsPolicyCatalog, needsStateDigest } from '../../needs/index.js';
import { ItemLifecycleStore, loadItemLifecycleCatalog, loadItemRepairPolicyCatalog } from '../../item-lifecycle/index.js';
import { issueVerifiedRepairAuthorization } from '../../item-lifecycle/repair-authorization.js';
import { HousingTenancyStore } from '../../housing/tenancy-store.js';
import { validateHousingUnitCatalog } from '../../housing/units.js';
import { loadHousingTierPolicyCatalog } from '../../housing/config.js';
import type { FoodInventoryReceipt } from '../../food-loop/types.js';

const directories: string[] = [], config = join(import.meta.dir, '../../config');
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const at = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
const query = { fromSimulationTime: at(0), toSimulationTime: at(5), actorAgentIds: ['ada'], clockId: 'world' };
const foodCatalog = loadFoodLoopCatalog(join(config, 'food-loops.json'));
const lifecycle = loadItemLifecycleCatalog(join(config, 'item-lifecycle.json'));
const repairs = loadItemRepairPolicyCatalog(join(config, 'item-repair-policies.json'), lifecycle);
const housingCatalog = validateHousingUnitCatalog(JSON.parse(readFileSync(join(config, 'housing-units.json'), 'utf8')),
    loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!);
function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'society-metrics-')); directories.push(directory);
    const sources = { food: join(directory, 'food.sqlite'), tools: join(directory, 'tools.sqlite'), housing: join(directory, 'housing.sqlite') };
    return { directory, sources, report: (input = query) => reportSelfSufficiency(input, { configDirectory: config, sources }) };
}
function closure(id = 'food-1', hunger = 1000, hour = 3) {
    const policy = loadNeedsPolicyCatalog(join(config, 'needs-policies.json')).policies[0]!;
    const { digest: unused, ...definition } = createInitialNeedsState(policy, { characterAgentId: 'ada', clockId: 'world', observedAtSimulationTime: at(0) });
    definition.values = definition.values.map(item => item.needId === 'hunger' ? { ...item, value: hunger } : item);
    function receipt(kind: FoodInventoryReceipt['kind'], skill: FoodInventoryReceipt['skill'],
        inputs: FoodInventoryReceipt['inputs'], outputs: FoodInventoryReceipt['outputs']): FoodInventoryReceipt {
        return { receiptId: `${id}:${kind}`, actorAgentId: 'ada', kind, skill, inputs, outputs,
            occurredAtSimulationTime: at(hour), sourceDigest: 'a'.repeat(64) };
    }
    return closeFoodLoop({ closureId: id, foodChainId: 'lobster', state: { ...definition, digest: needsStateDigest(definition) },
        gathered: receipt('gathered', 'Fishing', [], [{ itemId: 377, quantity: 1 }]),
        processed: receipt('processed', 'Cooking', [{ itemId: 377, quantity: 1 }], [{ itemId: 379, quantity: 1 }]),
        consumed: receipt('consumed', null, [{ itemId: 379, quantity: 1 }], []) }, foodCatalog, policy);
}
function populateFood(path: string) {
    const store = new FoodConsumptionStore(path, foodCatalog);
    try { store.record(closure()); store.record(closure()); } finally { store.close(); }
}
function populateTools(path: string, replacement = false) {
    const store = new ItemLifecycleStore(path, lifecycle);
    try {
        store.create({ itemInstanceId: 'pick-1', lifecycleTypeId: 'bronze-pickaxe', ownerActorId: 'ada', qualityBasisPoints: 10000,
            provenanceDigest: 'b'.repeat(64), atSimulationTime: at(0) });
        store.use('wear-1', 'pick-1', 1, 100, 'c'.repeat(64), at(1));
        if (replacement) {
            store.replace({ operationId: 'replace-1', replacedItemInstanceId: 'pick-1', replacementItemInstanceId: 'pick-2',
                expectedRevision: 2, ownerActorId: 'ada', qualityBasisPoints: 10000, provenanceDigest: 'd'.repeat(64),
                evidenceDigest: 'e'.repeat(64), atSimulationTime: at(2) });
            store.use('wear-2', 'pick-2', 1, 10, 'f'.repeat(64), at(4));
        } else {
            store.applyVerifiedRepair(issueVerifiedRepairAuthorization({ operationId: 'repair-1', itemInstanceId: 'pick-1',
                expectedRevision: 2, restoredDurability: 50, atSimulationTime: at(2), evidence: {
                    policyId: repairs.policies[0]!.policyId, policyDigest: repairs.digest, materialReceiptId: 'material-1',
                    inputReceiptDigest: 'd'.repeat(64), competenceSnapshotDigest: 'e'.repeat(64), facilityReceiptDigest: 'f'.repeat(64),
                    startedAtSimulationTime: at(1) } }));
            store.use('wear-2', 'pick-1', 3, 10, 'f'.repeat(64), at(4));
        }
    } finally { store.close(); }
}
function populateHousing(path: string, ended = false) {
    const store = new HousingTenancyStore(path, housingCatalog), unit = housingCatalog.units[0]!;
    try {
        store.create({ tenancyId: 'lease-1', housingUnitId: unit.housingUnitId, bedSlotId: unit.bedSlots[0]!.bedSlotId,
            tenantAgentId: 'ada', startsAtSimulationTime: at(0), periodCount: 2 });
        if (ended) store.end('lease-1', 1, at(2));
    } finally { store.close(); }
}
function mutate(path: string, sql: string) {
    const db = new Database(path);
    try { db.run(sql); } finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
}

describe('native self-sufficiency metrics', () => {
    test('missing sources remain unknown and readonly reporting creates nothing', () => {
        const f = fixture(), report = f.report();
        expect(report).toMatchObject({ assessment: 'inconclusive', sources: { food: { status: 'unavailable' } } });
        expect(report.food[0]!.recordedUnitsConsumed).toBeNull();
        expect(report.tools[0]!.openingOutputCapacity).toBeNull();
        expect(report.housing[0]!.reservedMilliseconds).toBeNull();
        expect(report.inputs.flatMap(category => category.items).every(item => item.internalSupplyShare.basisPoints === null)).toBeTrue();
        for (const path of Object.values(f.sources)) expect(existsSync(path)).toBeFalse();
    });
    test('food replay is deduplicated and actual clamped relief is observed without certifying supplied receipt origins', () => {
        const f = fixture(); populateFood(f.sources.food);
        expect(f.report().food[0]).toMatchObject({ recordedUnitsConsumed: 1, recordedEffectiveHungerRelief: 1000,
            internalFinalUseShare: { numerator: null, denominator: null, basisPoints: null } });
        expect(f.report().sources.food.status).toBe('available');
        expect(f.report().inputs.find(category => category.categoryId === 'food-raw')!.items.find(item => item.itemId === 377))
            .toMatchObject({ associatedRequirementUnits: 1 });
    });
    test('event bounds are (start,end] and adjacent windows do not double count', () => {
        const f = fixture(); populateFood(f.sources.food);
        expect(f.report({ ...query, toSimulationTime: at(3) }).food[0]!.recordedUnitsConsumed).toBe(1);
        expect(f.report({ ...query, fromSimulationTime: at(3) }).food[0]!.recordedUnitsConsumed).toBe(0);
        expect(f.report({ ...query, actorAgentIds: ['bea'] }).food[0]!.recordedUnitsConsumed).toBe(0);
    });
    test('zero recorded demand is not a 100% internal ratio', () => {
        const f = fixture(), store = new FoodConsumptionStore(f.sources.food, foodCatalog); store.close();
        expect(f.report().food[0]).toMatchObject({ recordedEffectiveHungerRelief: 0, internalFinalUseShare: { basisPoints: null } });
        expect(ratio(0, 0).basisPoints).toBeNull();
    });
    test('wear, repair, resumed use and historical capacities are reconstructed per cycle and actor', () => {
        const f = fixture(); populateTools(f.sources.tools);
        expect(f.report().tools[0]).toMatchObject({ openingOutputCapacity: 100, closingOutputCapacity: 40,
            observedCapacityRetained: false, recordedWearDurability: 110, recordedRestoredDurability: 50,
            cyclesWithResumedUse: 1, repairs: 1, replacements: 0, observedMaintenanceToWear: { numerator: 50, denominator: 110, basisPoints: 4545 } });
        expect(f.report({ ...query, toSimulationTime: at(2) }).tools[0]).toMatchObject({ closingOutputCapacity: 50, cyclesWithResumedUse: 0 });
        expect(f.report().inputs.find(category => category.categoryId === 'metal-maintenance')!.items[0]!.associatedRequirementUnits).toBe(1);
    });
    test('replacement retires old capacity and resumed service is separate from internal successor production', () => {
        const f = fixture(); populateTools(f.sources.tools, true);
        expect(f.report().tools[0]).toMatchObject({ openingOutputCapacity: 100, closingOutputCapacity: 90,
            replacements: 1, cyclesWithResumedUse: 1, internalMaintenanceShare: { basisPoints: null } });
        expect(f.report().inputs.find(category => category.categoryId === 'replacement-tools')!.items[0]!.associatedRequirementUnits).toBe(1);
    });
    test('future tool operations cannot alter closing capacity or count maintenance in an earlier window', () => {
        const f = fixture(); populateTools(f.sources.tools);
        expect(f.report({ ...query, toSimulationTime: at(1) }).tools[0]).toMatchObject({ closingOutputCapacity: 0, repairs: 0 });
        expect(f.report({ ...query, fromSimulationTime: at(2) }).tools[0]).toMatchObject({ openingOutputCapacity: 50,
            closingOutputCapacity: 40, repairs: 0, cyclesWithResumedUse: 0 });
    });
    test('housing integrates initial half-open reservations per actor and keeps legal-access ratio unknown', () => {
        const f = fixture(); populateHousing(f.sources.housing, true);
        expect(f.report().housing[0]).toMatchObject({ reservedMilliseconds: 7200000,
            declaredInitialReservationCoverage: { numerator: 7200000, denominator: 18000000, basisPoints: 4000 }, legalAccessShare: { basisPoints: null } });
        expect(f.report({ ...query, fromSimulationTime: at(2) }).housing[0]!.reservedMilliseconds).toBe(0);
    });
    test('an unassessed lease does not supply free coverage beyond the first rent period', () => {
        const f = fixture(); populateHousing(f.sources.housing);
        expect(f.report({ ...query, toSimulationTime: at(48) }).housing[0]).toMatchObject({ reservedMilliseconds: 86400000,
            declaredInitialReservationCoverage: { basisPoints: 5000 } });
    });
    test('overlapping beds and multiple reservations never multiply person-time, including outsiders', () => {
        const base = { unitId: 'unit', bedId: 'bed', tierId: 'rented-room', start: 0, end: 100, tenancyId: 'one', actor: 'ada' };
        expect(reservationCoverage([base, { ...base, actor: 'outsider', tenancyId: 'two' }], ['ada'], 0, 100)[0])
            .toMatchObject({ reservedMilliseconds: 0, reservationConflictObserved: true });
        expect(reservationCoverage([base, { ...base, bedId: 'other', tenancyId: 'two' }], ['ada'], 0, 100)[0]!.reservedMilliseconds).toBe(0);
        expect(reservationCoverage([base], ['ada'], 0, 100, new Set(['other-tier']))[0]!.reservedMilliseconds).toBe(0);
    });
    test('modified food event/closure or missing native receipt is invalid, never zero consumption', () => {
        for (const sql of ["UPDATE food_consumption_event SET hunger_relief=1800", "DELETE FROM food_receipt_use WHERE ordinal=1",
            "UPDATE food_loop_closure SET actor_agent_id='bea'"]) {
            const f = fixture(); populateFood(f.sources.food); mutate(f.sources.food, sql);
            expect(f.report().sources.food.status).toBe('invalid'); expect(f.report().food[0]!.recordedUnitsConsumed).toBeNull();
        }
    });
    test('tool state tampering, operation suffix deletion or unbound material evidence fail closed', () => {
        for (const sql of ["UPDATE item_instance SET durability=99", "DELETE FROM item_lifecycle_operation WHERE operation_id='wear-2'",
            "DELETE FROM item_repair_evidence"]) {
            const f = fixture(); populateTools(f.sources.tools); mutate(f.sources.tools, sql);
            expect(f.report().sources.tools.status).toBe('invalid'); expect(f.report().tools[0]!.closingOutputCapacity).toBeNull();
        }
    });
    test('housing schedule tampering and future schema reject without migrations', () => {
        const f = fixture(); populateHousing(f.sources.housing); mutate(f.sources.housing, "UPDATE housing_tenancy SET ends_at='2031-01-01T00:00:00.000Z'");
        expect(f.report().sources.housing.status).toBe('invalid');
        const other = fixture(); populateFood(other.sources.food); mutate(other.sources.food, 'PRAGMA user_version=2');
        expect(other.report().sources.food.status).toBe('invalid');
    });
    test('ratios retain exact terms, round down and reject unsafe arithmetic', () => {
        expect(ratio(2, 3)).toEqual({ numerator: 2, denominator: 3, basisPoints: 6666 });
        expect(ratio(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER).basisPoints).toBe(9999);
        expect(() => ratio(Number.MAX_SAFE_INTEGER, 1)).toThrow();
        expect(() => ratio(-1, 1)).toThrow();
    });
    test('taxonomy forbids double counting/unknown fields and scope rejects invalid or duplicate actors', () => {
        expect(() => validateInputCategories({ schemaVersion: 1, categories: [{ categoryId: 'ore', itemIds: [436, 436] }] })).toThrow();
        expect(() => validateInputCategories({ schemaVersion: 1, categories: [{ categoryId: 'ore', itemIds: [436], extra: true }] })).toThrow();
        const f = fixture();
        expect(() => f.report({ ...query, actorAgentIds: ['ada', 'ada'] })).toThrow();
        expect(() => f.report({ ...query, fromSimulationTime: query.toSimulationTime })).toThrow();
    });
    test('source digests are stable and the independent missing categories remain unknown', () => {
        const f = fixture(); populateFood(f.sources.food); populateTools(f.sources.tools); populateHousing(f.sources.housing);
        const first = f.report(); expect(f.report()).toEqual(first);
        expect(first.inputs.find(category => category.categoryId === 'mineral-ores')!.items.every(item => item.associatedRequirementUnits === null)).toBeTrue();
        expect(first.assessment).toBe('inconclusive'); expect(first.sources.food).toMatchObject({ temporalCoverage: 'partial' });
    });
    test('wrong clock and modified audit hash are invalid rather than being assigned to the requested scope', () => {
        const f = fixture(); populateFood(f.sources.food);
        expect(f.report({ ...query, clockId: 'different-clock' }).sources.food.status).toBe('invalid');
        mutate(f.sources.food, "UPDATE food_consumption_audit SET entry_hash='forged'");
        expect(f.report().sources.food.status).toBe('invalid');
    });
    test('independent actors retain separate deficits and selecting another actor never pools tool capacity', () => {
        const f = fixture(); populateTools(f.sources.tools);
        const report = f.report({ ...query, actorAgentIds: ['bea', 'ada'] });
        expect(report.tools.find(item => item.actorAgentId === 'ada')!.closingOutputCapacity).toBe(40);
        expect(report.tools.find(item => item.actorAgentId === 'bea')!.closingOutputCapacity).toBe(0);
        expect(report.tools.find(item => item.actorAgentId === 'bea')!.observedMaintenanceToWear!.basisPoints).toBeNull();
    });
});
