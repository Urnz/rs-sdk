import type { NeedsState } from '../needs/types.js';

export interface FoodChainDefinition {
    foodChainId: string;
    rawItem: { itemId: number; name: string; sourceSkill: 'Fishing' | 'Farming' };
    cookedItem: { itemId: number; name: string };
    processingSkill: 'Cooking';
    hungerRelief: number;
}

export interface FoodLoopCatalog {
    schemaVersion: 1;
    chains: FoodChainDefinition[];
    digest: string;
}

export interface FoodInventoryReceipt {
    receiptId: string;
    actorAgentId: string;
    kind: 'gathered' | 'processed' | 'consumed';
    occurredAtSimulationTime: string;
    skill: 'Fishing' | 'Farming' | 'Cooking' | null;
    inputs: Array<{ itemId: number; quantity: number }>;
    outputs: Array<{ itemId: number; quantity: number }>;
    sourceDigest: string;
}

export interface ClosedFoodLoop {
    schemaVersion: 1;
    closureId: string;
    foodChainId: string;
    actorAgentId: string;
    catalogDigest: string;
    previousNeedsStateDigest: string;
    receiptIds: [string, string, string];
    receiptSourceDigests: [string, string, string];
    hungerBefore: number;
    hungerRelief: number;
    hungerAfter: number;
    occurredAtSimulationTime: string;
    state: NeedsState;
    digest: string;
}

export interface FoodConsumptionEconomicEvent {
    eventId: string;
    closureId: string;
    closureDigest: string;
    actorAgentId: string;
    kind: 'food-consumption';
    itemId: number;
    itemName: string;
    quantity: 1;
    hungerRelief: number;
    occurredAtSimulationTime: string;
}

export interface FoodConsumptionSummary {
    events: number;
    foodUnitsConsumed: number;
    hungerRelief: number;
}
