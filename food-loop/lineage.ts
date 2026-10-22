import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import type { FoodBalances } from '../server/engine/src/mods/NativeFoodProductionStore.js';
import type { FoodCustodian, FoodLineageJournal } from '../server/engine/src/mods/NativeFoodLineageStore.js';

export type FoodOrigin = 'internal' | 'bootstrap' | 'import' | 'unknown' | 'mixed';
export interface FoodLineagePool { quantity: number; origin: FoodOrigin; sourceKeys: string[]; gatherers: string[]; cooks: string[] }
export interface FoodLineageConsumption extends FoodLineagePool {
    actionId: string; consumer: FoodCustodian; sequence: number; evidence: 'quantity-lineage';
    exactAssetLineage: 'unavailable'; cleanTitleFinding: 'not-established';
}
const material = ['raw', 'cooked', 'burnt'] as const;
type Material = typeof material[number];
const itemMaterial = (id: number | undefined): Material | undefined => id === 377 ? 'raw' : id === 379 ? 'cooked' : id === 381 ? 'burnt' : undefined;
const empty = (quantity = 0, origin: FoodOrigin = 'unknown'): FoodLineagePool => ({ quantity, origin, sourceKeys: [], gatherers: [], cooks: [] });
const unique = (values: string[]) => [...new Set(values)].sort();
const ownerKey = (owner: FoodCustodian, type: Material) => JSON.stringify([owner.worldId, owner.actorId, owner.lifecycleId, type]);
function validBalances(value: FoodBalances): void {
    if (!value || material.some(type => !Number.isSafeInteger(value[type]) || value[type] < 0)) throw new Error('Invalid food lineage balances');
}
function merge(a: FoodLineagePool, b: FoodLineagePool): FoodLineagePool {
    const quantity = a.quantity + b.quantity;
    if (!Number.isSafeInteger(quantity)) throw new Error('Food lineage quantity overflow');
    return { quantity, origin: !a.quantity ? b.origin : !b.quantity ? a.origin : a.origin === b.origin ? a.origin : 'mixed',
        sourceKeys: unique([...a.sourceKeys, ...b.sourceKeys]), gatherers: unique([...a.gatherers, ...b.gatherers]), cooks: unique([...a.cooks, ...b.cooks]) };
}
/** Fungible quantity ancestry, never an assertion about which physical slot/identified asset was eaten.
 * Mixed origins stay mixed until their pool empties; FIFO cannot launder an unknown unit into internal supply. */
export function projectFoodLineage(journal: FoodLineageJournal) {
    const pools = new Map<string, FoodLineagePool>(), consumptions: FoodLineageConsumption[] = [], gaps: string[] = [];
    let produced = 0, transformed = 0, burnt = 0, transferred = 0;
    const reconcile = (owner: FoodCustodian, type: Material, quantity: number, source: string) => {
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid food lineage quantity');
        const key = ownerKey(owner, type), prior = pools.get(key);
        if (!prior || prior.quantity !== quantity) {
            if (quantity || prior?.quantity) gaps.push(`${source}:${owner.actorId}:${type}:unwitnessed-balance`);
            // A mismatch invalidates ancestry for the entire fungible pool, including unexplained removals.
            pools.set(key, empty(quantity));
        }
    };
    const take = (owner: FoodCustodian, type: Material, quantity: number): FoodLineagePool => {
        const key = ownerKey(owner, type), pool = pools.get(key) ?? empty();
        if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > pool.quantity) throw new Error('Food lineage units already spent or insufficient');
        const portion = { ...structuredClone(pool), quantity };
        pools.set(key, pool.quantity === quantity ? empty() : { ...pool, quantity: pool.quantity - quantity });
        return portion;
    };
    const add = (owner: FoodCustodian, type: Material, portion: FoodLineagePool) => {
        const key = ownerKey(owner, type); pools.set(key, merge(pools.get(key) ?? empty(), portion));
    };
    let previous: string | null = null;
    for (const [index, entry] of journal.entries.entries()) {
        const { digest, ...facts } = entry;
        if (entry.sequence !== index + 1 || entry.previousDigest !== previous || foodDigest(facts) !== digest)
            throw new Error('Food lineage journal differs');
        previous = digest;
        const fact = entry.fact, source = entry.sourceKey;
        if (fact.kind === 'opening') {
            validBalances(fact.before); validBalances(fact.after);
            for (const type of material) {
                reconcile(fact.custodian, type, fact.before[type], source);
                const delta = fact.after[type] - fact.before[type];
                if (delta < 0) take(fact.custodian, type, -delta);
                if (delta > 0) add(fact.custodian, type, { ...empty(delta, fact.proof.origin), sourceKeys: [source] });
            }
        } else if (fact.kind === 'production') {
            const receipt = fact.receipt, owner = receipt.action;
            validBalances(receipt.before); validBalances(receipt.after);
            for (const type of material) reconcile(owner, type, receipt.before[type], source);
            if (receipt.outcome === 'raw-gained') {
                add(owner, 'raw', { ...empty(1, 'internal'), sourceKeys: [source], gatherers: [owner.actorId] }); produced++;
            } else {
                const input = take(owner, 'raw', 1), type = receipt.outcome === 'cooked' ? 'cooked' : 'burnt';
                add(owner, type, { ...input, sourceKeys: unique([...input.sourceKeys, source]), cooks: unique([...input.cooks, owner.actorId]) });
                transformed++; if (type === 'burnt') burnt++;
            }
            for (const type of material) if (pools.get(ownerKey(owner, type))!.quantity !== receipt.after[type]) throw new Error('Food transformation quantity differs');
        } else if (fact.kind === 'consumption') {
            if (!fact.result.receipt) continue;
            const receipt = fact.result.receipt;
            reconcile(receipt, 'cooked', receipt.before, source);
            const portion = take(receipt, 'cooked', 1);
            if (receipt.after !== receipt.before - 1) throw new Error('Food consumption quantity differs');
            consumptions.push({ ...portion, actionId: receipt.actionId,
                consumer: { worldId: receipt.worldId, actorId: receipt.actorId, username: receipt.username, lifecycleId: receipt.lifecycleId },
                sequence: entry.sequence, sourceKeys: unique([...portion.sourceKeys, source]), evidence: 'quantity-lineage',
                exactAssetLineage: 'unavailable', cleanTitleFinding: 'not-established' });
        } else {
            const { trade, sides } = fact;
            if (sides.length !== 2 || sides[0].custodian.username !== trade.fromUsername || sides[1].custodian.username !== trade.toUsername
                || sides[0].custodian.worldId !== sides[1].custodian.worldId) throw new Error('Food trade custodian differs');
            for (const side of sides) {
                validBalances(side.before); validBalances(side.after);
                for (const type of material) reconcile(side.custodian, type, side.before[type], source);
            }
            const out = [trade.fromItems, trade.toItems].map(items => {
                const counts: FoodBalances = { raw: 0, cooked: 0, burnt: 0 };
                for (const item of items) { const type = itemMaterial(item.id);
                    if (type) { if (!Number.isSafeInteger(item.count) || item.count < 1) throw new Error('Invalid food trade count'); counts[type] += item.count; } }
                return counts;
            });
            // Debit both sides before crediting either: circular exchange cannot spend its own incoming units.
            const portions = sides.map((side, i) => material.map(type => take(side.custodian, type, out[i]![type])));
            sides.forEach((side, i) => material.forEach((type, j) => {
                const portion = portions[i]![j]!, receiver = sides[1 - i]!.custodian;
                if (portion.quantity) {
                    if (side.custodian.lifecycleId === 'untracked' && receiver.lifecycleId !== 'untracked') portion.origin = 'import';
                    portion.sourceKeys = unique([...portion.sourceKeys, source]); add(receiver, type, portion); transferred += portion.quantity;
                }
            }));
            for (const side of sides) for (const type of material)
                if (pools.get(ownerKey(side.custodian, type))!.quantity !== side.after[type]) throw new Error('Food trade quantity/overflow differs');
        }
    }
    return { sourceId: journal.sourceId, headDigest: previous, produced, transformed, burnt, transferred,
        consumed: consumptions.length, consumptions, pools: Object.fromEntries(pools), gaps };
}
