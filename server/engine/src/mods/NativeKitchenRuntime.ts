import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import World from '../engine/World.js';
import LocType from '../cache/config/LocType.js';
import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { populationFoodContext, populationFoodTickClock } from './PopulationDeathRuntime.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import { NativeKitchenExecutor } from './NativeKitchen.js';
import type { NativeKitchenCommand, NativeKitchenResponse } from './NativeKitchenStore.js';
import { NativeKitchenReservationSource } from '../../../../production-workflow/native-kitchen-source.js';
import { loadNativeKitchenPolicy } from '../../../../production-workflow/native-kitchen-policy.js';
import { assertManagedModuleRoot, managedContext } from '../../../control-plane/instance-context.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';

const queue: Array<{ command: NativeKitchenCommand; expiresAt: number; resolve(result: NativeKitchenResponse): void }> = [];
let runtime: { executor: NativeKitchenExecutor; source: NativeKitchenReservationSource } | null = null;
export function enqueueNativeKitchen(command: NativeKitchenCommand): Promise<NativeKitchenResponse> {
    if (!command || Object.keys(command).sort().join(',') !== 'operation,runId' || !['issue', 'process', 'return'].includes(command.operation)
        || typeof command.runId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(command.runId))
        return Promise.resolve({ ok: false, error: 'Invalid native kitchen command' });
    if (queue.length >= 50) return Promise.resolve({ ok: false, error: 'Native kitchen queue is full' });
    return new Promise(resolve => queue.push({ command: structuredClone(command), expiresAt: Date.now() + 5000, resolve }));
}
export function tickNativeKitchen(): void {
    for (const item of queue.splice(0, 10)) {
        try {
            if (World.shutdown || Date.now() > item.expiresAt) throw new Error('Native kitchen command expired or world is shutting down');
            if (!runtime) {
                const root = fileURLToPath(new URL('../../../../', import.meta.url)); assertManagedModuleRoot(root);
                getSharedPlayerEscrowAuthority();
                const market = ensurePlayerSaveStore(), policy = loadNativeKitchenPolicy(root);
                const worldId = managedContext()?.id ?? `local:${foodDigest(root)}`;
                const source = new NativeKitchenReservationSource({ workspace: root, worldId, checkpointPath: join(root, '.local/economy/businesses.sqlite') });
                const clock = () => { const clock = populationFoodTickClock(World.currentTick); if (!clock) throw new Error('Native kitchen clock is unavailable'); return clock; };
                runtime = { source, executor: new NativeKitchenExecutor({ market, source, policy: loadNativeFoodProductionPolicy(root),
                    identity: populationFoodContext, clock, checkpoint: () => { World.checkpointPlayers(); },
                    heat: () => World.getLoc(policy.heat.x, policy.heat.z, policy.heat.level, LocType.getId(policy.heat.debugName)) }) };
            }
            const binding = runtime.source.read(item.command.runId);
            const player = World.getPlayerByUsername(binding.intent.username);
            if (!player && item.command.operation !== 'return') throw new Error('Native kitchen worker is offline');
            item.resolve({ ok: true, record: runtime.executor.execute(item.command, player ?? null) });
        } catch (error) { item.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
}
