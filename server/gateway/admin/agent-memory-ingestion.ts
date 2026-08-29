import { createHash } from 'node:crypto';
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
    createdKnowledge: number;
    existingKnowledge: number;
    blockedConsolidations: number;
    skippedRuns: number;
    errors: Array<{ runId: string; message: string }>;
    completedAt: string;
}

interface ProductionObservation {
    agentId: string;
    skillId: string;
    skillVersion: string;
    item: EconomyEvent['itemsIn'][number];
    event: EconomyEvent;
    episodeId: string;
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

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function productionRule(observation: ProductionObservation) {
    const itemKey = observation.item.id === null
        ? `name:${observation.item.name.toLocaleLowerCase('en-US')}` : `id:${observation.item.id}`;
    const hash = digest(`${observation.skillId}@${observation.skillVersion}|${itemKey}`);
    return { ruleKey: `production.${hash}`, subject: `skill-output:${hash}`,
        predicate: 'produces-item', hash };
}

function consolidationTier(count: number): { threshold: number; confidence: number } | null {
    if (count >= 20) return { threshold: 20, confidence: 92 };
    if (count >= 10) return { threshold: 10, confidence: 82 };
    if (count >= 5) return { threshold: 5, confidence: 70 };
    if (count >= 3) return { threshold: 3, confidence: 60 };
    return null;
}

function consolidateProductionKnowledge(store: AgentStateStore, observations: ProductionObservation[],
    result: AgentMemoryIngestionResult): void {
    const groups = new Map<string, { rule: ReturnType<typeof productionRule>; sample: ProductionObservation }>();
    for (const observation of observations) {
        const rule = productionRule(observation);
        try {
            store.recordConsolidationEvidence(observation.agentId, {
                ruleKey: rule.ruleKey,
                evidenceKey: `economy:${observation.event.id}:item:${rule.hash}`,
                episodeId: observation.episodeId,
                occurredAt: observation.event.timestamp
            }, result.completedAt);
            groups.set(`${observation.agentId}:${rule.ruleKey}`, { rule, sample: observation });
        } catch (error) {
            result.errors.push({ runId: observation.event.runId,
                message: error instanceof Error ? error.message : String(error) });
        }
    }
    for (const { rule, sample } of groups.values()) {
        const count = store.countConsolidationEvidence(sample.agentId, rule.ruleKey);
        const tier = consolidationTier(count);
        if (!tier) continue;
        const externalKey = `consolidation:production:${rule.hash}:threshold:${tier.threshold}`;
        const active = store.listKnowledge(sample.agentId, { status: 'active', limit: 500 })
            .find(item => item.subject.toLocaleLowerCase('en-US') === rule.subject.toLocaleLowerCase('en-US')
                && item.predicate === rule.predicate);
        if (active?.externalKey === externalKey) { result.existingKnowledge++; continue; }
        if (active && active.source !== 'consolidation') { result.blockedConsolidations++; continue; }
        const evidence = store.listConsolidationEvidence(sample.agentId, rule.ruleKey, tier.threshold);
        try {
            store.createKnowledge(sample.agentId, {
                knowledgeId: `consolidation.${rule.hash}.${tier.threshold}`,
                kind: 'procedure', subject: rule.subject, predicate: rule.predicate,
                object: bounded(sample.item.id === null ? sample.item.name : `item:${sample.item.id}:${sample.item.name}`, 500),
                summary: bounded(`${sample.skillId}@${sample.skillVersion} repeatedly produced ${sample.item.name} in ${tier.threshold} trusted observations.`, 500),
                confidence: tier.confidence, tags: ['automatic', 'consolidation', 'production',
                    bounded(`${sample.skillId}@${sample.skillVersion}`, 100),
                    `threshold-${tier.threshold}`], evidenceEpisodeIds: evidence.map(item => item.episodeId),
                source: 'consolidation', supersedesId: active?.knowledgeId ?? null, externalKey,
                validFrom: evidence.at(-1)?.occurredAt ?? sample.event.timestamp
            }, result.completedAt);
            result.createdKnowledge++;
        } catch (error) {
            result.errors.push({ runId: `consolidation:${rule.ruleKey}`,
                message: error instanceof Error ? error.message : String(error) });
        }
    }
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
        createdEpisodes: 0, existingEpisodes: 0, createdKnowledge: 0, existingKnowledge: 0,
        blockedConsolidations: 0, skippedRuns: 0, errors: [],
        completedAt: options.now ?? new Date().toISOString() };
    try {
        const agentByPlayer = new Map(store.listIdentities().map(identity => [identity.playerUsername, identity.agentId]));
        const productionObservations: ProductionObservation[] = [];
        for (const run of [...runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
            const agentId = run.username ? agentByPlayer.get(run.username) : undefined;
            if (!agentId) { result.skippedRuns++; continue; }
            result.matchedRuns++;
            const economicEvents = extractEconomyEvents({
                runId: run.runId, username: run.username, skillId: run.skill.id, events: run.events
            });
            const episodes = [{ episode: skillRunEpisode(run), event: null },
                ...economicEvents.map(event => ({ episode: economyEpisode(event), event }))];
            for (const { episode, event } of episodes) {
                try {
                    const existing = store.getEpisodeByExternalKey(agentId, episode.externalKey!);
                    store.createEpisode(agentId, episode, result.completedAt);
                    if (existing) result.existingEpisodes++;
                    else result.createdEpisodes++;
                    if (event?.kind === 'production' && !event.partial) {
                        for (const item of event.itemsIn) productionObservations.push({
                            agentId, skillId: event.skillId, skillVersion: run.skill.version,
                            item, event, episodeId: episode.episodeId
                        });
                    }
                } catch (error) {
                    result.errors.push({ runId: run.runId,
                        message: error instanceof Error ? error.message : String(error) });
                }
            }
        }
        consolidateProductionKnowledge(store, productionObservations, result);
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
