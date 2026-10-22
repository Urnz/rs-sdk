import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { foodDigest } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { assertNativeFoodSourcePath } from './native-food-source.js';
import { assertFoodProductionSchema, readFoodProductionReceipt, validateFoodProductionAction,
    type FoodProductionAction, type FoodProductionReceipt } from '../../engine/src/mods/NativeFoodProductionStore.js';

export function readNativeFoodProductionSource(path: string, raw: FoodProductionAction):
    { status: 'unavailable' | 'missing' | 'pending'; receipt: null } | { status: 'completed'; receipt: FoodProductionReceipt } {
    const action = validateFoodProductionAction(raw);
    assertNativeFoodSourcePath(path, action.worldId);
    if (!existsSync(path)) return { status: 'unavailable', receipt: null };
    const db = new Database(path, { readonly: true, strict: true });
    try {
        let snapshot!: ReturnType<typeof readNativeFoodProductionSource>;
        db.transaction(() => {
            if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_food_production_schema'").get()) {
                snapshot = { status: 'unavailable', receipt: null }; return;
            }
            assertFoodProductionSchema(db);
            const row = db.query('SELECT request_digest FROM native_food_production_actions WHERE action_id=?1').get(action.actionId) as { request_digest: string } | null;
            if (!row) { snapshot = { status: 'missing', receipt: null }; return; }
            if (row.request_digest !== foodDigest(action)) throw new Error('Native food production source identity mismatch');
            const receipt = readFoodProductionReceipt(db, action.actionId);
            snapshot = receipt ? { status: 'completed', receipt } : { status: 'pending', receipt: null };
        }).deferred();
        return snapshot;
    } finally { db.close(true); }
}
