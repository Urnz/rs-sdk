import { existsSync, realpathSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { resolve, sep } from 'node:path';
import { managedContext } from '../../control-plane/instance-context.js';
import { assertFoodSchema, readFoodResult, validateFoodAction, foodDigest,
    type FoodAction, type FoodResult } from '../../engine/src/mods/NativeFoodConsumptionStore.js';

/** Internal source reader. Callers must pass the selected world's canonical checkpoint path and exact request. */
type SourceResult = { status: 'unavailable' | 'missing' | 'pending'; result: null } | { status: 'completed'; result: FoodResult };
export function assertNativeFoodSourcePath(checkpointPath: string, worldId: string): void {
    const managed = managedContext();
    if (managed && (worldId !== managed.id || !resolve(checkpointPath).toLowerCase()
        .startsWith((resolve(managed.workspace, 'server/engine/data') + sep).toLowerCase())))
        throw new Error('Native food source belongs to another managed world');
    if (managed && existsSync(checkpointPath) && !realpathSync(checkpointPath).toLowerCase()
        .startsWith((realpathSync(resolve(managed.workspace, 'server/engine/data')) + sep).toLowerCase()))
        throw new Error('Native food source resolves outside the managed world');
}
export function readNativeFoodSource(checkpointPath: string, raw: FoodAction): SourceResult {
    const action = validateFoodAction(raw);
    assertNativeFoodSourcePath(checkpointPath, action.worldId);
    if (!existsSync(checkpointPath)) return { status: 'unavailable', result: null };
    const db = new Database(checkpointPath, { readonly: true, strict: true });
    try {
        let snapshot!: SourceResult;
        db.transaction(() => {
            snapshot = (() => {
                if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_food_schema'").get())
                    return { status: 'unavailable' as const, result: null };
                assertFoodSchema(db);
                const row = db.query('SELECT request_digest FROM native_food_actions WHERE action_id=?1')
                    .get(action.actionId) as { request_digest: string } | null;
                if (!row) return { status: 'missing' as const, result: null };
                if (row.request_digest !== foodDigest(action)) throw new Error('Native food source identity mismatch');
                const result = readFoodResult(db, action.actionId);
                return result ? { status: 'completed' as const, result } : { status: 'pending' as const, result: null };
            })();
        }).deferred();
        return snapshot;
    } finally { db.close(true); }
}
