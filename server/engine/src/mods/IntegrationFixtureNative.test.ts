import World from '../engine/World.js';
import { beforeAll, afterEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { OwnedDatabase } from '../io/OwnedDatabase.js';
import { nativeIntegrationBootstrapPorts } from './IntegrationFixtureNative.js';
import Player from '../engine/entity/Player.js';
import Packet from '../io/Packet.js';
import InvType from '../cache/config/InvType.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { randomUUID } from 'node:crypto';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { FOOD_POLICY, foodDigest, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import { INTEGRATION_NATIVE_CASES, type IntegrationNativeCaseId } from '../../../gateway/admin/integration-native-cases.js';

const source = resolve(import.meta.dir, '../../../..'), pack = join(source, 'server/engine/data/pack');
const roots: string[] = [];
const load = (path: string) => import(pathToFileURL(join(source, path)).href);
const trace = (event: string, fields: Record<string, unknown> = {}) =>
    console.info('[native-case]', JSON.stringify({ event, ...fields }));
function nativeStep<T>(phase: string, action: () => T): T {
    const start = performance.now(); trace('phase-start', { phase });
    try { return action(); }
    finally { trace('phase-end', { phase, durationMs: Math.round(performance.now() - start) }); }
}
async function nativePhase<T>(phase: string, action: () => T): Promise<Awaited<T>> {
    const start = performance.now(); trace('phase-start', { phase });
    try { return await action(); }
    finally { trace('phase-end', { phase, durationMs: Math.round(performance.now() - start) }); }
}
let activeCase: { name: string; start: number } | null = null;
const registeredCases = new Set<IntegrationNativeCaseId>();
function nativeTest(id: IntegrationNativeCaseId, body: () => Promise<void>): void {
    const entry = INTEGRATION_NATIVE_CASES.find(item => item.id === id);
    if (!entry || registeredCases.has(id)) throw new Error(`Unknown/duplicate native integration case: ${id}`);
    registeredCases.add(id);
    const { name, timeoutMs } = entry;
    const measured = async () => {
        activeCase = { name, start: performance.now() }; trace('case-start', { id, name, timeoutMs });
        try { await body(); trace('body-pass', { name }); }
        catch (error) { trace('body-fail', { name }); throw error; }
    };
    test(name, measured, timeoutMs);
}
beforeAll(async () => {
    const started = performance.now(); trace('cache-load-start');
    for (const name of ['InvType', 'ObjType', 'NpcType', 'LocType', 'VarPlayerType', 'VarNpcType', 'VarBitType', 'ParamType', 'EnumType', 'StructType', 'SeqType', 'DbRowType', 'DbTableType']) {
        const type = await import(pathToFileURL(resolve(import.meta.dir, `../cache/config/${name}.ts`)).href); type.default.load(pack);
    }
    const index = await import(pathToFileURL(resolve(import.meta.dir, '../cache/config/DbTableIndex.ts')).href); index.default.init();
    trace('cache-load-end', { durationMs: Math.round(performance.now() - started) });
});
afterEach(() => {
    try { nativeStep('fixture.cleanup', () => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); }); }
    finally {
        if (activeCase) trace('case-end', { name: activeCase.name, durationMs: Math.round(performance.now() - activeCase.start) });
        activeCase = null;
    }
});
async function fixture(mode?: 'live' | 'accelerated-test', trial = false, publishedFood = false) {
    const root = mkdtempSync(join(tmpdir(), 'si-a13-native-')); roots.push(root);
    nativeStep('fixture.copy-config-catalog', () => {
        cpSync(join(source, 'config'), join(root, 'config'), { recursive: true });
        cpSync(join(source, 'agent-skills/catalog'), join(root, 'agent-skills/catalog'), { recursive: true });
    });
    // This case deliberately tests a catalog before food publication. Production
    // publication now exists in the source catalog; only the disposable fixture
    // copy omits those promoted versions. The normal draft resolver stays strict.
    if (trial && !publishedFood) for (const file of readdirSync(join(root, 'agent-skills/catalog'))) {
        const path = join(root, 'agent-skills/catalog', file), definition = JSON.parse(readFileSync(path, 'utf8'));
        if (definition.id?.startsWith('procedure.food.') && definition.status === 'verified') unlinkSync(path);
    }
    const { loadIntegrationFixture } = await load('society-integration/fixture.ts');
    const definition = loadIntegrationFixture(join(root, publishedFood ? 'config/fixtures/society-lobster-four-accelerated-test-native-sites-v1.json'
        : `config/fixtures/society-lobster-four-${mode ? mode + '-day-' : ''}v1.json`));
    writeFileSync(join(root, '.integration-stage.json'), JSON.stringify({ fixtureDigest: definition.digest }));
    if (mode) {
        const { stageSurvivalConfiguration } = await load('needs/survival-config.ts');
        stageSurvivalConfiguration(root, mode, definition.clock.profile.seed);
        writeFileSync(join(root, 'config/fixtures/society-lobster-four-v1.json'), JSON.stringify(definition));
    }
    if (definition.nativeSiteProfile) {
        const { stageIntegrationSites } = await load('society-integration/native-sites.ts');
        stageIntegrationSites(root, definition);
    }
    const { SkillRegistry } = await load('agent-skills/registry.ts'), { bootstrapIntegrationStage, bootstrapFoodTrialStage, readIntegrationBaseline } = await load('society-integration/bootstrap.ts');
    const { sealIntegrationBaseline, verifyNativeIntegrationSeal } = await load('society-integration/baseline.ts');
    const ports = await nativePhase('fixture.native-ports', () => nativeIntegrationBootstrapPorts(root));
    // Explicit technical boundary: publication availability is simulated. Native Player/genesis/needs/GP/Property stores are real.
    const readVerifiedSkill = async (id: string, version: string) => {
        const input = JSON.parse(readFileSync(join(root, `agent-skills/catalog/${id}@${version}.skill.json`), 'utf8')); input.status = 'verified';
        return new SkillRegistry().register(input, { trusted: true });
    };
    let result;
    try {
        if (trial) result = await nativePhase('fixture.trial-bootstrap', () => bootstrapFoodTrialStage(root, definition, ports));
        else { result = await nativePhase('fixture.bootstrap', () => bootstrapIntegrationStage(root, definition, { ...ports, readVerifiedSkill }));
            nativeStep('fixture.seal', () => sealIntegrationBaseline(root, definition)); }
    }
    finally { ports.close(); }
    return { root, definition, result, readIntegrationBaseline, verifyNativeIntegrationSeal, bootstrapIntegrationStage };
}

nativeTest('draft-trial', async () => {
    const f = await fixture('accelerated-test', true);
    expect(f.result.acceptance).toBe('draft-trial-only');
    expect(f.result.trialSkills.filter((s: any) => s.status === 'draft')).toHaveLength(3);
    expect(f.result.verifiedSkills).toBeUndefined();
    expect(existsSync(join(f.root, '.local/simulation/integration-fixture.json'))).toBeFalse();
    expect(existsSync(join(f.root, '.local/simulation/integration-native-seal.json'))).toBeFalse();
    expect(() => f.readIntegrationBaseline(f.root, f.definition)).toThrow();
    expect(() => f.verifyNativeIntegrationSeal(f.root, f.definition)).toThrow();
    const { AgentStateStore } = await load('agent-state/store.ts'), agents = new AgentStateStore(join(f.root, '.local/agent-state/agents.sqlite'));
    try {
        expect(agents.listPopulationMembers()).toHaveLength(4);
        for (const actor of f.definition.avatars) expect(agents.getAutonomyEnrollment(actor.agentId)).toBeNull();
    } finally { agents.close(); }
    const ports = await nativeIntegrationBootstrapPorts(f.root);
    try { await expect(f.bootstrapIntegrationStage(f.root, f.definition, ports)).rejects.toThrow('cannot be adopted'); }
    finally { ports.close(); }
});

nativeTest('published-trial', async () => {
    const f = await fixture('accelerated-test', true, true);
    expect(f.result.acceptance).toBe('draft-trial-only');
    expect(f.result.trialSkills).toHaveLength(4);
    expect(f.result.trialSkills.every((s: any) => s.status === 'verified')).toBe(true);
    expect(existsSync(join(f.root, '.local/simulation/integration-fixture.json'))).toBe(false);
    expect(existsSync(join(f.root, '.local/simulation/integration-native-seal.json'))).toBe(false);
    const { AgentStateStore } = await load('agent-state/store.ts'), agents = new AgentStateStore(join(f.root, '.local/agent-state/agents.sqlite'));
    try { for (const a of f.definition.avatars) {
        expect(agents.getAutonomyEnrollment(a.agentId)).toBeNull(); expect(agents.listGoals(a.agentId)).toEqual([]);
    } } finally { agents.close(); }
});
nativeTest('day-profiles', async () => {
    const { loadSurvivalProfile } = await load('needs/survival.ts');
    const profiles = [];
    for (const mode of ['live', 'accelerated-test'] as const) {
        const f = await fixture(mode);
        expect(f.result.lifecycles).toHaveLength(4);
        expect(f.verifyNativeIntegrationSeal(f.root, f.definition).digest).toBeTruthy();
        profiles.push(loadSurvivalProfile(f.root));
    }
    expect(profiles[0].policy).toEqual(profiles[1].policy);
    expect(profiles[0].dynamics).toEqual(profiles[1].dynamics);
    expect(profiles[0].food).toEqual(profiles[1].food);
});
nativeTest('genesis-replay', async () => {
    void World.currentTick; const f = await fixture();
    expect(f.result.lifecycles).toHaveLength(4); expect(f.result.verifiedSkills).toHaveLength(4);
    const before = f.verifyNativeIntegrationSeal(f.root, f.definition);
    const replay = await f.bootstrapIntegrationStage(f.root, f.definition, {});
    expect(replay.replayed).toBeTrue(); expect(replay.resultDigest).toBe(f.result.resultDigest);
    expect(f.verifyNativeIntegrationSeal(f.root, f.definition)).toEqual(before);
    const db = new OwnedDatabase(join(f.root, 'server/engine/data/player-checkpoints.sqlite'), { readonly: true });
    try { expect((db.query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(4); } finally { db.close(true); }
});
nativeTest('treasury-drift', async () => {
    const f = await fixture(), db = new OwnedDatabase(join(f.root, '.local/economy/institution-treasury.sqlite'));
    db.run('UPDATE institution_treasury SET balance_gp=balance_gp-1'); db.close(true);
    expect(() => f.verifyNativeIntegrationSeal(f.root, f.definition)).toThrow('treasury differs');
    await expect(f.bootstrapIntegrationStage(f.root, f.definition, {})).rejects.toThrow('treasury differs');
});
nativeTest('grant-clock-drift', async () => {
    const f = await fixture(), db = new OwnedDatabase(join(f.root, '.local/economy/businesses.sqlite'));
    db.run('DELETE FROM business_facility_entitlement'); db.close(true);
    expect(() => f.verifyNativeIntegrationSeal(f.root, f.definition)).toThrow('Facility grants');
    const clock = new OwnedDatabase(join(f.root, '.local/simulation/simulation-clock.sqlite'));
    clock.run('UPDATE simulation_clock SET last_simulation_ms=last_simulation_ms+1'); clock.close(true);
    expect(() => f.readIntegrationBaseline(f.root, f.definition)).toThrow('clock has moved');
});
nativeTest('baseline-archive', async () => {
    const f = await fixture();
    mkdirSync(join(f.root, 'server/engine/data/pack'), { recursive: true });
    for (const name of ['main_file_cache.dat', ...Array.from({ length: 5 }, (_, i) => `main_file_cache.idx${i}`)]) copyFileSync(join(pack, name), join(f.root, 'server/engine/data/pack', name));
    const { offlineArchiveIO } = await load('society-experiments/archive.ts'), { societyMinimumDigest } = await load('society-minimum/policy.ts');
    const paths = ['config/fixtures/society-lobster-four-v1.json', 'config/simulation-clock.json'];
    // Source inventory is a named fixture boundary; the archived cache and ALL native database bytes are actual files.
    const files = paths.map(path => ({ path, size: readFileSync(join(f.root, path)).length, sha256: offlineArchiveIO.fileHash(join(f.root, path)) }));
    // Include actual config/catalog sources so the restored native readers can verify every pinned reference.
    const add = (directory: string) => { for (const entry of readdirSync(join(f.root, directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`; if (entry.isDirectory()) add(path); else if (!paths.includes(path)) { paths.push(path); files.push({ path, size: readFileSync(join(f.root, path)).length, sha256: offlineArchiveIO.fileHash(join(f.root, path)) }); }
    } };
    add('config'); add('agent-skills/catalog');
    for (const name of readdirSync(join(f.root, 'server/engine/data/pack'))) {
        const path = `server/engine/data/pack/${name}`;
        files.push({ path, size: readFileSync(join(f.root, path)).length, sha256: offlineArchiveIO.fileHash(join(f.root, path)) });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    writeFileSync(join(f.root, '.local/simulation/integration-source.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: offlineArchiveIO.command(source, ['rev-parse', 'HEAD']).trim(), bunVersion: Bun.version,
        platform: process.platform, files, sourceFiles: paths, digest: societyMinimumDigest(files) }));
    const { captureIntegrationBaseline, restoreIntegrationBaseline, verifyIntegrationBaseline } = await load('society-integration/archive.ts');
    const parent = mkdtempSync(join(tmpdir(), 'si-a13-archive-')); roots.push(parent);
    const manifest = nativeStep('baseline.capture', () => captureIntegrationBaseline(f.root, join(parent, 'bundle'), f.definition, () => {}));
    expect(manifest.files.some((file: { path: string }) => /bot\.env|private\.pem|db\.sqlite$/.test(file.path))).toBeFalse();
    const restored = nativeStep('baseline.restore', () => restoreIntegrationBaseline(join(parent, 'bundle'), join(parent, 'restored')));
    expect(f.verifyNativeIntegrationSeal(restored.workspace, f.definition)).toEqual(f.verifyNativeIntegrationSeal(f.root, f.definition));
    expect(nativeStep('baseline.verify', () => verifyIntegrationBaseline(join(parent, 'bundle'))).digest).toBe(manifest.digest);
    expect(() => restoreIntegrationBaseline(join(parent, 'bundle'), join(parent, 'restored'))).toThrow('already exists');
    const credential = join(f.root, 'server/engine/data/players/main/private.pem');
    writeFileSync(credential, 'credential-exclusion-test');
    expect(() => captureIntegrationBaseline(f.root, join(parent, 'with-credential'), f.definition, () => {})).toThrow('Credential/private');
    unlinkSync(credential);
    const configPath = join(f.root, paths[0]!), configBytes = readFileSync(configPath);
    writeFileSync(configPath, Buffer.concat([configBytes, Buffer.from('\n')]));
    expect(() => captureIntegrationBaseline(f.root, join(parent, 'changed-source'), f.definition, () => {})).toThrow('Source/config/cache changed');
    writeFileSync(configPath, configBytes);
    writeFileSync(join(parent, 'bundle/workspace/payload', paths[0]!), 'tampered');
    expect(() => verifyIntegrationBaseline(join(parent, 'bundle'))).toThrow('payload changed');
});
nativeTest('recovery-save', async () => {
    const { parsePlayerSaveBytes } = await load('server/gateway/admin/save-reader.ts');
    const player = new Player('sirecovery', 2n, 2n);
    const empty = parsePlayerSaveBytes(player.save(false), '2001-01-01T00:00:00.000Z', true);
    expect(empty.valid).toBeTrue(); expect(empty.version).toBe(8);
    player.recoveryItems.push({ id: 995, count: 17 });
    const recovery = parsePlayerSaveBytes(player.save(false), '2001-01-01T00:00:00.000Z', true);
    expect(recovery.valid).toBeFalse(); expect(recovery.error).toContain('pending recovery assets');
});

async function resultSourceInventory(root: string) {
    mkdirSync(join(root, 'server/engine/data/pack'), { recursive: true });
    for (const name of ['main_file_cache.dat', ...Array.from({ length: 5 }, (_, i) => `main_file_cache.idx${i}`)])
        copyFileSync(join(pack, name), join(root, 'server/engine/data/pack', name));
    const { offlineArchiveIO: io } = await load('society-experiments/archive.ts'), { societyMinimumDigest: digest } = await load('society-minimum/policy.ts');
    const files: { path: string; size: number; sha256: string }[] = [];
    const add = (relative: string) => { for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) add(path); else files.push({ path, size: readFileSync(join(root, path)).length, sha256: io.fileHash(join(root, path)) });
    } };
    for (const relative of ['config', 'agent-skills/catalog', 'server/engine/data/pack']) add(relative);
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    writeFileSync(join(root, '.local/simulation/integration-source.json'), JSON.stringify({ schemaVersion: 1,
        sourceCommit: io.command(source, ['rev-parse', 'HEAD']).trim(), bunVersion: Bun.version, platform: process.platform,
        files, sourceFiles: files.filter(file => !file.path.startsWith('server/engine/data/pack/')).map(file => file.path), digest: digest(files) }));
}
for (const mode of ['live', 'accelerated-test'] as const) nativeTest(`${mode}-result`, async () => {
    const { captureIntegrationResult, restoreIntegrationResult, verifyIntegrationResult, readIntegrationResult, captureIntegrationBaseline, verifyIntegrationBaseline } = await load('society-integration/archive.ts');
    const { SimulationClockStore } = await load('simulation-clock/store.ts');
    const { loadSurvivalProfile } = await load('needs/survival.ts');
    const { FoodNeedsPersistence } = await load('food-loop/needs-persistence.ts');
    const { NativeFoodSource } = await load('food-loop/native-source.ts');
    const { societyMinimumDigest: digest } = await load('society-minimum/policy.ts');
    ScriptProvider.load(pack);
    {
        const f = await fixture(mode); await nativePhase('result.source-inventory', () => resultSourceInventory(f.root));
        const parent = mkdtempSync(join(tmpdir(), 'si-a15-result-')); roots.push(parent);
        expect(() => captureIntegrationResult(f.root, join(parent, 'genesis'), f.definition, () => {})).toThrow('progressed clock');
        const time = new SimulationClockStore(join(f.root, '.local/simulation/simulation-clock.sqlite'));
        const start = time.get('world').lastObservedWallTime, end = new Date(Date.parse(start) + (mode === 'live' ? 3600000 : 300000)).toISOString();
        const checkpoint = join(f.root, 'server/engine/data/player-checkpoints.sqlite'), market = new MarketStore(checkpoint);
        const binding = f.result.lifecycles.find((a: any) => a.agentId === 'sifisher').binding;
        const p = loadSurvivalProfile(f.root), needs = new FoodNeedsPersistence(join(f.root, '.local/simulation/food-needs.sqlite'), p.policy, p.dynamics, p.food);
        const food = new NativeFoodSource({ workspace: f.root, worldId: f.result.worldId, checkpointPath: checkpoint });
        try {
            time.resume('world', time.get('world').revision, start); const clock = time.observe('world', end, 100); World.currentTick = 100;
            const player = PlayerLoading.load('sifisher', new Packet(market.saved('sifisher')!), null), inv = player.getInventory(InvType.INV)!;
            const context: NativeFoodContext = { action: { actionId: randomUUID(), worldId: binding.worldId, actorId: binding.actorId,
                username: binding.playerId, lifecycleId: binding.lifecycleId, itemId: 379, quantity: 1,
                slot: inv.items.findIndex(item => item?.id === 379), policyDigest: foodDigest(FOOD_POLICY), clockId: binding.clockId,
                clockProfileDigest: binding.clockProfileDigest }, clock };
            // Identity/arrival is a named test precondition; food is the real packed native script and checkpoint.
            const result = executeNativeFoodAction(market, player, context, save => market.checkpoint(player.username, save, true), () => context);
            expect(result.outcome).toBe('consumed'); closeFoodDeliveryTick(market.db, clock);
            const applied = needs.nativeFood.apply(food, 1, { binding, clock, history: time.getPlayerTimeHistory('world', 'sifisher'),
                playerTime: time.getPlayerTimeState('world', 'sifisher'), expectedRevision: 1 });
            expect(applied.hungerRelief).toBe(2400); time.pause('world', time.get('world').revision, end);
        } finally { food.close(); needs.close(); market.db.close(true); time.close(); }
        expect(() => captureIntegrationBaseline(f.root, join(parent, 'false-baseline'), f.definition, () => {})).toThrow('clock has moved');
        const manifest = nativeStep('result.capture', () => captureIntegrationResult(f.root, join(parent, 'result'), f.definition, () => {}));
        expect(manifest.result.artifactKind).toBe('progressed-native-result');
        expect(manifest.result.liveAcceptance).toBe('not-established-by-archive');
        expect(manifest.result.report.completePopulationCoverage).toBeFalse();
        expect(manifest.result.report.evidence.some((e: any) => e.channel === 'nutrition')).toBeTrue();
        expect(() => verifyIntegrationBaseline(join(parent, 'result'))).toThrow('manifest differs');
        const restored = nativeStep('result.restore', () => restoreIntegrationResult(join(parent, 'result'), join(parent, 'restored')));
        expect(nativeStep('result.reread', () => readIntegrationResult(restored.workspace, f.definition))).toEqual(manifest.result);
        expect(nativeStep('result.verify', () => verifyIntegrationResult(join(parent, 'result'))).digest).toBe(manifest.digest);
        expect(() => restoreIntegrationResult(join(parent, 'result'), join(parent, 'restored'))).toThrow('already exists');
        const store = join(f.root, '.local/economy/institution-treasury.sqlite'), bytes = readFileSync(store);
        expect(() => captureIntegrationResult(f.root, join(parent, 'writers'), f.definition, () => { throw new Error('writer active'); })).toThrow('writer active');
        expect(readFileSync(store)).toEqual(bytes);
        const manifestPath = join(parent, 'result/workspace/manifest.json'), manifestBytes = readFileSync(manifestPath);
        const forged = JSON.parse(manifestBytes.toString()); forged.result.report.completePopulationCoverage = true;
        const { digest: _hash, ...body } = forged; forged.digest = digest(body);
        writeFileSync(manifestPath, JSON.stringify(forged));
        expect(() => verifyIntegrationResult(join(parent, 'result'))).toThrow('native result/report differs');
        writeFileSync(manifestPath, manifestBytes);
        let probes = 0;
        expect(() => captureIntegrationResult(f.root, join(parent, 'drift'), f.definition, () => {
            if (++probes === 2) {
                const writer = new OwnedDatabase(store);
                try { writer.run('UPDATE institution_treasury SET balance_gp=balance_gp-1'); } finally { writer.close(true); }
            }
        })).toThrow('changed during capture');
        expect(existsSync(join(parent, 'drift'))).toBeFalse();
        const frozen = join(parent, 'result/workspace/payload/config/survival-profile.json');
        writeFileSync(frozen, '{}'); expect(() => verifyIntegrationResult(join(parent, 'result'))).toThrow('payload changed');
    }
});

if (registeredCases.size !== INTEGRATION_NATIVE_CASES.length) throw new Error('Native integration case manifest is incomplete');
