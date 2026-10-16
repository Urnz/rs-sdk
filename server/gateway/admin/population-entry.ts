import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { loadPopulationEntryPolicy, type PopulationEntryEnvironment } from '../../../population-lifecycle/entry.js';
import { loadPopulationAgePolicy } from '../../../population-lifecycle/age.js';
import { loadPopulationLifecyclePolicyCatalog, loadPopulationWorldProfileBindingCatalog } from '../../../population-lifecycle/config.js';
import { loadWorldGenesisProfileCatalog } from '../../../world-genesis/config.js';
import { PlayerHealthEvidenceStore } from '../../engine/src/mods/PlayerHealthEvidenceStore.js';
import { agentStateDbPath, botsDir, playerSavesDir, populationHealthEngineEvidencePath, repoRoot } from './paths.js';

export interface PopulationEntryAdminOptions {
    agentPath: string;
    enginePath: string;
    accountPath: string;
    playerSavesPath: string;
    botsPath: string;
    configDirectory: string;
    onlineUsernames: string[];
    simulationClock: AgentStateSimulationClock;
}
export function populationEntryDefaults(simulationClock: AgentStateSimulationClock): PopulationEntryAdminOptions {
    return { agentPath: agentStateDbPath, enginePath: populationHealthEngineEvidencePath, accountPath: join(repoRoot, 'server/engine/db.sqlite'), playerSavesPath: playerSavesDir,
        botsPath: botsDir, configDirectory: join(repoRoot, 'config'), onlineUsernames: [], simulationClock };
}
export function loadPopulationEntryEnvironment(directory: string): PopulationEntryEnvironment {
    return { policy: loadPopulationEntryPolicy(join(directory, 'population-entry-policy.json')),
        age: loadPopulationAgePolicy(join(directory, 'population-age-policy.json')),
        profiles: loadWorldGenesisProfileCatalog(join(directory, 'world-genesis-profiles.json')),
        lifecycles: loadPopulationLifecyclePolicyCatalog(join(directory, 'population-lifecycle-policies.json')),
        bindings: loadPopulationWorldProfileBindingCatalog(join(directory, 'population-world-profile-bindings.json')) };
}

/** Uses the real finite-avatar tombstones and local namespaces. Never logs in or edits saves. */
export function runAdminPopulationEntry(options: PopulationEntryAdminOptions, request: unknown,
    apply?: { expectedPlanDigest: string; reason: string }, now = new Date().toISOString()) {
    if (!existsSync(options.agentPath)) throw new Error('Population entry AgentState authority is unavailable');
    const environment = loadPopulationEntryEnvironment(options.configDirectory);
    const agents = new AgentStateStore(options.agentPath, options.simulationClock);
    let engine: PlayerHealthEvidenceStore | null = null;
    let accounts: Database | null = null;
    let accountLookup: ReturnType<Database['prepare']> | null = null;
    try {
        const plan = agents.previewPopulationEntry(request, environment);
        const prior = agents.getPopulationEntry(plan.entryId);
        // A historical replay only returns its receipt, including after terminal death/reset.
        if (!prior) {
            if (!existsSync(options.enginePath) || !existsSync(options.accountPath) || !existsSync(options.playerSavesPath) || !existsSync(options.botsPath))
                throw new Error('Population entry avatar authority or local namespace is unavailable');
            engine = new PlayerHealthEvidenceStore(options.enginePath, true);
            if (engine.schemaVersion < 2) throw new Error('Population entry requires terminal avatar authority v2');
            accounts = new Database(options.accountPath, { readonly: true, strict: true });
            accountLookup = accounts.prepare('SELECT 1 AS found FROM account WHERE LOWER(username)=?1');
        }
        const assertUnused = (username: string) => {
            if (!engine) throw new Error('Population entry avatar authority is unavailable');
            const names = [...readdirSync(options.playerSavesPath).map(name => name.replace(/\.sav$/i, '')),
                ...readdirSync(options.botsPath), ...options.onlineUsernames].map(name => name.toLowerCase());
            if (names.includes(username) || accountLookup!.get(username) || engine.finiteAvatar(username) || engine.deathFor(username))
                throw new Error('Population entry avatar already exists or has terminal history');
        };
        if (!prior) for (const item of plan.entrants) assertUnused(item.identity.playerUsername!);
        return apply ? agents.applyPopulationEntry(request, environment, apply.expectedPlanDigest, apply.reason, assertUnused, now) : plan;
    } finally { accountLookup?.finalize(); accounts?.close(true); engine?.close(); agents.close(); }
}
