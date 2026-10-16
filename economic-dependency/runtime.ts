import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collectDependencySources } from './sources.js';
import { buildDependencyGraph, validateDependencyQuery } from './graph.js';
import { analyzeEconomicDependencies } from './risk.js';
import type { DependencyOptions, DependencyQuery } from './types.js';
export function defaultDependencyOptions(): DependencyOptions {
    const root = fileURLToPath(new URL('../', import.meta.url));
    return { enginePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite'), productionPath: join(root, '.local/economy/businesses.sqlite'),
        agentPath: join(root, '.local/agent-state/agents.sqlite'), clockPath: join(root, '.local/simulation/simulation-clock.sqlite') };
}
export function reportEconomicDependencies(query: DependencyQuery, options = defaultDependencyOptions()) {
    validateDependencyQuery(query);
    return buildDependencyGraph(query, collectDependencySources(options));
}
export function reportEconomicRisk(query: DependencyQuery, options = defaultDependencyOptions()) {
    return collectEconomicRiskEvidence(query, options).risk;
}
/** Keep the native receipts and their derived graph on the same per-source snapshots. */
export function collectEconomicRiskEvidence(query: DependencyQuery, options = defaultDependencyOptions()) {
    validateDependencyQuery(query);
    const sources = collectDependencySources(options), graph = buildDependencyGraph(query, sources);
    return { risk: analyzeEconomicDependencies(graph), sources };
}
