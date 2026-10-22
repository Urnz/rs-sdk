import { fileURLToPath } from 'node:url';
import World from '../engine/World.js';
import NpcType from '../cache/config/NpcType.js';
import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { assertManagedModuleRoot } from '../../../control-plane/instance-context.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import { executeNativeFoodSkill, validateNativeFoodSkillCommand, type NativeFoodSkillCommand } from './NativeFoodSkill.js';
import { readFoodSkillAttempts } from './NativeFoodSkillAttemptStore.js';

const queue: Array<{ command: NativeFoodSkillCommand; expiresAt: number; resolve(result: { ok: boolean; error?: string }): void }> = [];
const preparations = new Map<string, { command: NativeFoodSkillCommand; wakeTick: number }>();
export function enqueueNativeFoodSkill(raw: NativeFoodSkillCommand): Promise<{ ok: boolean; error?: string }> {
    let command: NativeFoodSkillCommand;
    try { command = validateNativeFoodSkillCommand(raw); } catch (error) { return Promise.resolve({ ok: false, error: String(error) }); }
    if (queue.length >= 50) return Promise.resolve({ ok: false, error: 'Native food skill queue is full' });
    return new Promise(resolve => queue.push({ command, expiresAt: Date.now() + 5000, resolve }));
}
export function tickNativeFoodSkills(): void {
    for (const [actionId, preparation] of [...preparations]) {
        if (World.currentTick < preparation.wakeTick) continue;
        preparations.delete(actionId);
        try { if (!World.shutdown) execute(preparation.command); }
        catch (error) { console.error('Native food preparation requires source reconciliation:', error); }
    }
    for (const item of queue.splice(0, 10)) {
        try {
            if (World.shutdown || Date.now() > item.expiresAt) throw new Error('Native food command expired');
            execute(item.command);
            item.resolve({ ok: true });
        } catch (error) { item.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
}
function execute(command: NativeFoodSkillCommand): void {
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); assertManagedModuleRoot(root);
    const player = World.getPlayerByUsername(command.username);
    if (!player) throw new Error('Native food worker is offline');
    getSharedPlayerEscrowAuthority(); const market = ensurePlayerSaveStore(), policy = loadNativeFoodProductionPolicy(root);
    const source = policy.sources.find(entry => entry.sourceId === command.sourceId);
    const npc = source ? [...World.npcs].find(npc => npc && NpcType.get(npc.type).debugname === source.npcDebugName
        && npc.x >= source.minX && npc.x <= source.maxX && npc.z >= source.minZ && npc.z <= source.maxZ
        && npc.level === player.level && Math.max(Math.abs(player.x - npc.x), Math.abs(player.z - npc.z)) <= 2) ?? null : null;
    executeNativeFoodSkill(command, player, { market, policy, identity: populationFoodContext,
        checkpoint: () => { World.checkpointPlayers(); } }, npc);
    if (command.operation === 'gather') {
        const attempt = readFoodSkillAttempts(market.db).find(row => row.actionId === command.actionId);
        if (attempt?.phase === 'waiting') preparations.set(command.actionId, { command, wakeTick: attempt.wakeTick! });
        else preparations.delete(command.actionId);
    }
}
