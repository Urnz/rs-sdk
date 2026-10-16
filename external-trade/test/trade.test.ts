import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { WorldGenesisRunStore, buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog } from '../../world-genesis/index.js';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { validateExternalTradePolicy, validateExternalTradeCatalogs, resolveExternalTradePolicy, loadExternalTradeCatalogs, digest } from '../policy.js';
import { observeExternalTrade, reportExternalTrade, type ExternalTradeOptions } from '../runtime.js';
import { ExternalTradeStore } from '../store.js';
import { readNativeTrades, readDatabase } from '../source.js';
import { bindNativeEngineTradeClock } from '../engine-clock.js';

const roots: string[] = [], config = join(import.meta.dir, '../../config');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const at = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
const wall = (hour: number) => new Date(Date.UTC(2026, 9, 15, hour)).toISOString();
const definition = () => ({ schemaVersion: 1, policyId: 'finite-regional-trade', version: '1.0.0', settlement: 'committed-engine-player-trade',
    automaticRestock: 'forbidden', maximumSimulationMilliseconds: 86400000, counterparties: [{ counterpartyId: 'regional', username: 'merchant',
        maximumTrades: 3, maximumImportedGp: 100, maximumExportedGp: 100,
        items: [{ itemId: 379, maximumImportedUnits: 2, maximumExportedUnits: 2 }, { itemId: 436, maximumImportedUnits: 10, maximumExportedUnits: 10 }] }] });
function fixture(permitted = true) {
    const root = mkdtempSync(join(tmpdir(), 'external-trade-')); roots.push(root);
    const directory = join(root, 'config'); cpSync(config, directory, { recursive: true });
    const policy = validateExternalTradePolicy(definition());
    const profile = loadWorldGenesisProfileCatalog(join(config, 'world-genesis-profiles.json')).profiles.find(item => item.profileId === 'frontier')!;
    const binding = { worldProfileId: profile.profileId, worldProfileVersion: profile.version, worldProfileDigest: profile.digest,
        policyId: policy.policyId, policyVersion: policy.version, policyDigest: policy.digest };
    writeFileSync(join(directory, 'external-trade-policies.json'), JSON.stringify({ schemaVersion: 1, policies: [definition()] }));
    writeFileSync(join(directory, 'external-trade-world-profile-bindings.json'), JSON.stringify({ schemaVersion: 1, bindings: permitted ? [binding] : [] }));
    const options: ExternalTradeOptions = { statePath: join(root, 'external.sqlite'), enginePath: join(root, 'trades.sqlite'),
        clockPath: join(root, 'clock.sqlite'), agentPath: join(root, 'agents.sqlite'), genesisPath: join(root, 'genesis.sqlite'), configDirectory: directory };
    const clock = new SimulationClockStore(options.clockPath), clockProfile = { schemaVersion: 1 as const, profileId: 'test', version: '1.0.0', seed: 'external',
        rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } };
    clock.create({ clockId: 'world', profile: clockProfile, wallTime: wall(0), simulationTime: at(0) }); clock.close();
    const agents = new AgentStateStore(options.agentPath);
    try { for (const name of ['ada', 'bea']) agents.createIdentity({ agentId: name, playerUsername: name, displayName: name, background: 'local', personalityTraits: ['careful'] }, wall(0)); }
    finally { agents.close(); }
    const result = buildWorldGenesisResult(buildWorldGenesisConfiguration({ seed: 'external', profile, worldBuild: 'lostcity-local',
        simulationClock: { clockId: 'world', profileDigest: simulationClockProfileDigest(clockProfile), initialSimulationTime: at(0) } }), { assets: [] }, wall(0));
    const runs = new WorldGenesisRunStore(options.genesisPath);
    try { const run = runs.begin(result, {}, wall(0)); runs.finishApply(result.resultId, run.revision, { verified: true }, wall(0)); } finally { runs.close(); }
    new TradeEvidenceStore(options.enginePath).close();
    let ordinal = 0;
    function trade(hour = 1, from = 'merchant', to = 'ada', fromItems = [{ id: 379, name: 'lobster', count: 1 }], toItems = [{ id: 995, name: 'coins', count: 40 }], timed = true) {
        const store = new TradeEvidenceStore(options.enginePath, timed ? event => {
            const clock = new SimulationClockStore(options.clockPath);
            try { clock.bindEvent({ clockId: 'world', domain: 'engine-trade', sourceId: event.eventId, sourceDigest: event.eventDigest, wallTime: event.committedAt, engineTick: event.tick }); }
            finally { clock.close(); }
        } : undefined);
        const id = `10000000-0000-4000-8000-${String(++ordinal).padStart(12, '0')}`;
        try { return store.record({ tick: ordinal, fromUsername: from, toUsername: to, fromItems, toItems,
            fromValue: 9999, toValue: 8888, committedAt: wall(hour) }, id); } finally { store.close(); }
    }
    return { options, result, policy, binding, profile, trade,
        observe: () => observeExternalTrade(options, result.resultId),
        report: (from = at(0), to = at(23)) => reportExternalTrade(options, result.resultId, from, to) as any };
}
function mutate(path: string, sql: string) {
    const db = new Database(path); try { db.run(sql); } finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
}

describe('finite external trade policy and native measurement', () => {
    test('all shipped world profiles default to denied and registration creates no ledger without opt-in', () => {
        const catalogs = loadExternalTradeCatalogs(config);
        for (const profile of loadWorldGenesisProfileCatalog(join(config, 'world-genesis-profiles.json')).profiles) expect(resolveExternalTradePolicy(profile, catalogs)).toBeNull();
        const f = fixture(false); expect(() => f.observe()).toThrow('explicitly permitted'); expect(existsSync(f.options.statePath)).toBeFalse();
    });
    test('exact world and policy digests are mandatory, even with unchanged version strings', () => {
        const f = fixture(), policies = { schemaVersion: 1, policies: [definition()] };
        expect(() => validateExternalTradeCatalogs(policies, { schemaVersion: 1, bindings: [{ ...f.binding, policyDigest: 'a'.repeat(64) }] })).toThrow();
        const catalogs = validateExternalTradeCatalogs(policies, { schemaVersion: 1, bindings: [{ ...f.binding, worldProfileDigest: 'a'.repeat(64) }] });
        expect(() => resolveExternalTradePolicy(f.profile, catalogs)).toThrow('Stale');
        expect(() => validateExternalTradePolicy({ ...definition(), automaticRestock: 'automatic' })).toThrow();
        expect(() => validateExternalTradePolicy({ ...definition(), settlement: 'npc-shop' })).toThrow();
    });
    test('duplicate/unbounded/unknown policy fields and currency disguised as goods are rejected', () => {
        const base = definition();
        expect(() => validateExternalTradePolicy({ ...base, extra: true })).toThrow();
        expect(() => validateExternalTradePolicy({ ...base, counterparties: [base.counterparties[0], base.counterparties[0]] })).toThrow();
        expect(() => validateExternalTradePolicy({ ...base, maximumSimulationMilliseconds: Infinity })).toThrow();
        expect(() => validateExternalTradePolicy({ ...base, counterparties: [{ ...base.counterparties[0], items: [{ itemId: 995, maximumImportedUnits: 1, maximumExportedUnits: 1 }] }] })).toThrow();
    });
    test('actual item and GP flows are separate from valuations, with restart and exact replay idempotence', () => {
        const f = fixture(); expect(f.observe().added).toBe(0); const trade = f.trade(); expect(f.observe().added).toBe(1); expect(f.observe().added).toBe(0);
        expect(f.report()).toMatchObject({ observed: { exchanges: 1, importedGp: 0, exportedGp: 40, netImportedGp: -40,
            items: [{ itemId: 379, importedUnits: 1, exportedUnits: 0 }] }, assessment: 'no-observed-policy-violation', provesSelfSufficiency: false });
        expect(f.report().events[0]!.eventId).toBe(trade.eventId);
        const { digest: expected, ...report } = f.report(); expect(digest(report)).toBe(expected);
    });
    test('both trade orientations, barter and coin-only external transfers retain gross directions', () => {
        const f = fixture(); f.observe();
        f.trade(1, 'ada', 'merchant', [{ id: 436, name: 'ore', count: 2 }], [{ id: 379, name: 'food', count: 1 }]);
        f.trade(2, 'merchant', 'ada', [{ id: 995, name: 'coins', count: 30 }], []);
        f.observe(); expect(f.report().observed).toMatchObject({ exchanges: 2, importedGp: 30, exportedGp: 0,
            items: [{ itemId: 379, importedUnits: 1, exportedUnits: 0 }, { itemId: 436, importedUnits: 0, exportedUnits: 2 }] });
    });
    test('item, GP, count and time violations are retained instead of rejected or resetting quota', () => {
        const f = fixture(); f.observe(); for (const hour of [1, 2, 3, 25]) f.trade(hour);
        expect(f.observe().added).toBe(4);
        const report = f.report(at(0), at(26)); expect(report.assessment).toBe('violations-observed'); expect(report.observed.exchanges).toBe(4);
        expect(report.allObservedIssues.flatMap((item: any) => item.issues)).toEqual(expect.arrayContaining(['import-item-limit:379', 'export-gp-limit', 'trade-count-limit', 'outside-policy-time-window']));
        expect(f.observe().added).toBe(0); expect(f.report(at(0), at(26)).observed.exchanges).toBe(4);
    });
    test('simulation windows are (start,end] and quota violations cannot be laundered by narrowing the report window', () => {
        const f = fixture(); f.observe(); for (const h of [1, 2, 3]) f.trade(h); f.observe();
        expect(f.report(at(0), at(1)).observed.exchanges).toBe(1); expect(f.report(at(1), at(2)).observed.exchanges).toBe(1);
        expect(f.report(at(0), at(1)).assessment).toBe('violations-observed');
    });
    test('internal/outside trades are not imports, and unregistered boundary counterparties remain flagged', () => {
        const f = fixture(); f.observe(); f.trade(1, 'ada', 'bea'); f.trade(2, 'one', 'two'); f.trade(3, 'stranger', 'ada'); f.observe();
        expect(f.report()).toMatchObject({ observed: { exchanges: 0 }, unregisteredBoundary: { timed: { exchanges: 1 } }, assessment: 'violations-observed' });
        expect(f.report().events[0]).toMatchObject({ kind: 'unregistered-counterparty', counterpartyId: null });
    });
    test('missing contemporaneous timing remains untimed and does not become a clean zero-demand window', () => {
        const f = fixture(); f.observe(); f.trade(1, 'merchant', 'ada', [{ id: 379, name: 'food', count: 1 }], [], false); f.observe();
        expect(f.report()).toMatchObject({ observed: { exchanges: 0 }, untimed: { exchanges: 1 }, assessment: 'inconclusive' });
    });
    test('registration anchors the current native tail and exposes pre-registration/unsynchronized coverage gaps', () => {
        const f = fixture(); f.trade(1); f.observe(); f.trade(2);
        expect(f.report()).toMatchObject({ pendingSourceEvents: 1, windowStartsBeforeRegistration: true, observed: { exchanges: 0 } });
        f.observe(); expect(f.report().observed.exchanges).toBe(1);
    });
    test('native row tampering, source tail deletion and domain tail deletion fail closed', () => {
        for (const mode of ['native-row', 'native-tail', 'local-tail']) {
            const f = fixture(); f.observe(); f.trade(); f.observe();
            if (mode === 'native-row') mutate(f.options.enginePath, 'UPDATE engine_trade_evidence SET to_value=12');
            if (mode === 'native-tail') {
                mutate(f.options.enginePath, 'DELETE FROM engine_trade_evidence_audit'); mutate(f.options.enginePath, 'DELETE FROM engine_trade_evidence');
            }
            if (mode === 'local-tail') mutate(f.options.statePath, 'DELETE FROM external_trade_event');
            expect(() => f.report()).toThrow(); expect(() => f.observe()).toThrow();
        }
    });
    test('missing or forged persisted clock backing cannot be replaced with caller timestamps', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe();
        mutate(f.options.clockPath, "UPDATE simulation_event_stamp SET simulation_time='2035-01-01T00:00:00.000Z' WHERE domain='engine-trade'");
        expect(() => f.report()).toThrow('backing');
    });
    test('policy changes and internal/external identity overlap cannot renew a run or its budgets', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe();
        const altered = definition(); altered.counterparties[0]!.maximumTrades = 99;
        writeFileSync(join(f.options.configDirectory, 'external-trade-policies.json'), JSON.stringify({ schemaVersion: 1, policies: [altered] }));
        expect(() => f.observe()).toThrow(); expect(f.report().observed.exchanges).toBe(1);
        const other = fixture(); const agents = new AgentStateStore(other.options.agentPath);
        agents.createIdentity({ agentId: 'merchant', playerUsername: 'merchant', displayName: 'merchant', background: 'local', personalityTraits: ['careful'] }, wall(0)); agents.close();
        expect(() => other.observe()).toThrow('overlap'); expect(existsSync(other.options.statePath)).toBeFalse();
    });
    test('source path changes and missing native databases do not silently create replacement stores', () => {
        const f = fixture(); f.observe(); const missing = join(f.options.statePath, 'missing.sqlite');
        expect(() => reportExternalTrade({ ...f.options, enginePath: missing }, f.result.resultId, at(0), at(2))).toThrow('paths');
        expect(existsSync(missing)).toBeFalse();
        const absent = fixture(); expect(absent.report()).toMatchObject({ status: 'unavailable' }); expect(existsSync(absent.options.statePath)).toBeFalse();
    });
    test('reset retains historical measurements and blocks further observation', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe(); const runs = new WorldGenesisRunStore(f.options.genesisPath);
        try { const prior = runs.get(f.result.resultId)!; const reset = runs.beginReset(prior.resultId, prior.revision, wall(2)); runs.finishReset(reset.resultId, reset.revision, wall(2)); } finally { runs.close(); }
        expect(f.report()).toMatchObject({ nativeApplicationStatus: 'reset', observed: { exchanges: 1 } }); expect(() => f.observe()).toThrow('applied genesis');
    });
    test('read-only store refuses writes and future schema cannot be interpreted as empty measurements', () => {
        const f = fixture(); f.observe(); const store = new ExternalTradeStore(f.options.statePath, true);
        try { expect(() => store.observe(f.result.resultId, [])).toThrow('read-only'); } finally { store.close(); }
        mutate(f.options.statePath, 'PRAGMA user_version=2'); expect(() => f.report()).toThrow('schema');
    });
    test('closed-society minimum rejects an external-enabled profile instead of certifying it as closed', () => {
        const f = fixture(), mature = loadWorldGenesisProfileCatalog(join(config, 'world-genesis-profiles.json')).profiles.find(item => item.profileId === 'mature-society')!;
        writeFileSync(join(f.options.configDirectory, 'external-trade-world-profile-bindings.json'), JSON.stringify({ schemaVersion: 1,
            bindings: [{ ...f.binding, worldProfileId: mature.profileId, worldProfileVersion: mature.version, worldProfileDigest: mature.digest }] }));
        expect(() => loadSocietyMinimumContract(f.options.configDirectory)).toThrow('cannot permit external trade');
    });
    test('engine binds newly committed receipts exactly once and never backfills old events on replay', () => {
        const f = fixture(), calls: string[] = [], source = new TradeEvidenceStore(f.options.enginePath, event => calls.push(event.eventId));
        const input = { tick: 1, fromUsername: 'merchant', toUsername: 'ada', fromItems: [{ id: 379, name: 'food', count: 1 }], toItems: [], fromValue: 0, toValue: 0, committedAt: wall(1) };
        const id = '20000000-0000-4000-8000-000000000001';
        try { const first = source.record(input, id); expect(source.record(input, id)).toEqual(first); expect(calls).toEqual([id]); } finally { source.close(); }
        const warn = spyOn(console, 'warn').mockImplementation(() => {}), failing = new TradeEvidenceStore(f.options.enginePath, () => { throw new Error('clock unavailable'); });
        try { const event = failing.record({ ...input, tick: 2 }, '20000000-0000-4000-8000-000000000002'); expect(failing.get(event.eventId)).toEqual(event); expect(warn).toHaveBeenCalledTimes(1); }
        finally { failing.close(); warn.mockRestore(); }
    });
    test('actual native clock bridge uses only the existing configured clock and persists exact event/tick/digest binding', () => {
        const f = fixture(); f.observe();
        const configured = readDatabase(f.options.clockPath, db => JSON.parse((db.query('SELECT profile_json FROM simulation_clock').get() as any).profile_json));
        const configPath = join(f.options.configDirectory, 'trade-clock.json');
        writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, clockId: 'world', initialSimulationTime: at(0), profile: configured }));
        const source = new TradeEvidenceStore(f.options.enginePath, event => bindNativeEngineTradeClock(event, { configPath, databasePath: f.options.clockPath }));
        try { source.record({ tick: 17, fromUsername: 'merchant', toUsername: 'ada', fromItems: [{ id: 379, name: 'food', count: 1 }],
            toItems: [], fromValue: 0, toValue: 0, committedAt: wall(1) }); } finally { source.close(); }
        f.observe(); expect(f.report().events[0]!.simulationTime).toBe(at(1));
        const missing = join(f.options.configDirectory, 'nonexistent-clock.sqlite');
        bindNativeEngineTradeClock({ eventId: 'unused', eventDigest: 'a'.repeat(64), tick: 1, committedAt: wall(1) }, { configPath, databasePath: missing });
        expect(existsSync(missing)).toBeFalse();
    });
    test('losing the accounting database cannot renew finite quotas under the same native genesis', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe(); rmSync(f.options.statePath);
        expect(() => f.observe()).toThrow('history was lost'); expect(existsSync(f.options.statePath)).toBeFalse();
    });
    test('gross item limits are not replenished by exporting the same commodity back', () => {
        const f = fixture(); f.observe(); f.trade(1, 'merchant', 'ada', [{ id: 379, name: 'food', count: 2 }], []);
        f.trade(2, 'ada', 'merchant', [{ id: 379, name: 'food', count: 2 }], []);
        f.trade(3, 'merchant', 'ada', [{ id: 379, name: 'food', count: 1 }], []); f.observe();
        expect(f.report().observed.items[0]).toEqual({ itemId: 379, importedUnits: 3, exportedUnits: 2 });
        expect(f.report().allObservedIssues.at(-1).issues).toContain('import-item-limit:379');
    });
    test('unidentified native item ids remain visible uncertainty instead of name-based goods or GP', () => {
        const f = fixture(); f.observe(); const source = new TradeEvidenceStore(f.options.enginePath);
        try { source.record({ tick: 1, fromUsername: 'merchant', toUsername: 'ada', fromItems: [{ id: undefined, name: 'coins', count: 100 }],
            toItems: [], fromValue: 0, toValue: 0, committedAt: wall(1) }); } finally { source.close(); }
        f.observe(); expect(f.report()).toMatchObject({ untimed: { importedGp: 0 }, assessment: 'inconclusive' });
        expect(f.report().allObservedIssues[0]!.issues).toContain('unidentified-item');
    });
    test('unsafe totals roll back the observation batch and preserve its previous audit checkpoint', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe(); const before = f.report();
        f.trade(2, 'merchant', 'ada', [{ id: 379, name: 'food', count: Number.MAX_SAFE_INTEGER }, { id: 379, name: 'food', count: 1 }], []);
        expect(() => f.observe()).toThrow('integer');
        const report = f.report(); expect(report.journalHeadHash).toBe(before.journalHeadHash);
        expect(report.observed.exchanges).toBe(1); expect(report.pendingSourceEvents).toBe(1);
    });
    test('canonical extended ISO years use chronological order and reversed windows are rejected', () => {
        const f = fixture(); f.observe(); f.trade(); f.observe();
        expect(f.report(at(0), '+010000-01-01T00:00:00.000Z').observed.exchanges).toBe(1);
        expect(() => f.report('+010000-01-01T00:00:00.000Z', at(23))).toThrow('window');
    });
});
