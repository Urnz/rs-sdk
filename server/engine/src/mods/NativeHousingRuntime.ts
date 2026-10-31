import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import World from '../engine/World.js';
import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { assertManagedModuleRoot, managedContext } from '../../../control-plane/instance-context.js';
import { populationFoodContext, populationFoodTickClock } from './PopulationDeathRuntime.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { NativeRentSource } from '../../../../housing/native-rent-source.js';
import { openSimulationClockRuntime } from '../../../../simulation-clock/config.js';
import { NativeHousingExecutor } from './NativeHousing.js';
import type { NativeHousingCommand, NativeHousingResponse } from '../../../../housing/native-rent.js';
import { registerHousingTenantAccess } from './HousingAccess.js';
import type Player from '../engine/entity/Player.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
const queue: { command: NativeHousingCommand; expiresAt: number; resolve(result: NativeHousingResponse): void }[] = [];
let runtime: { engine: NativeHousingExecutor; source: NativeRentSource; time: ReturnType<typeof openSimulationClockRuntime> } | null = null;
function getRuntime() {
    if (runtime) return runtime;
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); assertManagedModuleRoot(root);
    const housingPath = join(root, '.local/economy/housing.sqlite');
    if (!existsSync(housingPath) || !existsSync(join(root, '.local/simulation/simulation-clock.sqlite'))) return null;
    const source = new NativeRentSource({ workspace: root, worldId: managedContext()?.id ?? `local:${foodDigest(root)}`, housingPath,
        propertyPath: process.env.PROPERTY_STATE_DB || join(root, '.local/admin/properties.sqlite'), checkpointPath: '' });
    try {
        getSharedPlayerEscrowAuthority(); const market = ensurePlayerSaveStore(); source.options.checkpointPath = market.db.filename;
        const time = openSimulationClockRuntime(join(root, 'config/simulation-clock.json'), join(root, '.local/simulation/simulation-clock.sqlite'));
        runtime = { source, time, engine: new NativeHousingExecutor({ source, market, time: time.store, identity: populationFoodContext,
            checkpoint: () => { World.checkpointPlayers(); }, clock: () => { const clock = populationFoodTickClock(World.currentTick); if (!clock) throw new Error('Housing clock unavailable'); return clock; } }) };
        return runtime;
    } catch (error) { source.close(); throw error; }
}
registerHousingTenantAccess((propertyId, username) => {
    const r = getRuntime(), clock = populationFoodTickClock(World.currentTick); if (!r || !clock) return false;
    return r.source.active().some(order => {
        const i = order.binding.intent;
        if (i.tenant.username !== username || i.catalogs.units.units.find(u => u.housingUnitId === i.housingUnitId)?.propertyId !== propertyId) return false;
        const context = populationFoodContext(username, i.operationId, 0, World.currentTick);
        if (context?.action.lifecycleId !== i.tenant.lifecycleId) return false;
        r.source.entitlement(i.operationId, clock); return true;
    });
});
export function enqueueNativeHousing(command: NativeHousingCommand): Promise<NativeHousingResponse> {
    if (!command || Object.keys(command).sort().join(',') !== 'operation,operationId' || !['pay', 'cancel', 'sleep', 'wake','owner-sleep','owner-wake'].includes(command.operation)
        || typeof command.operationId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(command.operationId)) return Promise.resolve({ ok: false, error: 'Invalid housing command' });
    if (queue.length >= 50) return Promise.resolve({ ok: false, error: 'Housing queue full' });
    return new Promise(resolve => queue.push({ command: structuredClone(command), expiresAt: Date.now() + 5000, resolve }));
}
export function refreshNativeHousing(): void {
    const r = getRuntime(); if (!r) return;
    for (const state of r.time.store.listPlayerTimeStates(r.time.clockId)) {
        if (state.sleepContext?.access.evidenceId.startsWith('housing:')) {
            const player = World.getPlayerByUsername(state.playerId) ?? null;
            try { r.engine.validateSleeper(state.playerId, player); }
            catch { if (player) { player.populationSleeping = true; player.stopAction(); player.clearWaypoints(); } }
        }
    }
}
export function observeNativeHousingSleeper(username:string,player:Player,clock:SimulationClockObservation){
    return getRuntime()?.engine.observeSleeper(username,player,clock)??null;
}
export function tickNativeHousing(): void {
    refreshNativeHousing();
    for (const item of queue.splice(0, 10)) {
        try {
            if (World.shutdown || Date.now() > item.expiresAt) throw new Error('Housing command expired');
            const r = getRuntime(); if (!r) throw new Error('Housing reservation unavailable');
            const ownerCommand=item.command.operation==='owner-sleep'||item.command.operation==='owner-wake';
            const i=ownerCommand?r.source.ownerBed(item.command.operationId).intent:r.source.order(item.command.operationId).binding.intent;
            const actor='owner' in i?i.owner:i.tenant,landlord='landlord' in i?World.getPlayerByUsername(i.landlord.username)??null:null;
            const phase = r.engine.execute(item.command, World.getPlayerByUsername(actor.username) ?? null, landlord);
            item.resolve({ ok: true, operationId: item.command.operationId, phase });
        } catch (error) { item.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
}
