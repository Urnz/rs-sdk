import { Database } from 'bun:sqlite';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { managedContext } from '../server/control-plane/instance-context.js';
import { assertFoodSchema, readFoodResult, type FoodResult } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { readFoodDeliveries, type FoodDeliverySnapshot } from '../server/engine/src/mods/NativeFoodDeliveryStore.js';
import { readFoodLineage } from '../server/engine/src/mods/NativeFoodLineageStore.js';
import { readNativeTradeLedger } from '../external-trade/source.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { projectFoodLineage } from './lineage.js';
import type { ItemProvenanceStore } from '../item-provenance/store.js';
import { SocietyIntegrityStore } from '../society-integrity/store.js';
import { join } from 'node:path';

export interface NativeFoodSourceOptions { workspace: string; worldId: string; checkpointPath: string }
function physical(path: string): string {
    const parts: string[] = []; let current = resolve(path);
    while (!existsSync(current)) { const parent = dirname(current);
        if (parent === current) throw new Error('Native food workspace is unavailable');
        parts.unshift(relative(parent, current)); current = parent; }
    return resolve(realpathSync(current), ...parts);
}
export function assertNativeFoodPath(options: NativeFoodSourceOptions): void {
    const managed = managedContext(), workspace = physical(options.workspace);
    if (managed && (options.worldId !== managed.id || workspace !== physical(managed.workspace)))
        throw new Error('Native food source belongs to another managed world');
    const base = managed ? physical(resolve(workspace, 'server/engine/data')) : workspace;
    const rel = relative(base, physical(options.checkpointPath));
    if (!rel || rel.startsWith('..')) throw new Error('Native food source escapes selected world');
}
export function assertNativeFoodDomainPath(options: NativeFoodSourceOptions): void {
    const managed = managedContext(), workspace = physical(options.workspace);
    if (managed && (options.worldId !== managed.id || workspace !== physical(managed.workspace)))
        throw new Error('Native food domain source belongs to another managed world');
    const rel = relative(physical(resolve(workspace, '.local')), physical(options.checkpointPath));
    if (!rel || rel.startsWith('..')) throw new Error('Native food domain source escapes selected world');
}
/** Read-only capability created by the backend from the selected world's path; never from uploaded receipts. */
export class NativeFoodSource {
    private readonly database: Database;
    private active: FoodDeliverySnapshot | null = null;
    constructor(readonly options: NativeFoodSourceOptions) {
        assertNativeFoodPath(options);
        this.database = new Database(options.checkpointPath, { readonly: true, strict: true });
        try { this.database.run('PRAGMA busy_timeout=5000'); }
        catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    snapshot<T>(work: () => T): T {
        if (this.active) return work();
        let result!: T;
        this.database.transaction(() => {
            assertFoodSchema(this.database);
            this.active = readFoodDeliveries(this.database);
            try { result = work(); } finally { this.active = null; }
        }).deferred();
        return result;
    }
    current(): FoodDeliverySnapshot {
        if (!this.active) throw new Error('Native food source requires a read snapshot');
        return structuredClone(this.active);
    }
    delivery(sequence: number): { entry: FoodDeliverySnapshot['entries'][number]; result: FoodResult } {
        const entry = this.current().entries[sequence - 1];
        if (!Number.isSafeInteger(sequence) || sequence < 1 || !entry) throw new Error('Native food delivery is missing');
        const result = readFoodResult(this.database, entry.actionId)!;
        if (result.action.worldId !== this.options.worldId) throw new Error('Native food delivery belongs to another world');
        return { entry, result };
    }
    /** Trade rows are checked against their own engine audit; uploaded transfer claims are never accepted. */
    lineage(tradePath: string, provenance?: Pick<ItemProvenanceStore, 'foodSourceGate'>) {
        const current = this.current();
        assertNativeFoodPath({ ...this.options, checkpointPath: tradePath });
        if (!this.database.query("SELECT 1 FROM sqlite_master WHERE name='native_food_lineage_schema'").get())
            return { status: 'unavailable' as const, projection: null };
        const journal = readFoodLineage(this.database), trades = readNativeTradeLedger(tradePath);
        const gaps: string[] = [];
        const witnessed = new Set(journal.entries.map(entry => entry.sourceKey));
        for (const entry of journal.entries) {
            const fact = entry.fact;
            if (fact.kind === 'transfer') {
                const trade = trades.find(value => value.event.eventId === fact.trade.eventId);
                if (!trade || foodDigest(trade.event) !== foodDigest(fact.trade)) throw new Error('Food lineage native trade source differs');
                if (fact.sides.some(side => side.custodian.worldId !== this.options.worldId)) throw new Error('Food lineage trade world differs');
            } else if (fact.kind === 'opening') {
                const integrityPath = join(this.options.workspace, '.local/simulation/society-integrity.sqlite');
                assertNativeFoodDomainPath({ ...this.options, checkpointPath: integrityPath });
                const integrity = new SocietyIntegrityStore(integrityPath, true);
                try {
                    if (foodDigest(integrity.foodMutationOrigin(fact.mutation)) !== foodDigest(fact.proof)
                        || fact.custodian.worldId !== this.options.worldId || fact.mutation.actor !== `player:${fact.custodian.username}`)
                        throw new Error('Food opening native origin source differs');
                } finally { integrity.close(); }
            } else {
                const action = fact.kind === 'production' ? fact.receipt.action : fact.result.action;
                if (action.worldId !== this.options.worldId) throw new Error('Food lineage world differs');
            }
        }
        for (const trade of trades) if ([...trade.event.fromItems, ...trade.event.toItems].some(item => [377, 379, 381].includes(item.id ?? -1))
            && !witnessed.has(`trade:${trade.event.eventId}`)) gaps.push(`unwitnessed-trade:${trade.event.eventId}`);
        for (const entry of current.entries) if (!witnessed.has(`consumption:${entry.actionId}`)) gaps.push(`legacy-consumption:${entry.actionId}`);
        const projection = projectFoodLineage(journal);
        const sources = new Map(journal.entries.filter(entry => entry.fact.kind === 'production').map(entry => [entry.sourceKey,
            { sourceRecordId: entry.fact.kind === 'production' ? entry.fact.receipt.action.actionId : '',
                sourceEvidenceDigest: foodDigest(entry.fact.kind === 'production' ? entry.fact.receipt : null) }]));
        const consumptions = projection.consumptions.map(item => {
            const gate = provenance?.foodSourceGate(item.sourceKeys.flatMap(key => sources.has(key) ? [sources.get(key)!] : [])) ?? 'not-established';
            return { ...item, provenanceGate: gate, internalSupply: item.origin === 'internal' && !gaps.length && gate !== 'stolen'
                ? 'verified' as const : 'unproven' as const };
        });
        return { status: 'available' as const, projection: { ...projection, consumptions, sourceGaps: gaps } };
    }
}
