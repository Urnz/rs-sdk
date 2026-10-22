import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import World from '../engine/World.js';
import ScriptFile from '../engine/script/ScriptFile.js';
import ScriptState from '../engine/script/ScriptState.js';
import ScriptPointer from '../engine/script/ScriptPointer.js';
import { ScriptOpcode } from '../engine/script/ScriptOpcode.js';
import InvOps from '../engine/script/handlers/InvOps.js';
import type { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore, type PlayerEscrowAssets, type PlayerInventoryEscrowWallet } from './PlayerInventoryEscrowStore.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import type { populationFoodContext } from './PopulationDeathRuntime.js';
import { FoodCommerceSource } from '../../../../agent-operated-shop/native-commerce-source.js';
import { commerceIds, type NativeCommerceCommand } from '../../../../agent-operated-shop/native-commerce.js';
import { loadNativeKitchenPolicy } from '../../../../production-workflow/native-kitchen-policy.js';
import { initializeNativeCommerce, readNativeCommerce, writeNativeCommerce, type NativeCommerceRecord } from './NativeCommerceStore.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { TradeEvidenceStore, type EngineTradeEvidence } from './TradeEvidenceStore.js';
export interface NativeCommercePorts { market: MarketStore; source: FoodCommerceSource; trades: TradeEvidenceStore;
    clock(): SimulationClockObservation; identity: typeof populationFoodContext; checkpoint(): void }
export class NativeCommerceExecutor {
    constructor(private readonly ports: NativeCommercePorts) {}
    execute(command: NativeCommerceCommand, worker: Player | null, counterparty: Player | null): NativeCommerceRecord {
        const p = this.ports, binding = p.source.order(command.operationId).binding, i = binding.intent, ids = commerceIds(i.operationId), clock = p.clock();
        initializeNativeCommerce(p.market.db); const escrow = new PlayerInventoryEscrowStore(p.market);
        const prior = readNativeCommerce(p.market.db).find(row => row.binding.intent.operationId === i.operationId);
        if (prior && prior.binding.digest !== binding.digest) throw new Error('Native commerce binding changed');
        if (prior && prior.phase !== 'admitted') return prior;
        if (p.trades.get(ids.tradeId)) throw new Error('Native commerce trade committed without a checkpoint receipt; reconciliation required');
        if (command.operation === 'cancel') {
            if (prior && [i.worker, i.counterparty].some((a, index) => {
                const bytes = p.market.saved(a.username); return !bytes || foodDigest([...bytes]) !== (index === 0 ? prior.checkpoints.worker : prior.checkpoints.counterparty);
            })) throw new Error('Admitted commerce checkpoint changed; reconciliation required');
            let result!: NativeCommerceRecord;
            p.market.db.transaction(() => { result = writeNativeCommerce(p.market.db, { binding, phase: 'cancelled',
                before: prior?.before ?? { worker: { gp: 0, item: 0 }, counterparty: { gp: 0, item: 0 } }, after: null,
                checkpoints: prior?.checkpoints ?? { worker: foodDigest([]), counterparty: foodDigest([]) }, trade: null }); }).immediate(); return result;
        }
        if (prior) throw new Error('Admitted native commerce cannot be blindly redispatched');
        if (!worker || !counterparty) throw new Error('Native commerce needs both live actors');
        const players = [worker, counterparty], actors = [i.worker, i.counterparty], offerId = InvType.getId('tradeoffer');
        const authorize = () => {
            if (p.source.order(i.operationId, p.clock()).binding.digest !== binding.digest) throw new Error('Native commerce authority changed');
            for (const [index, actor] of actors.entries()) {
                const player = players[index]!, context = p.identity(player.username, ids.tradeId, 0, World.currentTick);
                if (player.username !== actor.username || player.populationTerminal || player.levels[PlayerStat.HITPOINTS]! <= 0 || !context
                    || context.action.worldId !== i.worldId || context.action.actorId !== actor.agentId || context.action.lifecycleId !== actor.lifecycleId
                    || context.action.clockId !== i.clockId || context.action.clockProfileDigest !== i.clockProfileDigest)
                    throw new Error('Native commerce actor/lifecycle differs');
            }
        };
        authorize();
        const site = loadNativeKitchenPolicy(p.source.options.workspace).heat;
        if (players.some(a => a.populationSleeping || a.activeScript || a.protect || a.target || a.level !== site.level
            || Math.max(Math.abs(a.x - site.x), Math.abs(a.z - site.z)) > 3
            || a.getInventory(offerId)!.items.some(item => item !== null))) throw new Error('Native commerce actor is busy or outside its meeting site');
        if (worker.level !== counterparty.level || Math.max(Math.abs(worker.x - counterparty.x), Math.abs(worker.z - counterparty.z)) > 2)
            throw new Error('Native commerce partner is not reachable');
        const wallet = (a: Player): PlayerInventoryEscrowWallet => ({ count: id => a.getInventory(InvType.INV)!.getItemCount(id),
            remove: (id, n) => a.invDel(InvType.INV, id, n), add: (id, n) => a.invAdd(InvType.INV, id, n) });
        const count = (a: Player) => ({ gp: wallet(a).count(995), item: wallet(a).count(i.itemId) });
        const before = { worker: count(worker), counterparty: count(counterparty) }, amount = i.quantity * i.unitPriceGp;
        const businessOut = i.kind === 'sale' ? { id: i.itemId, count: i.quantity } : { id: 995, count: amount };
        const externalOut = i.kind === 'sale' ? { id: 995, count: amount } : { id: i.itemId, count: i.quantity };
        if (wallet(counterparty).count(externalOut.id) < externalOut.count) throw new Error('Native commerce payer/seller has insufficient assets');
        if (worker.getInventory(InvType.INV)!.freeSlotCount < (externalOut.id === 995 ? 1 : externalOut.count)
            || counterparty.getInventory(InvType.INV)!.freeSlotCount < (businessOut.id === 995 ? 1 : businessOut.count)
            || wallet(worker).count(externalOut.id) > 2147483647 - externalOut.count
            || wallet(counterparty).count(businessOut.id) > 2147483647 - businessOut.count) throw new Error('Native commerce inventory capacity is insufficient');
        const snapshots = players.map(a => [a.getInventory(InvType.INV)!, a.getInventory(offerId)!].map(inv => ({ inv, items: inv.items.map(item => item && { ...item }) })));
        const saveBoth = () => { p.checkpoint(); for (const a of players) p.market.checkpoint(a.username, a.save(false), true); };
        const checkpoints = () => ({ worker: foodDigest([...worker.save(false)]), counterparty: foodDigest([...counterparty.save(false)]) });
        let admitted!: NativeCommerceRecord;
        p.market.db.transaction(() => { saveBoth(); admitted = writeNativeCommerce(p.market.db,
            { binding, phase: 'admitted', before, after: null, checkpoints: checkpoints(), trade: null }); }).immediate();
        const assets = (item: { id: number; count: number }): PlayerEscrowAssets => item.id === 995 ? { gp: item.count, items: [] } : { gp: 0, items: [item] };
        const mutate = (operation: 'hold' | 'consume', id: string, a: Player, item?: { id: number; count: number }, w = wallet(a)) =>
            escrow.mutateWithCheckpoint(operation === 'hold' ? { operation, escrowId: id, username: a.username, assets: assets(item!) }
                : { operation, escrowId: id, username: a.username }, w, { owner: a.username, save: () => a.save(false), rollback: () => {} }, clock.wallTime, binding.digest);
        try {
            let result!: NativeCommerceRecord;
            p.market.db.transaction(() => {
                authorize(); let remaining = businessOut.count;
                const reserved: PlayerInventoryEscrowWallet = { count: id => id === businessOut.id ? remaining : 0,
                    remove: (id, n) => { if (id !== businessOut.id || n !== remaining) throw new Error('Business reserved assets differ'); remaining = 0; return n; },
                    add: () => { throw new Error('Business custody cannot become free worker stock'); } };
                mutate('hold', ids.businessOut, worker, businessOut, reserved); mutate('consume', ids.businessOut, worker);
                mutate('hold', ids.counterpartyOut, counterparty, externalOut); mutate('consume', ids.counterpartyOut, counterparty);
                if (worker.invAdd(offerId, businessOut.id, businessOut.count) !== businessOut.count
                    || counterparty.invAdd(offerId, externalOut.id, externalOut.count) !== externalOut.count) throw new Error('Native commerce offer staging is partial');
                const script = new ScriptFile(-1); script.intOperands = [0, 1]; script.opcodes = [ScriptOpcode.BOTH_MOVEINV, ScriptOpcode.BOTH_MOVEINV];
                const state = new ScriptState(script); state._activePlayer = worker; state._activePlayer2 = counterparty;
                for (const pointer of [ScriptPointer.ActivePlayer, ScriptPointer.ActivePlayer2, ScriptPointer.ProtectedActivePlayer, ScriptPointer.ProtectedActivePlayer2]) state.pointerAdd(pointer);
                let trade: EngineTradeEvidence | null = null;
                state.nativeFoodTradePorts = { market: p.market, identity: p.identity, checkpoint: () => {}, record: entry => {
                    authorize(); trade = p.trades.record({ tick: entry.tick, fromUsername: entry.from, toUsername: entry.to,
                        fromItems: entry.fromItems, toItems: entry.toItems, fromValue: entry.fromValue, toValue: entry.toValue, committedAt: clock.wallTime }, ids.tradeId); return trade;
                } };
                for (const pc of [0, 1]) { state.pc = pc; state.pushInt(offerId); state.pushInt(InvType.INV); InvOps[ScriptOpcode.BOTH_MOVEINV]!(state); }
                if (!trade) throw new Error('Native commerce did not commit both inventory movements');
                mutate('hold', ids.businessIn, worker, externalOut); mutate('consume', ids.businessIn, worker);
                const after = { worker: count(worker), counterparty: count(counterparty) };
                if (foodDigest(after.worker) !== foodDigest(before.worker)) throw new Error('Native commerce leaked Business custody to worker inventory');
                const { digest: _digest, ...admission } = admitted;
                saveBoth(); result = writeNativeCommerce(p.market.db, { ...admission, phase: 'completed', after, checkpoints: checkpoints(), trade });
            }).immediate(); return result;
        } catch (error) {
            for (const inventories of snapshots) for (const { inv, items } of inventories) items.forEach((item, slot) => inv.set(slot, item));
            throw error;
        }
    }
}
