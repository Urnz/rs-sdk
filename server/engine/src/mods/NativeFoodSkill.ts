import InvType from '../cache/config/InvType.js';
import NpcType from '../cache/config/NpcType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import type Player from '../engine/entity/Player.js';
import type Npc from '../engine/entity/Npc.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import World from '../engine/World.js';
import type { NativeFoodProductionPorts } from './NativeFoodProduction.js';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { initializeFoodSkillAttempts, readFoodSkillAttempts, writeFoodSkillAttempt } from './NativeFoodSkillAttemptStore.js';
import { NativeFoodProductionStore, type FoodProductionAction } from './NativeFoodProductionStore.js';

import type { NativeFoodSkillCommand } from '../../../../sdk/society-food.js';
export type { NativeFoodSkillCommand } from '../../../../sdk/society-food.js';
export function validateNativeFoodSkillCommand(command: NativeFoodSkillCommand): NativeFoodSkillCommand {
    if (!command || Object.keys(command).sort().join(',') !== 'actionId,operation,slot,sourceId,username'
        || !['gather', 'consume'].includes(command.operation)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(command.actionId)
        || !/^[a-z0-9][a-z0-9 _]{0,11}$/.test(command.username)
        || !Number.isSafeInteger(command.slot) || command.slot < 0 || command.slot > 27
        || (command.operation === 'gather' ? command.sourceId !== 'musa-point-lobster' || command.slot !== 0 : command.sourceId !== null))
        throw new Error('Invalid native food skill command');
    return structuredClone(command);
}

/** One ordinary packed-content attempt. A persisted gathering admission is never blindly executed twice. */
export function executeNativeFoodSkill(raw: NativeFoodSkillCommand, player: Player,
    ports: NativeFoodProductionPorts, npc: Npc | null): void {
    const command = validateNativeFoodSkillCommand(raw);
    const identity = ports.identity(command.username, command.actionId, command.slot, World.currentTick);
    if (!identity || player.username !== command.username || identity.clock.status !== 'running'
        || player.populationTerminal || player.levels[PlayerStat.HITPOINTS] <= 0)
        throw new Error('Native food skill actor/lifecycle/clock is inactive');
    if (command.operation === 'consume') {
        executeNativeFoodAction(ports.market, player, identity, ports.checkpoint, ports.identity); return;
    }
    const store = new NativeFoodProductionStore(ports.market.db);
    initializeFoodSkillAttempts(ports.market.db);
    const execution = readFoodSkillAttempts(ports.market.db).find(row => row.actionId === command.actionId);
    const prior = ports.market.db.query('SELECT action_json FROM native_food_production_actions WHERE action_id=?1')
        .get(command.actionId) as { action_json: string } | null;
    if (prior) {
        const action = JSON.parse(prior.action_json) as FoodProductionAction;
        if (action.username !== command.username || action.actorId !== identity.action.actorId
            || action.worldId !== identity.action.worldId || action.lifecycleId !== identity.action.lifecycleId
            || action.clockId !== identity.action.clockId || action.clockProfileDigest !== identity.action.clockProfileDigest
            || action.kind !== 'gather' || action.source.sourceId !== command.sourceId)
            throw new Error('Native gathering replay identity differs');
        if (store.get(command.actionId) || execution?.phase !== 'waiting') return;
        if (player.getVar(VarPlayerType.getId('action_delay')) !== execution.wakeTick || World.currentTick > execution.wakeTick!) {
            // The ordinary script uses equality against map_clock. A missed wake
            // must never silently restart preparation or perform another roll.
            const save = player.save(false);
            ports.market.db.transaction(() => {
                ports.checkpoint(save); ports.market.checkpoint(player.username, save, true);
                writeFoodSkillAttempt(ports.market.db, { ...execution, phase: 'attempted', wakeTick: null, checkpointDigest: foodDigest([...save]) });
            }).immediate();
            return;
        }
        if (World.currentTick < execution.wakeTick!) return;
    }
    const source = ports.policy.sources.find(entry => entry.sourceId === command.sourceId);
    if (!source || !npc || NpcType.get(npc.type).debugname !== source.npcDebugName
        || npc.x < source.minX || npc.x > source.maxX || npc.z < source.minZ || npc.z > source.maxZ || npc.level !== source.level
        || player.level !== npc.level || Math.max(Math.abs(player.x - npc.x), Math.abs(player.z - npc.z)) > 2
        || player.activeScript || player.target || player.delayed || player.protect || player.getInventory(InvType.INV)!.freeSlotCount < 1)
        throw new Error(`Native gathering blocked: source=${!!source}, npc=${npc ? `${npc.type}:${npc.x}:${npc.z}:${npc.level}` : 'none'}, `
            + `script=${!!player.activeScript}, target=${!!player.target}, delayed=${player.delayed}, protected=${player.protect}, freeSlots=${player.getInventory(InvType.INV)!.freeSlotCount}`);
    const { actionId, worldId, actorId, username, lifecycleId, clockId, clockProfileDigest } = identity.action;
    const action: FoodProductionAction = { actionId, worldId, actorId, username, lifecycleId, clockId, clockProfileDigest,
        policyDigest: ports.policy.digest, catalogDigest: ports.policy.catalogDigest, kind: 'gather',
        runId: ports.policy.runId, batchId: `${ports.policy.runId}:${actionId}`, recipeId: ports.policy.recipeId, recipeVersion: ports.policy.recipeVersion,
        source: { kind: 'npc', sourceId: source.sourceId, typeId: npc.type, x: npc.x, z: npc.z, level: npc.level } };
    const script = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC4, npc.type, NpcType.get(npc.type).category);
    if (!script) throw new Error('Native lobster fishing content is unavailable');
    const admitted = store.admit(action); // Durable before dispatch: crash or failed roll cannot become an automatic second attempt.
    const inventory = player.getInventory(InvType.INV)!, items = inventory.items.map(item => item && { ...item });
    const vars = player.vars.slice(), strings = [...player.varsString], stats = player.stats.slice(),
        levels = player.levels.slice(), baseLevels = player.baseLevels.slice();
    const flags = { delayed: player.delayed, delayedUntil: player.delayedUntil, protect: player.protect };
    const queued = new Set([...player.queue.all(), ...player.weakQueue.all()]);
    const xpReceipts = [...player.nativeAttributeXpReceipts];
    const stopContinuation = () => {
        for (const entry of [...player.queue.all(), ...player.weakQueue.all()]) if (!queued.has(entry)) entry.unlink();
        player.clearInteraction();
    };
    try {
        ports.market.db.transaction(() => {
            const state = ScriptRunner.init(script, player, npc);
            state.nativeFoodProductionActionId = command.actionId; state.nativeFoodProductionPorts = ports;
            state.execution = player.runScript(state, true);
            if (state.execution !== ScriptState.FINISHED && !store.get(command.actionId))
                throw new Error('Native gathering did not finish; admission requires reconciliation');
            stopContinuation();
            const save = player.save(false); ports.checkpoint(save); ports.market.checkpoint(player.username, save, true);
            const delay = player.getVar(VarPlayerType.getId('action_delay'));
            if (typeof delay !== 'number') throw new Error('Native fishing delay type differs');
            const waiting = !store.get(command.actionId) && delay > World.currentTick && delay <= World.currentTick + 5;
            writeFoodSkillAttempt(ports.market.db, { actionId: command.actionId, requestDigest: foodDigest(admitted),
                phase: waiting ? 'waiting' : 'attempted', wakeTick: waiting ? delay : null, checkpointDigest: foodDigest([...save]) });
        }).immediate();
    } catch (error) {
        stopContinuation();
        items.forEach((item, slot) => inventory.set(slot, item)); player.vars.set(vars); player.varsString = strings;
        player.stats.set(stats); player.levels.set(levels); player.baseLevels.set(baseLevels);
        player.nativeAttributeXpReceipts = xpReceipts; Object.assign(player, flags); throw error;
    }
}
