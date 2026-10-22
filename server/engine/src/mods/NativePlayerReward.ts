import type Player from '../engine/entity/Player.js';
import InvType from '../cache/config/InvType.js';
import type { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerRewardStore, type PlayerRewardRecord } from './PlayerRewardStore.js';
import { withSocietyValueMutation, type IntegrityBoundary } from '../../../../society-integrity/runtime.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';

/** A wage receipt and its spendable Player save share the canonical SQLite commit.
 * The historical reward file is only a forward projection, repaired by exact-ID replay. */
export function creditNativePlayerReward(market: MarketStore, projection: PlayerRewardStore, player: Player,
    settlementId: string, amount: number, options: { checkpoint?(save: Uint8Array): void; integrity?: IntegrityBoundary | false; now?: string } = {}): PlayerRewardRecord {
    const canonical = new PlayerRewardStore(':memory:', false, market.db), prior = canonical.get(settlementId);
    if (prior?.status === 'committed') {
        if (prior.username !== player.username || prior.amount !== amount) throw new Error('Native reward ID binding differs');
        return projection.projectCheckpoint(canonical, settlementId);
    }
    if (!prior && projection.get(settlementId)) throw new Error('Legacy reward has no atomic checkpoint proof; reconciliation required');
    const inventory = player.getInventory(InvType.INV)!, items = inventory.items.map(i => i && { ...i });
    const before = inventory.getItemCount(995), beforeSave = market.saved(player.username) ?? player.save(false);
    if (!market.saved(player.username)) market.checkpoint(player.username, beforeSave, true);
    let rolledBack = false;
    const mutation = { source: 'engine.player-reward' as const, operationId: `player-reward:${settlementId}`, actor: `player:${player.username}`, payload: { amountGp: amount } };
    const result = withSocietyValueMutation(mutation, () => {
        try {
            let receipt!: PlayerRewardRecord;
            market.db.transaction(() => {
                receipt = canonical.credit(settlementId, player.username, amount, { balance: () => inventory.getItemCount(995),
                    credit: n => player.invAdd(InvType.INV, 995, n), remove: n => player.invDel(InvType.INV, 995, n) }, options.now);
                const save = player.save(false); options.checkpoint?.(save); market.checkpoint(player.username, save, true);
            }).immediate();
            return receipt;
        } catch (error) {
            items.forEach((item, slot) => inventory.set(slot, item)); rolledBack = true; throw error;
        }
    }, options.integrity, undefined, () => rolledBack && inventory.getItemCount(995) === before
        && foodDigest([...(market.saved(player.username) ?? [])]) === foodDigest([...beforeSave]) && !canonical.get(settlementId)
        ? { nativeStatus: 'rejected', coinsBefore: before, coinsAfter: before } : null);
    // A projection failure preserves the already committed wallet and canonical receipt.
    projection.projectCheckpoint(canonical, settlementId);
    return result;
}
