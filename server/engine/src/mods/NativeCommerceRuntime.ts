import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import World from '../engine/World.js';
import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { populationFoodContext, populationFoodTickClock } from './PopulationDeathRuntime.js';
import { assertManagedModuleRoot, managedContext } from '../../../control-plane/instance-context.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { getTradeEvidenceStore } from './TradeEvidenceStore.js';
import { FoodCommerceSource } from '../../../../agent-operated-shop/native-commerce-source.js';
import { NativeCommerceExecutor } from './NativeCommerce.js';
import type { NativeCommerceCommand, NativeCommerceResponse } from '../../../../agent-operated-shop/native-commerce.js';

const queue: Array<{ command: NativeCommerceCommand; expiresAt: number; resolve(result: NativeCommerceResponse): void }> = [];
let runtime: { source: FoodCommerceSource; executor: NativeCommerceExecutor } | null = null;
export function enqueueNativeCommerce(command: NativeCommerceCommand): Promise<NativeCommerceResponse> {
    if (!command || Object.keys(command).sort().join(',') !== 'operation,operationId' || !['execute', 'cancel'].includes(command.operation)
        || typeof command.operationId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(command.operationId))
        return Promise.resolve({ ok: false, error: 'Invalid native commerce command' });
    if (queue.length >= 50) return Promise.resolve({ ok: false, error: 'Native commerce queue is full' });
    return new Promise(resolve => queue.push({ command: structuredClone(command), expiresAt: Date.now() + 5000, resolve }));
}
export function tickNativeCommerce(): void {
    for (const item of queue.splice(0, 10)) {
        try {
            if (World.shutdown || Date.now() > item.expiresAt) throw new Error('Native commerce command expired');
            if (!runtime) {
                const root = fileURLToPath(new URL('../../../../', import.meta.url)); assertManagedModuleRoot(root);
                getSharedPlayerEscrowAuthority();
                const worldId = managedContext()?.id ?? `local:${foodDigest(root)}`;
                const source = new FoodCommerceSource({ workspace: root, worldId, businessPath: join(root, '.local/economy/businesses.sqlite'),
                    treasuryPath: join(root, '.local/economy/institution-treasury.sqlite'), journalPath: join(root, '.local/economy/food-commerce.sqlite'),
                    checkpointPath: '', tradePath: '' });
                runtime = { source, executor: new NativeCommerceExecutor({ market: ensurePlayerSaveStore(), source, trades: getTradeEvidenceStore(),
                    identity: populationFoodContext, checkpoint: () => { World.checkpointPlayers(); },
                    clock: () => { const clock = populationFoodTickClock(World.currentTick); if (!clock) throw new Error('Native commerce clock unavailable'); return clock; } }) };
            }
            const i = runtime.source.order(item.command.operationId).binding.intent;
            const result = runtime.executor.execute(item.command, World.getPlayerByUsername(i.worker.username) ?? null, World.getPlayerByUsername(i.counterparty.username) ?? null);
            // The status channel never publishes private inventory or treasury observations.
            item.resolve({ ok: true, operationId: i.operationId, phase: result.phase });
        } catch (error) { item.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
}
