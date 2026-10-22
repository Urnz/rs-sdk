import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import type Player from '../engine/entity/Player.js';
import type Loc from '../engine/entity/Loc.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import World from '../engine/World.js';
import type { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore, type PlayerInventoryEscrowWallet } from './PlayerInventoryEscrowStore.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore } from './NativeFoodProductionStore.js';
import type { NativeFoodProductionPorts } from './NativeFoodProduction.js';
import { NativeKitchenReservationSource } from '../../../../production-workflow/native-kitchen-source.js';
import type { NativeKitchenBinding } from '../../../../production-workflow/native-kitchen-wip.js';
import { initializeNativeKitchen, readNativeKitchen, writeNativeKitchen, type NativeKitchenRecord } from './NativeKitchenStore.js';
import type { NativeKitchenCommand } from './NativeKitchenStore.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

export interface NativeKitchenPorts extends NativeFoodProductionPorts {
    source: NativeKitchenReservationSource; clock(): SimulationClockObservation;
    /** A real reachable engine location, selected from the configured kitchen binding. */
    heat(): Loc | null;
}
export class NativeKitchenExecutor {
    private readonly pending = new Map<string, { state: ScriptState; wakeTick: number }>();
    constructor(private readonly ports: NativeKitchenPorts) {}
    execute(command: NativeKitchenCommand, player: Player | null): NativeKitchenRecord {
        const ports = this.ports, clock = ports.clock(), binding = ports.source.read(command.runId), intent = binding.intent;
        if (player && player.username !== intent.username) throw new Error('Native kitchen checkpoint worker differs');
        const market = ports.market, escrow = new PlayerInventoryEscrowStore(market);
        initializeNativeKitchen(market.db); new NativeFoodProductionStore(market.db);
        const prior = readNativeKitchen(market.db).find(record => record.binding.intent.runId === command.runId);
        if (prior && prior.binding.digest !== binding.digest) throw new Error('Native kitchen binding changed');
        if (prior && (prior.phase.startsWith('returned') || command.operation === 'issue' || command.operation === 'process' && prior.phase === 'processed')) return prior;
        if (command.operation !== 'issue' && !prior) throw new Error('Native kitchen input has not been issued');
        if (clock.clockId !== intent.clockId || clock.profileDigest !== intent.clockProfileDigest) throw new Error('Native kitchen recovery clock differs');
        const authorize = () => {
            const current = ports.source.read(command.runId, ports.clock());
            if (current.digest !== binding.digest || !player || player.username !== intent.username || player.populationTerminal
                || player.levels[PlayerStat.HITPOINTS] === 0) throw new Error('Native kitchen worker is not alive and bound');
            const identity = ports.identity(player.username, intent.actionId, 0, World.currentTick);
            if (!identity || identity.action.worldId !== intent.worldId || identity.action.actorId !== intent.actorAgentId
                || identity.action.lifecycleId !== intent.lifecycleId || identity.action.clockId !== intent.clockId
                || identity.action.clockProfileDigest !== intent.clockProfileDigest) throw new Error('Native kitchen worker lifecycle differs');
        };
        if (command.operation !== 'return') authorize();
        const inventory = player?.getInventory(InvType.INV), original = inventory?.items.map(item => item && { ...item });
        const vars = player?.vars.slice(), levels = player?.levels.slice(), stats = player?.stats.slice(), baseLevels = player?.baseLevels.slice();
        const strings = player ? [...player.varsString] : null;
        const flags = player ? { delayed: player.delayed, delayedUntil: player.delayedUntil, protect: player.protect,
            lastUseItem: player.lastUseItem } : null;
        const queued = player ? new Set([...player.queue.all(), ...player.weakQueue.all()]) : null;
        const stopContinuation = () => {
            if (!player || !queued || command.operation !== 'process') return;
            for (const entry of [...player.queue.all(), ...player.weakQueue.all()]) if (!queued.has(entry)) entry.unlink();
            player.clearInteraction();
        };
        const save = () => {
            const bytes = player ? player.save(false) : market.saved(intent.username);
            if (!bytes) throw new Error('Native kitchen frozen Player checkpoint is absent');
            if (player) ports.checkpoint(bytes);
            market.checkpoint(intent.username, bytes, true); return bytes;
        };
        const wallet: PlayerInventoryEscrowWallet = { count: id => inventory?.getItemCount(id) ?? 0,
            remove: (id, count) => { if (!player) throw new Error('No live kitchen wallet'); return player.invDel(InvType.INV, id, count); },
            add: (id, count) => { if (!player) throw new Error('No live kitchen wallet'); return player.invAdd(InvType.INV, id, count); } };
        const mutate = (operation: 'hold' | 'consume', escrowId: string, item?: number, sourceWallet = wallet) =>
            escrow.mutateWithCheckpoint(operation === 'hold' ? { operation, escrowId, username: intent.username,
                assets: { gp: 0, items: [{ id: item!, count: 1 }] } } : { operation, escrowId, username: intent.username }, sourceWallet,
            { owner: intent.username, save, rollback: () => {} }, clock.wallTime, binding.digest);
        try {
            let result!: NativeKitchenRecord;
            const execute = (): NativeKitchenRecord => {
                if (command.operation === 'issue') {
                    if (!inventory || inventory.freeSlotCount < 1) throw new Error('Native kitchen worker inventory is full');
                    let remaining = 1;
                    const reservedWallet: PlayerInventoryEscrowWallet = { count: id => id === 377 ? remaining : 0,
                        remove: (id, count) => { if (id !== 377 || remaining !== count) throw new Error('Native WIP issuance differs'); remaining = 0; return count; },
                        add: () => { throw new Error('Native WIP issuance cannot create free Player stock'); } };
                    mutate('hold', intent.inputEscrowId, 377, reservedWallet);
                    const bytes = save();
                    return writeNativeKitchen(market.db, { binding, phase: 'issued', clock, wakeTick: null, receipt: null, checkpointDigest: foodDigest([...bytes]) });
                }
                if (command.operation === 'return') {
                    const output = prior!.phase === 'processed';
                    // No native receipt means a real held, unspent input can return. A committed input is never cancelled.
                    if (!output && new NativeFoodProductionStore(market.db).get(intent.actionId)) throw new Error('Committed kitchen input requires output recovery');
                    mutate('consume', output ? intent.outputEscrowId : intent.inputEscrowId);
                    this.pending.delete(binding.digest); const bytes = save();
                    return writeNativeKitchen(market.db, { binding, phase: output ? 'returned-output' : 'returned-input', clock,
                        wakeTick: null, receipt: prior!.receipt, checkpointDigest: foodDigest([...bytes]) });
                }
                if (!player || !inventory) throw new Error('Native kitchen needs a live worker');
                if (player.activeScript || player.protect || player.target) throw new Error('Native kitchen worker is busy');
                const pending = this.pending.get(binding.digest);
                if (pending && World.currentTick < pending.wakeTick) return prior!;
                if (inventory.freeSlotCount < 1) throw new Error('Native kitchen worker inventory is full');
                const heat = ports.heat(), expected = intent.policy.heat;
                if (!heat || LocType.get(heat.type).debugname !== expected.debugName || heat.x !== expected.x || heat.z !== expected.z || heat.level !== expected.level
                    || player.level !== heat.level || Math.max(Math.abs(player.x - heat.x), Math.abs(player.z - heat.z)) > 2)
                    throw new Error('Native kitchen heat source is unreachable or differs');
                if (player.baseLevels[PlayerStat.COOKING] < 40) throw new Error('Native kitchen worker lacks Cooking 40');
                if (player.invAdd(InvType.INV, 377, 1) !== 1) throw new Error('Native kitchen temporary input has no space');
                let state = pending?.state;
                if (!state) {
                    const script = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, heat.type, LocType.get(heat.type).category);
                    if (!script) throw new Error('Native cooking content unavailable');
                    player.lastUseItem = 377; state = ScriptRunner.init(script, player, heat); state.nativeFoodProductionActionId = intent.actionId;
                }
                state.nativeFoodProductionPorts = { ...ports, custody: { runId: intent.runId, batchId: intent.batchId,
                    evidence: { businessId: intent.businessId, runId: intent.runId, inputEscrowId: intent.inputEscrowId,
                        outputEscrowId: intent.outputEscrowId, bindingDigest: binding.digest }, authorize,
                    settle: output => { mutate('consume', intent.inputEscrowId); mutate('hold', intent.outputEscrowId, output); } } };
                // runScript does not install an automatic activeScript; only this custody adapter owns resumption.
                player.delayed = false; state.execution = player.runScript(state, true);
                stopContinuation();
                const receipt = new NativeFoodProductionStore(market.db).get(intent.actionId);
                if (receipt) {
                    this.pending.delete(binding.digest); const bytes = save();
                    return writeNativeKitchen(market.db, { binding, phase: 'processed', clock, wakeTick: null, receipt, checkpointDigest: foodDigest([...bytes]) });
                }
                if (state.execution !== ScriptState.SUSPENDED || player.invDel(InvType.INV, 377, 1) !== 1) throw new Error('Native kitchen segment did not produce or safely suspend');
                const wakeTick = player.delayedUntil;
                this.pending.set(binding.digest, { state, wakeTick }); const bytes = save();
                return writeNativeKitchen(market.db, { binding, phase: 'waiting', clock, wakeTick, receipt: null, checkpointDigest: foodDigest([...bytes]) });
            };
            market.db.transaction(() => { result = execute(); }).immediate();
            return result;
        } catch (error) {
            stopContinuation();
            this.pending.delete(binding.digest);
            if (inventory && original) original.forEach((item, slot) => inventory.set(slot, item));
            if (player && vars && levels && stats && baseLevels && strings && flags) {
                player.vars.set(vars); player.levels.set(levels); player.stats.set(stats); player.baseLevels.set(baseLevels); player.varsString = strings; Object.assign(player, flags);
            }
            throw error;
        }
    }
}
