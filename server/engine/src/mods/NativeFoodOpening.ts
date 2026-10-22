import { existsSync } from 'node:fs';
import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import World from '../engine/World.js';
import { ensurePlayerSaveStore, type MarketStore } from '../engine/market/MarketStore.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { appendFoodLineage, foodCustodian, initializeFoodLineage } from './NativeFoodLineageStore.js';
import { SocietyIntegrityStore, type IntegrityMutation } from '../../../../society-integrity/store.js';
import { societyIntegrityDbPath } from '../../../../society-integrity/runtime.js';

/** Called after the existing offline-save integrity boundary commits, using verified native Player loads. */
export function recordNativeFoodOpening(mutation: IntegrityMutation, before: Player, after: Player, save: Uint8Array,
    ports?: { market: MarketStore; identity: typeof populationFoodContext; integrityPath: string }): void {
    const integrityPath = ports?.integrityPath ?? societyIntegrityDbPath;
    if (!existsSync(integrityPath)) return;
    if (before.username !== after.username || mutation.actor !== `player:${after.username}`) throw new Error('Food opening actor differs');
    const identity = (ports?.identity ?? populationFoodContext)(after.username, mutation.operationId.replace('offline-save:', ''), 0, World.currentTick);
    if (!identity) return;
    const source = new SocietyIntegrityStore(integrityPath, true);
    let proof;
    try { proof = source.foodMutationOrigin(mutation); } finally { source.close(); }
    if (!proof || proof.clockId !== identity.action.clockId || proof.profileDigest !== identity.action.clockProfileDigest) return;
    const balances = (player: Player) => { const inv = player.getInventory(InvType.INV)!;
        return { raw: inv.getItemCount(377), cooked: inv.getItemCount(379), burnt: inv.getItemCount(381) }; };
    const prior = balances(before), next = balances(after);
    const payload = mutation.payload as { before: { inventory: Array<{ id: number; count: number }> }; after: { inventory: Array<{ id: number; count: number }> } };
    for (const [name, id] of [['raw', 377], ['cooked', 379], ['burnt', 381]] as const) {
        const count = (items: Array<{ id: number; count: number }>) => items.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
        if (count(payload.before.inventory) !== prior[name] || count(payload.after.inventory) !== next[name]) throw new Error('Food opening inventory proof differs');
    }
    if (foodDigest(prior) === foodDigest(next)) return;
    const market = ports?.market ?? ensurePlayerSaveStore();
    market.db.transaction(() => {
        initializeFoodLineage(market.db); market.checkpoint(after.username, save, true);
        appendFoodLineage(market.db, { kind: 'opening', mutation, proof, custodian: foodCustodian(identity),
            before: prior, after: next, checkpointDigest: foodDigest([...save]) });
    }).immediate();
}
