import type { BotWorldState } from '../../../sdk/types.js';
import { LlmReplanEventGate, type LlmReplanEvent, type LlmReplanGateResult } from '../../../llm-runtime/events.js';
import type { EconomySnapshot } from './types.js';

export interface ReplanOutcome {
    runId: string;
    status: string;
    decision?: unknown;
    reason: string;
}

export interface ReplanRecord {
    timestamp: string;
    event: LlmReplanEvent;
    gate: LlmReplanGateResult;
    outcome: ReplanOutcome | null;
    error: string | null;
}

export interface AgentReplanCoordinatorDependencies {
    resolveAgentId(playerUsername: string): Promise<string | null>;
    listAgentIds(): Promise<string[]>;
    plan(agentId: string, event: LlmReplanEvent): Promise<ReplanOutcome>;
    append(record: ReplanRecord): Promise<void> | void;
}

type ReplanWorldState = Pick<BotWorldState, 'tick' | 'player' | 'gameMessages'>;

export class AgentReplanCoordinator {
    private readonly world = new Map<string, { lifeId: number; isDead: boolean; tradeRequests: Set<string> }>();
    private economy: EconomySnapshot | null = null;

    constructor(private readonly dependencies: AgentReplanCoordinatorDependencies,
        private readonly gate = new LlmReplanEventGate(), private readonly significantCoins = 1_000,
        private readonly significantItems = 100) {}

    async submit(event: LlmReplanEvent, now = new Date().toISOString()): Promise<ReplanRecord> {
        const gate = this.gate.consider(event, now);
        const record: ReplanRecord = { timestamp: now, event, gate, outcome: null, error: null };
        if (gate.accepted) {
            try { record.outcome = await this.dependencies.plan(event.agentId, event); }
            catch (error) { record.error = error instanceof Error ? error.message : String(error); }
        }
        await this.dependencies.append(record);
        return record;
    }

    async submitForPlayer(playerUsername: string, event: Omit<LlmReplanEvent, 'agentId'>,
        now = new Date().toISOString()): Promise<ReplanRecord | null> {
        const agentId = await this.dependencies.resolveAgentId(playerUsername);
        return agentId ? this.submit({ ...event, agentId }, now) : null;
    }

    private submitObserved(playerUsername: string, event: Omit<LlmReplanEvent, 'agentId'>,
        now: string): void {
        void this.submitForPlayer(playerUsername, event, now)
            .catch(error => console.error('[AgentReplan] Observed event failed:', error));
    }

    observeWorldState(playerUsername: string, state: ReplanWorldState): void {
        if (!state.player) return;
        const key = playerUsername.toLowerCase();
        const tradeRequests = new Set(state.gameMessages.filter(message => message.type === 4)
            .map(message => `${message.tick}|${message.sender ?? ''}|${message.text}`));
        const previous = this.world.get(key);
        this.world.set(key, { lifeId: state.player.lifeId, isDead: state.player.isDead,
            tradeRequests: new Set([...tradeRequests].slice(-100)) });
        if (!previous) return;

        if ((state.player.lifeId !== previous.lifeId || state.player.isDead) && !previous.isDead) {
            const occurredAt = new Date().toISOString();
            this.submitObserved(playerUsername, { eventId: crypto.randomUUID(), type: 'unexpected-world-event',
                sourceKey: `life:${state.player.lifeId}:death:${state.player.lastDeathTick ?? state.tick}`, occurredAt,
                summary: `The agent died during life ${state.player.lifeId}.` }, occurredAt);
        }
        for (const request of tradeRequests) {
            if (previous.tradeRequests.has(request)) continue;
            const occurredAt = new Date().toISOString();
            this.submitObserved(playerUsername, { eventId: crypto.randomUUID(), type: 'offer-received',
                sourceKey: `trade-request:${request}`, occurredAt,
                summary: state.gameMessages.find(message => `${message.tick}|${message.sender ?? ''}|${message.text}` === request)?.text
                    ?? 'A player requested a trade.' }, occurredAt);
        }
    }

    async observeEconomy(snapshot: EconomySnapshot, now = snapshot.timestamp): Promise<ReplanRecord[]> {
        const previous = this.economy;
        this.economy = structuredClone(snapshot);
        if (!previous) return [];
        const coinsDelta = snapshot.totalCoins - previous.totalCoins;
        const previousItems = previous.itemStock.reduce((sum, item) => sum + item.count, 0);
        const currentItems = snapshot.itemStock.reduce((sum, item) => sum + item.count, 0);
        const itemsDelta = currentItems - previousItems;
        if (Math.abs(coinsDelta) < this.significantCoins && Math.abs(itemsDelta) < this.significantItems) return [];
        const agentIds = await this.dependencies.listAgentIds();
        return Promise.all(agentIds.map(agentId => this.submit({ eventId: crypto.randomUUID(), agentId,
            type: 'significant-economic-change', sourceKey: `economy:${snapshot.timestamp}:${coinsDelta}:${itemsDelta}`,
            occurredAt: snapshot.timestamp,
            summary: `Shared economy changed by ${coinsDelta} gp and ${itemsDelta} tracked item units.` }, now)));
    }
}
