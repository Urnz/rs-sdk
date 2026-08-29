import { AgentStateStore } from '../../../agent-state/store.js';
import type { CreateAgentEpisode } from '../../../agent-state/types.js';
import { agentStateDbPath, skillRunsDir } from './paths.js';
import { readSkillRunHistory, type AdminSkillRun } from './skill-history.js';
import { extractEconomyEvents, type EconomyEvent } from './transaction-telemetry.js';

export interface AgentMemoryIngestionResult {
    scannedRuns: number;
    matchedRuns: number;
    createdEpisodes: number;
    existingEpisodes: number;
    skippedRuns: number;
    errors: Array<{ runId: string; message: string }>;
    completedAt: string;
}

function bounded(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 3)}...`;
}

function skillRunEpisode(run: AdminSkillRun): CreateAgentEpisode {
    const label = run.status === 'completed' ? 'completed successfully' : `ended as ${run.status}`;
    return {
        episodeId: `skill-run.${run.runId}`,
        kind: 'outcome',
        summary: `Skill ${run.skill.id}@${run.skill.version} ${label}.`,
        details: bounded(`Reason: ${run.reason || 'none'}. Message: ${run.message || 'none'}. `
            + `Operations: ${run.operations}. Duration: ${run.durationMs} ms.`, 2000),
        importance: run.status === 'completed' ? 60 : run.status === 'failed' ? 75 : 50,
        tags: ['automatic', 'skill-run', run.status, run.skill.id],
        source: 'skill',
        trust: 'trusted',
        externalKey: `skill-run:${run.runId}`,
        occurredAt: run.finishedAt
    };
}

function itemsText(items: EconomyEvent['itemsIn']): string {
    return items.map(item => `${item.quantity} ${item.name}`).join(', ') || 'none';
}

function economyEpisode(event: EconomyEvent): CreateAgentEpisode {
    const direction = [event.itemsIn.length ? `received ${itemsText(event.itemsIn)}` : '',
        event.itemsOut.length ? `gave ${itemsText(event.itemsOut)}` : '',
        event.coinsDelta ? `${event.coinsDelta > 0 ? 'gained' : 'spent'} ${Math.abs(event.coinsDelta)} gp` : '']
        .filter(Boolean).join('; ') || 'no measurable inventory change';
    return {
        episodeId: `economy.${event.id.replaceAll(':', '.')}`,
        kind: 'economic',
        summary: bounded(`${event.kind}: ${direction}.`, 500),
        details: `Skill ${event.skillId}; run ${event.runId}; step ${event.stepId ?? 'unknown'}; `
            + `partial=${event.partial}; counterparty=${event.counterparty ?? 'none'}.`,
        importance: event.kind === 'player-trade' ? 70
            : event.kind === 'shop-buy' || event.kind === 'shop-sell' ? 60 : event.partial ? 55 : 45,
        actors: event.counterparty ? [event.counterparty] : [],
        tags: ['automatic', 'economy', event.kind, event.skillId, ...(event.partial ? ['partial'] : [])],
        source: 'skill',
        trust: 'trusted',
        externalKey: `economy:${event.id}`,
        occurredAt: event.timestamp
    };
}

export async function ingestAgentMemories(options: {
    databasePath?: string;
    runRoot?: string;
    limit?: number;
    now?: string;
} = {}): Promise<AgentMemoryIngestionResult> {
    const runs = await readSkillRunHistory(options.limit ?? 500, options.runRoot ?? skillRunsDir, 10_000);
    const store = new AgentStateStore(options.databasePath ?? agentStateDbPath);
    const result: AgentMemoryIngestionResult = { scannedRuns: runs.length, matchedRuns: 0,
        createdEpisodes: 0, existingEpisodes: 0, skippedRuns: 0, errors: [],
        completedAt: options.now ?? new Date().toISOString() };
    try {
        const agentByPlayer = new Map(store.listIdentities().map(identity => [identity.playerUsername, identity.agentId]));
        for (const run of [...runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
            const agentId = run.username ? agentByPlayer.get(run.username) : undefined;
            if (!agentId) { result.skippedRuns++; continue; }
            result.matchedRuns++;
            const episodes = [skillRunEpisode(run), ...extractEconomyEvents({
                runId: run.runId, username: run.username, skillId: run.skill.id, events: run.events
            }).map(economyEpisode)];
            for (const episode of episodes) {
                try {
                    const existing = store.getEpisodeByExternalKey(agentId, episode.externalKey!);
                    store.createEpisode(agentId, episode, result.completedAt);
                    if (existing) result.existingEpisodes++;
                    else result.createdEpisodes++;
                } catch (error) {
                    result.errors.push({ runId: run.runId,
                        message: error instanceof Error ? error.message : String(error) });
                }
            }
        }
    } finally { store.close(); }
    return result;
}

export class AgentMemoryIngestionLoop {
    private running: Promise<AgentMemoryIngestionResult> | null = null;
    private last: AgentMemoryIngestionResult | null = null;

    constructor(private readonly options: Parameters<typeof ingestAgentMemories>[0] = {}) {}

    sync(): Promise<AgentMemoryIngestionResult> {
        if (this.running) return this.running;
        this.running = ingestAgentMemories(this.options).then(result => (this.last = result))
            .finally(() => { this.running = null; });
        return this.running;
    }

    snapshot(): AgentMemoryIngestionResult | null { return this.last; }
}
