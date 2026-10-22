import { OwnedFoodDatabase } from './owned-database.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NeedsStore, type NeedsWriteCommand } from '../needs/store.js';
import type { NeedsDynamicsPolicy, NeedsPolicy } from '../needs/types.js';
import { FoodConsumptionStore } from './consumption-store.js';
import type { ClosedFoodLoop, FoodLoopCatalog } from './types.js';
import { NativeFoodConsumptionProjection } from './native-consumption-store.js';

/** One owned connection for needs, legacy food bookkeeping and native receipt/relief recovery. */
export class FoodNeedsPersistence {
    private readonly database: OwnedFoodDatabase;
    readonly needs!: NeedsStore;
    readonly food!: FoodConsumptionStore;
    readonly nativeFood: NativeFoodConsumptionProjection;
    constructor(path: string, policy: NeedsPolicy, dynamics: NeedsDynamicsPolicy, catalog: FoodLoopCatalog) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new OwnedFoodDatabase(path, { create: true, strict: true });
        try {
            this.database.run('PRAGMA busy_timeout=5000');
            this.database.run('PRAGMA foreign_keys=ON');
            this.database.run('PRAGMA journal_mode=WAL');
            this.database.run('PRAGMA synchronous=FULL');
            let stores!: { food: FoodConsumptionStore; needs: NeedsStore };
            this.database.transaction(() => { stores = { food: new FoodConsumptionStore(this.database, catalog),
                needs: new NeedsStore(this.database, policy, dynamics) }; }).immediate();
            this.food = stores.food; this.needs = stores.needs;
            this.nativeFood = new NativeFoodConsumptionProjection(this.database, this.needs, catalog);
        } catch (error) { this.database.close(true); throw error; }
    }
    /** Does not apply hunger relief; it prepares the shared atomic boundary without a shadow state. */
    commit(command: NeedsWriteCommand, closure?: ClosedFoodLoop) {
        if (closure && closure.hungerRelief !== 0) throw new Error('Native needs relief requires the SI-A04 receipt adapter');
        let result!: { state: ReturnType<NeedsStore['execute']>; event: ReturnType<FoodConsumptionStore['record']> | null };
        this.database.transaction(() => {
            const state = this.needs.execute(command);
            if (closure && (closure.actorAgentId !== state.binding.actorId
                || closure.state.clockId !== state.binding.clockId
                || closure.previousNeedsStateDigest !== state.state.digest)) throw new Error('Food/needs transaction binding mismatch');
            const event = closure ? this.food.record(closure) : null;
            result = { state, event };
        }).immediate();
        return result;
    }
    close(): void { this.database.close(true); }
}
