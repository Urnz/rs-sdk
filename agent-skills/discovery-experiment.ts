import { createHash } from 'node:crypto';
import type { SkillRegistry } from './registry';
import { AgentSkillBook } from './knowledge';
import type { RegisteredSkill, SkillSharingMode, SkillStep } from './types';

export interface SkillDiscoveryExperimentConfig {
    seed: string;
    agentCount: number;
    tasksPerAgent: number;
    trials: number;
    discoveryCostMultiplier: number;
    skillIds?: string[];
}

export interface SkillDiscoveryAgentResult {
    agentId: string;
    taskSkillIds: string[];
    catalogHits: number;
    knownReuseHits: number;
    independentDiscoveries: number;
    executionOperations: number;
    discoveryOperations: number;
    totalOperations: number;
}

export interface SkillDiscoveryTrialResult {
    trial: number;
    mode: SkillSharingMode;
    agents: SkillDiscoveryAgentResult[];
    tasks: number;
    catalogHits: number;
    knownReuseHits: number;
    independentDiscoveries: number;
    duplicateDiscoveries: number;
    executionOperations: number;
    discoveryOperations: number;
    totalOperations: number;
    meanOperationsPerAgent: number;
    standardDeviationOperations: number;
}

export interface SkillDiscoveryModeSummary {
    mode: SkillSharingMode;
    meanCatalogHits: number;
    meanKnownReuseHits: number;
    meanIndependentDiscoveries: number;
    meanDuplicateDiscoveries: number;
    meanTotalOperations: number;
    meanOperationsPerTask: number;
    meanAgentStandardDeviation: number;
}

export interface SkillDiscoveryExperimentReport {
    schemaVersion: 1;
    experiment: 'skill-discovery-sharing';
    config: SkillDiscoveryExperimentConfig;
    methodology: {
        metricUnit: 'estimated-skill-operations';
        executionEstimate: string;
        discoveryEstimate: string;
        limitation: string;
    };
    catalog: Array<{ id: string; version: string; nominalOperations: number }>;
    workloadFingerprint: string;
    trials: SkillDiscoveryTrialResult[];
    summary: {
        shared: SkillDiscoveryModeSummary;
        isolated: SkillDiscoveryModeSummary;
        operationSavings: number;
        operationSavingsPercent: number;
        avoidedIndependentDiscoveries: number;
        avoidedDuplicateDiscoveries: number;
    };
}

interface WorkloadTrial {
    trial: number;
    agents: Array<{ agentId: string; skillIds: string[] }>;
}

function assertInteger(value: number, name: string, minimum: number, maximum: number): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
}

function operationCount(steps: SkillStep[]): number {
    return steps.reduce((total, step) => total + (step.kind === 'operation'
        ? 1
        : step.maxIterations * operationCount(step.steps)), 0);
}

function latestVerifiedShared(registry: SkillRegistry, requestedIds?: string[]): RegisteredSkill[] {
    const requested = requestedIds ? new Set(requestedIds) : null;
    const latest = new Map<string, RegisteredSkill>();
    for (const skill of registry.list({ status: 'verified' })) {
        if (skill.definition.sharing.visibility !== 'shared' || (requested && !requested.has(skill.definition.id))) continue;
        if (!latest.has(skill.definition.id)) latest.set(skill.definition.id, skill);
    }
    if (requested) {
        const missing = [...requested].filter(id => !latest.has(id));
        if (missing.length) throw new Error(`Verified shared skills not found: ${missing.join(', ')}`);
    }
    return [...latest.values()].sort((left, right) => left.definition.id.localeCompare(right.definition.id));
}

function seededRandom(seed: string): () => number {
    const digest = createHash('sha256').update(seed).digest();
    let state = digest.readUInt32LE(0) || 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    };
}

function workload(config: SkillDiscoveryExperimentConfig, skills: RegisteredSkill[]): WorkloadTrial[] {
    const random = seededRandom(config.seed);
    return Array.from({ length: config.trials }, (_, trial) => ({
        trial,
        agents: Array.from({ length: config.agentCount }, (_, agent) => ({
            agentId: `agent-${agent + 1}`,
            skillIds: Array.from({ length: config.tasksPerAgent }, () =>
                skills[Math.floor(random() * skills.length)]!.definition.id)
        }))
    }));
}

function standardDeviation(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function runTrial(
    trial: WorkloadTrial,
    mode: SkillSharingMode,
    registry: SkillRegistry,
    skills: Map<string, RegisteredSkill>,
    discoveryCostMultiplier: number
): SkillDiscoveryTrialResult {
    const discoveryCounts = new Map<string, number>();
    const agents = trial.agents.map(work => {
        const book = new AgentSkillBook(work.agentId, mode);
        let catalogHits = 0;
        let knownReuseHits = 0;
        let independentDiscoveries = 0;
        let executionOperations = 0;
        let discoveryOperations = 0;
        for (const skillId of work.skillIds) {
            const skill = skills.get(skillId)!;
            const nominalOperations = operationCount(skill.definition.steps);
            if (book.knows(skillId)) {
                knownReuseHits++;
            } else if (book.discover(registry).some(candidate => candidate.definition.id === skillId)) {
                catalogHits++;
                book.learn(skill.definition, registry);
            } else {
                independentDiscoveries++;
                discoveryCounts.set(skillId, (discoveryCounts.get(skillId) ?? 0) + 1);
                discoveryOperations += nominalOperations * discoveryCostMultiplier;
                book.learn(skill.definition, registry);
            }
            executionOperations += nominalOperations;
        }
        return {
            agentId: work.agentId,
            taskSkillIds: [...work.skillIds],
            catalogHits,
            knownReuseHits,
            independentDiscoveries,
            executionOperations,
            discoveryOperations,
            totalOperations: executionOperations + discoveryOperations
        };
    });
    const total = (key: keyof Pick<SkillDiscoveryAgentResult, 'catalogHits' | 'knownReuseHits' | 'independentDiscoveries' | 'executionOperations' | 'discoveryOperations' | 'totalOperations'>) =>
        agents.reduce((sum, agent) => sum + agent[key], 0);
    const totalOperations = total('totalOperations');
    return {
        trial: trial.trial,
        mode,
        agents,
        tasks: configTasks(trial),
        catalogHits: total('catalogHits'),
        knownReuseHits: total('knownReuseHits'),
        independentDiscoveries: total('independentDiscoveries'),
        duplicateDiscoveries: [...discoveryCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
        executionOperations: total('executionOperations'),
        discoveryOperations: total('discoveryOperations'),
        totalOperations,
        meanOperationsPerAgent: totalOperations / agents.length,
        standardDeviationOperations: standardDeviation(agents.map(agent => agent.totalOperations))
    };
}

function configTasks(trial: WorkloadTrial): number {
    return trial.agents.reduce((sum, agent) => sum + agent.skillIds.length, 0);
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(mode: SkillSharingMode, trials: SkillDiscoveryTrialResult[]): SkillDiscoveryModeSummary {
    const selected = trials.filter(trial => trial.mode === mode);
    return {
        mode,
        meanCatalogHits: mean(selected.map(trial => trial.catalogHits)),
        meanKnownReuseHits: mean(selected.map(trial => trial.knownReuseHits)),
        meanIndependentDiscoveries: mean(selected.map(trial => trial.independentDiscoveries)),
        meanDuplicateDiscoveries: mean(selected.map(trial => trial.duplicateDiscoveries)),
        meanTotalOperations: mean(selected.map(trial => trial.totalOperations)),
        meanOperationsPerTask: mean(selected.map(trial => trial.totalOperations / trial.tasks)),
        meanAgentStandardDeviation: mean(selected.map(trial => trial.standardDeviationOperations))
    };
}

export function runSkillDiscoveryExperiment(
    registry: SkillRegistry,
    input: Partial<SkillDiscoveryExperimentConfig> = {}
): SkillDiscoveryExperimentReport {
    const config: SkillDiscoveryExperimentConfig = {
        seed: input.seed ?? 'agent-society-rs',
        agentCount: input.agentCount ?? 12,
        tasksPerAgent: input.tasksPerAgent ?? 10,
        trials: input.trials ?? 20,
        discoveryCostMultiplier: input.discoveryCostMultiplier ?? 3,
        skillIds: input.skillIds
    };
    if (!config.seed || config.seed.length > 100) throw new Error('seed must contain 1-100 characters');
    assertInteger(config.agentCount, 'agentCount', 2, 100);
    assertInteger(config.tasksPerAgent, 'tasksPerAgent', 1, 100);
    assertInteger(config.trials, 'trials', 1, 1_000);
    assertInteger(config.discoveryCostMultiplier, 'discoveryCostMultiplier', 1, 100);
    if (config.agentCount * config.tasksPerAgent * config.trials > 250_000) {
        throw new Error('experiment workload may contain at most 250000 assigned tasks');
    }
    const selected = latestVerifiedShared(registry, config.skillIds);
    if (!selected.length) throw new Error('The experiment requires at least one verified shared skill');
    const skillMap = new Map(selected.map(skill => [skill.definition.id, skill]));
    const workloads = workload(config, selected);
    const trials = workloads.flatMap(entry => [
        runTrial(entry, 'shared-library', registry, skillMap, config.discoveryCostMultiplier),
        runTrial(entry, 'isolated-discovery', registry, skillMap, config.discoveryCostMultiplier)
    ]);
    const shared = summarize('shared-library', trials);
    const isolated = summarize('isolated-discovery', trials);
    const operationSavings = isolated.meanTotalOperations - shared.meanTotalOperations;
    return {
        schemaVersion: 1,
        experiment: 'skill-discovery-sharing',
        config,
        methodology: {
            metricUnit: 'estimated-skill-operations',
            executionEstimate: 'Each task uses the selected skill definition nominal operation bound.',
            discoveryEstimate: 'A first isolated use adds nominal operations multiplied by discoveryCostMultiplier.',
            limitation: 'This deterministic model measures duplicated skill-discovery work; it is not elapsed game time or observed LLM token cost.'
        },
        catalog: selected.map(skill => ({
            id: skill.definition.id,
            version: skill.definition.version,
            nominalOperations: operationCount(skill.definition.steps)
        })),
        workloadFingerprint: createHash('sha256').update(JSON.stringify(workloads)).digest('hex'),
        trials,
        summary: {
            shared,
            isolated,
            operationSavings,
            operationSavingsPercent: isolated.meanTotalOperations === 0 ? 0 : operationSavings / isolated.meanTotalOperations * 100,
            avoidedIndependentDiscoveries: isolated.meanIndependentDiscoveries - shared.meanIndependentDiscoveries,
            avoidedDuplicateDiscoveries: isolated.meanDuplicateDiscoveries - shared.meanDuplicateDiscoveries
        }
    };
}
