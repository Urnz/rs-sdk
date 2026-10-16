import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldGenesisProfileCatalog } from '../world-genesis/config.js';
import { validateWorldGenesisResult } from '../world-genesis/result.js';
import { loadExternalTradeCatalogs, resolveExternalTradePolicy, digest, key, time, username } from './policy.js';
import { check, readDatabase, readNativeTrades, ZERO } from './source.js';
import { ExternalTradeStore } from './store.js';
import type { TradeRun } from './measurement.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../agent-state/types.js';

export interface ExternalTradeOptions { statePath: string; enginePath: string; clockPath: string; agentPath: string; genesisPath: string; configDirectory: string }
const sourceBinding = (options: ExternalTradeOptions) => digest([options.enginePath, options.clockPath, options.agentPath, options.genesisPath].map(path => resolve(path)));
export function defaultExternalTradeOptions(): ExternalTradeOptions {
    const root = fileURLToPath(new URL('../', import.meta.url));
    return { statePath: join(root, '.local/simulation/external-trade.sqlite'), enginePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite'),
        clockPath: join(root, '.local/simulation/simulation-clock.sqlite'), agentPath: join(root, '.local/agent-state/agents.sqlite'),
        genesisPath: join(root, '.local/simulation/world-genesis-runs.sqlite'), configDirectory: join(root, 'config') };
}
function genesis(options: ExternalTradeOptions, runId: string) {
    return readDatabase(options.genesisPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === 1, 'Unsupported native genesis schema');
        const row = db.query('SELECT * FROM world_genesis_application WHERE result_id=?1').get(key(runId)) as any;
        check(row && row.receipt_json !== null, 'Applied genesis receipt is unavailable');
        const result = validateWorldGenesisResult(JSON.parse(row.result_json));
        check(result.resultId === runId && result.resultDigest === row.result_digest, 'Genesis native binding differs');
        return { result, status: row.status as string };
    });
}
function participants(options: ExternalTradeOptions) {
    return readDatabase(options.agentPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === AGENT_STATE_SCHEMA_VERSION, 'Unsupported native agent schema');
        return (db.query('SELECT agent_id,player_username FROM agent_identity WHERE player_username IS NOT NULL ORDER BY agent_id')
            .all() as any[]).map(row => ({ agentId: key(row.agent_id), username: username(row.player_username) }));
    });
}
function registrationAnchor(options: ExternalTradeOptions, runId: string) {
    return readDatabase(options.clockPath, db => db.query("SELECT * FROM simulation_event_stamp WHERE domain='external-trade-registration' AND source_id=?1")
        .all(runId) as any[]);
}
function assertRegistrationAnchor(options: ExternalTradeOptions, run: TradeRun): void {
    const anchors = registrationAnchor(options, run.runId);
    check(anchors.length === 1 && anchors[0]!.clock_id === run.clockId && anchors[0]!.source_digest === digest(run)
        && anchors[0]!.profile_digest === run.clockProfileDigest, 'External registration clock anchor differs or is missing');
}
/** Accounting-only observation. Registration adds a clock marker at the already observed time. */
export function observeExternalTrade(options: ExternalTradeOptions, runId: string) {
    const applied = genesis(options, runId); check(applied.status === 'applied', 'External observation requires applied genesis');
    const profile = loadWorldGenesisProfileCatalog(join(options.configDirectory, 'world-genesis-profiles.json')).profiles
        .find(profile => profile.profileId === applied.result.profile.profileId);
    check(profile && digest({ profileId: profile.profileId, version: profile.version, digest: profile.digest }) === digest(applied.result.profile), 'Current genesis profile binding differs');
    const policy = resolveExternalTradePolicy(profile, loadExternalTradeCatalogs(options.configDirectory));
    check(policy, 'World profile has not explicitly permitted external trade');
    const actors = participants(options);
    check(actors.length > 0 && !actors.some(actor => policy.counterparties.some(partner => partner.username === actor.username)), 'External/internal participant overlap or empty registry');
    const clock = readDatabase(options.clockPath, db => db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(applied.result.simulationClock.clockId) as any);
    check(clock && clock.profile_digest === applied.result.simulationClock.profileDigest, 'External observation clock profile differs');
    const source = readNativeTrades(options.enginePath, options.clockPath, clock.clock_id);
    if (!existsSync(options.statePath)) check(registrationAnchor(options, runId).length === 0,
        'External history was lost after registration; restore it instead of renewing quotas');
    const store = new ExternalTradeStore(options.statePath);
    try {
        let run = store.get(runId);
        if (run) check(run.sourceBindingDigest === sourceBinding(options) && run.resultDigest === applied.result.resultDigest && digest(run.policy) === digest(policy)
            && digest(run.participants) === digest(actors), 'External run policy/participant binding changed');
        else {
            check(registrationAnchor(options, runId).length === 0, 'External history was lost after registration; restore it instead of renewing quotas');
            run = { runId, resultDigest: applied.result.resultDigest, profile: applied.result.profile, clockId: clock.clock_id,
                sourceBindingDigest: sourceBinding(options),
                clockProfileDigest: clock.profile_digest, startedAtSimulationTime: new Date(clock.last_simulation_ms).toISOString(),
                startedAtWallTime: new Date(clock.last_observed_wall_ms).toISOString(), participants: actors, policy,
                sourceStart: { sequence: source.at(-1)?.sequence ?? 0, headHash: source.at(-1)?.headHash ?? ZERO } } satisfies TradeRun;
            const binding = new SimulationClockStore(options.clockPath);
            try { binding.bindEvent({ clockId: run.clockId, domain: 'external-trade-registration', sourceId: runId,
                sourceDigest: digest(run), wallTime: run.startedAtWallTime }); } finally { binding.close(); }
            store.begin(run);
        }
        assertRegistrationAnchor(options, run);
        return { runId, added: store.observe(runId, source), registration: run };
    } finally { store.close(); }
}
/** Read-only report; source lag and missing history never constitute a complete clean run. */
export function reportExternalTrade(options: ExternalTradeOptions, runId: string, from: string, to: string) {
    key(runId); time(from); time(to); check(Date.parse(from) < Date.parse(to), 'External metric window is invalid');
    if (!existsSync(options.statePath)) return { status: 'unavailable' as const, reason: 'No registered external trade history.' };
    const store = new ExternalTradeStore(options.statePath, true);
    try {
        const run = store.get(runId); if (!run) return { status: 'unavailable' as const, reason: 'No registered external trade history.' };
        check(run.sourceBindingDigest === sourceBinding(options), 'External native source paths changed');
        assertRegistrationAnchor(options, run);
        const applied = genesis(options, runId);
        check(run.resultDigest === applied.result.resultDigest, 'External genesis backing changed');
        const source = readNativeTrades(options.enginePath, options.clockPath, run.clockId);
        const { digest: measurementDigest, ...report } = store.reportBacked(runId, source, from, to);
        const definition = { status: 'observed' as const, ...report, nativeApplicationStatus: applied.status,
            pendingSourceEvents: source.length - report.observedThroughSourceSequence,
            excludedNativePrefixEvents: run.sourceStart.sequence, fullRunCoverage: 'unavailable' as const,
            windowStartsBeforeRegistration: Date.parse(from) < Date.parse(run.startedAtSimulationTime),
            currentRosterMatches: digest(participants(options)) === digest(run.participants) };
        return { ...definition, digest: digest(definition) };
    } finally { store.close(); }
}
