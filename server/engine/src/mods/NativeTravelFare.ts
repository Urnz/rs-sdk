import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import NpcType from '../cache/config/NpcType.js';
import type ScriptState from '../engine/script/ScriptState.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { ensurePlayerSaveStore, type MarketStore } from '../engine/market/MarketStore.js';
import World from '../engine/World.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { NativeTravelFareStore, readNativeTravelFares, validateNativeTravelFare, type NativeTravelFareReceipt } from './NativeTravelFareStore.js';

export interface NativeTravelFarePorts {
    market: MarketStore; identity: typeof populationFoodContext; checkpoint(save: Uint8Array): void;
}
/** Witness only for the two existing protected native content deletions. No new client operation or caller receipt. */
export function handleNativeTravelFare(state: ScriptState, inventory: number, item: number, count: number): boolean {
    const script = state.script.name;
    if (inventory !== InvType.INV || item !== 995 || !['[label,karamja_sailor_dialogue]', '[label,customs_pay]'].includes(script)) return false;
    const player = state.activePlayer, id = state.nativeTravelFareId ??= randomUUID();
    const identity = (state.nativeTravelFarePorts?.identity ?? populationFoodContext)(player.username, id, 0, World.currentTick);
    if (!identity) return false; // Unenrolled vanilla actors keep the upstream behavior, without a society receipt.
    const npc = state._activeNpc;
    if (!npc || count !== 30 || player.populationTerminal || player.levels[PlayerStat.HITPOINTS] <= 0
        || player.level !== npc.level || Math.max(Math.abs(player.x - npc.x), Math.abs(player.z - npc.z)) > 2
        || identity.action.username !== player.username || identity.action.actionId !== id
        || identity.action.clockId !== identity.clock.clockId || identity.action.clockProfileDigest !== identity.clock.profileDigest
        || identity.clock.engineTick !== World.currentTick) throw new Error('Native travel fare lacks its live actor/content authority');
    const ports = state.nativeTravelFarePorts ?? (() => {
        getSharedPlayerEscrowAuthority();
        return { market: ensurePlayerSaveStore(), identity: populationFoodContext,
            checkpoint: (save: Uint8Array) => { World.checkpointPlayers(player, save); } };
    })();
    const inv = player.getInventory(InvType.INV)!, original = inv.items.map(v => v && { ...v });
    const store = new NativeTravelFareStore(ports.market.db), prior = readNativeTravelFares(ports.market.db).find(r => r.id === id);
    const binding = { id, worldId: identity.action.worldId, actorId: identity.action.actorId, username: player.username,
        lifecycleId: identity.action.lifecycleId, route: script === '[label,customs_pay]' ? 'karamja-to-port-sarim' : 'port-sarim-to-karamja',
        source: { script, npc: NpcType.get(npc.type).debugname!, x: npc.x, z: npc.z, level: npc.level } } as const;
    if (prior) {
        for (const key of ['worldId', 'actorId', 'username', 'lifecycleId', 'route'] as const)
            if (prior[key] !== binding[key]) throw new Error('Native travel fare replay binding differs');
        if (prior.clock.clockId !== identity.clock.clockId || prior.clock.profileDigest !== identity.clock.profileDigest)
            throw new Error('Native travel fare replay clock binding differs');
        state.execution = 1; return true; // Never repeat either the charge or the following boarding script on replay.
    }
    try {
        ports.market.db.transaction(() => {
            const fresh = ports.identity(player.username, id, 0, World.currentTick);
            if (!fresh || foodDigest(fresh.action) !== foodDigest(identity.action) || player.populationTerminal
                || fresh.action.clockId !== fresh.clock.clockId || fresh.action.clockProfileDigest !== fresh.clock.profileDigest
                || fresh.clock.engineTick !== World.currentTick)
                throw new Error('Native travel fare lifecycle changed');
            const beforeGp = inv.getItemCount(995);
            const candidate: NativeTravelFareReceipt = { ...binding, amountGp: 30, beforeGp, afterGp: beforeGp - 30,
                clock: fresh.clock, checkpointDigest: '0'.repeat(64) };
            validateNativeTravelFare(candidate);
            if (player.invDel(InvType.INV, 995, 30) !== 30 || inv.getItemCount(995) !== candidate.afterGp)
                throw new Error('Native travel fare deletion differs');
            const save = player.save(false);
            ports.checkpoint(save); ports.market.checkpoint(player.username, save, true);
            store.append({ ...candidate, checkpointDigest: foodDigest([...save]) });
        }).immediate();
    } catch (error) { original.forEach((v, slot) => inv.set(slot, v)); throw error; }
    return true;
}
