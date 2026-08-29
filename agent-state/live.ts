import type { BotWorldState } from '../sdk/types.js';
import type { SkillRunResult } from '../agent-skills/types.js';
import { planNextAction, type PlannerDecision } from './planner.js';
import type { AgentSkillReference, SetAgentWorkingMemory } from './types.js';
import { AgentStateStore } from './store.js';

export type LiveWorldState = Pick<BotWorldState, 'inGame' | 'player' | 'inventory' | 'dialog' | 'bank'
    | 'shop' | 'trade' | 'modalOpen' | 'nearbyNpcs' | 'nearbyLocs' | 'gameMessages'>;

export interface LivePlannerCycleOptions {
    store: AgentStateStore;
    agentId: string;
    state: LiveWorldState;
    availableSkills: readonly AgentSkillReference[];
    now?: string;
    executeSkill?: (skill: AgentSkillReference) => Promise<SkillRunResult>;
}

export interface LivePlannerCycleResult {
    decision: PlannerDecision;
    execution: SkillRunResult | null;
}

function unique(values: string[], limit: number): string[] {
    return [...new Set(values.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, limit);
}

export function observeLiveState(state: LiveWorldState, observedAt = new Date().toISOString()): Required<SetAgentWorkingMemory> {
    if (!state.inGame || !state.player) throw new Error('Cannot observe an agent that is not in game');
    const player = state.player;
    const usedSlots = new Set(state.inventory.map(item => item.slot)).size;
    let currentActivity: string | null = null;
    if (player.combat.inCombat) {
        const target = state.nearbyNpcs.find(npc => npc.index === player.combat.targetIndex);
        currentActivity = `fighting ${target?.name ?? 'an unknown target'}`;
    } else if (state.trade?.isOpen) currentActivity = `trading with ${state.trade.partner ?? 'another player'}`;
    else if (state.bank.isOpen) currentActivity = 'using a bank';
    else if (state.shop.isOpen) currentActivity = `using shop ${state.shop.title || 'unknown'}`;
    else if (state.dialog.isOpen) currentActivity = 'handling a dialog';
    else if (player.animId !== -1) currentActivity = `performing animation ${player.animId}`;

    const inventory = unique(state.inventory.map(item => `${item.name}${item.count > 1 ? ` x${item.count}` : ''}`), 5);
    const nearbyNpcs = unique([...state.nearbyNpcs].sort((a, b) => a.distance - b.distance).map(npc => `NPC ${npc.name}`), 3);
    const nearbyLocs = unique([...state.nearbyLocs].sort((a, b) => a.distance - b.distance).map(loc => `Object ${loc.name}`), 3);
    const messages = unique(state.gameMessages.filter(message => message.type === 0).slice(-2)
        .map(message => `Game message: ${message.text.slice(0, 80)}`), 2);
    const observations = unique([
        `HP ${player.hp}/${player.maxHp}; run energy ${player.runEnergy}`,
        `Inventory ${usedSlots}/28${inventory.length ? `: ${inventory.join(', ')}` : ': empty'}`,
        ...(state.modalOpen ? ['A modal interface is open'] : []), ...nearbyNpcs, ...nearbyLocs, ...messages
    ], 12).map(value => value.slice(0, 100));
    return {
        summary: `${player.name} is at (${player.worldX}, ${player.worldZ}, ${player.level}), ${currentActivity ?? 'idle'}.`,
        currentActivity,
        location: { x: player.worldX, z: player.worldZ, level: player.level },
        observations,
        observedAt
    };
}

export async function runLivePlannerCycle(options: LivePlannerCycleOptions): Promise<LivePlannerCycleResult> {
    const identity = options.store.getIdentity(options.agentId);
    if (!identity) throw new Error(`Unknown agent: ${options.agentId}`);
    if (!options.state.player || identity.playerUsername !== options.state.player.name.trim().toLowerCase()) {
        throw new Error(`Agent ${identity.agentId} belongs to player ${identity.playerUsername}, not ${options.state.player?.name ?? 'offline'}`);
    }
    const previous = options.store.getWorkingMemory(identity.agentId);
    options.store.setWorkingMemory(identity.agentId, previous?.revision ?? null,
        observeLiveState(options.state, options.now), options.now);
    const snapshot = options.store.getSnapshot(identity.agentId)!;
    const decision = planNextAction(snapshot, { now: options.now, availableSkills: options.availableSkills });
    if (decision.kind !== 'execute-skill' || !decision.skill || !options.executeSkill) {
        return { decision, execution: null };
    }
    return { decision, execution: await options.executeSkill(decision.skill) };
}
