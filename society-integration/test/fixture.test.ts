import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadIntegrationFixture, fixtureDefinitionDigest, validateIntegrationFixture, inspectIntegrationReferences, integrationGenesis, integrationWorldId } from '../fixture.js';
import { preflightIntegrationDefinition, bootstrapIntegrationStage } from '../bootstrap.js';
import { SkillRegistry } from '../../agent-skills/registry.js';
import { createIntegrationWorkspace } from '../archive.js';
import { INTEGRATION_ACCEPTANCE_CASES, buildIntegrationRegressionBundle, verifyIntegrationRegressionBundle } from '../acceptance.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { ReplanInboxStore } from '../../server/gateway/admin/replan-inbox.js';
import { stageIntegrationSites, withIntegrationSites } from '../native-sites.js';

const root = resolve(import.meta.dir, '../..'), fixture = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-v1.json'));
function changed(edit: (f: typeof fixture) => void) { const f = structuredClone(fixture); edit(f); f.digest = fixtureDefinitionDigest(f); return f; }

test('native site profile is confined to fresh worlds and corrects actual kitchen and two ground-floor beds without changing physiology or funds', () => {
    const candidate = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-accelerated-test-native-sites-trial-v1.json'));
    const previous = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-accelerated-test-day-v1.json'));
    expect(candidate.clock).toEqual(previous.clock); expect(candidate.survival!).toEqual(previous.survival!);
    expect(candidate.avatars.map(a => [a.coinsGp, a.cookedReserve, a.personalSkills])).toEqual(previous.avatars.map(a => [a.coinsGp, a.cookedReserve, a.personalSkills]));
    expect(candidate.protocol).toEqual(previous.protocol);
    const original = readFileSync(join(root, 'config/native-kitchen.json'), 'utf8');
    withIntegrationSites(root, candidate, effective => {
        const kitchen = JSON.parse(readFileSync(join(effective, 'config/native-kitchen.json'), 'utf8'));
        expect(kitchen.heat).toEqual({ debugName: 'loc_2728', x: 2814, z: 3161, level: 0 });
        expect(JSON.parse(readFileSync(join(effective, 'config/native-housing.json'), 'utf8')).beds.map((b: any) => b.level)).toEqual([0, 0]);
        expect(() => stageIntegrationSites(effective, candidate)).toThrow('fresh unpublished');
        writeFileSync(join(effective, 'config/native-kitchen.json'), original);
        expect(() => withIntegrationSites(effective, candidate, () => undefined)).toThrow('configuration changed');
    });
    expect(readFileSync(join(root, 'config/native-kitchen.json'), 'utf8')).toBe(original);
    expect(inspectIntegrationReferences(root, candidate).kitchenDigest).not.toBe(inspectIntegrationReferences(root, previous).kitchenDigest);
    expect(() => validateIntegrationFixture({ ...candidate, version: '1.1.0', digest: fixtureDefinitionDigest({ ...candidate, version: '1.1.0' }) })).toThrow('new versioned fixture');
});
test('separate four-avatar food fixture has finite money/material, avatarless Business and deterministic genesis', () => {
    expect(fixture.avatars).toHaveLength(4); expect(inspectIntegrationReferences(root, fixture).finiteHarvest.sources[0].quantity).toBe(32);
    const result = integrationGenesis(root, fixture); expect(integrationGenesis(root, fixture)).toEqual(result);
    expect(result.profile.profileId).toBe('mature-society'); expect(integrationWorldId(fixture)).toMatch(/^srv-[a-f0-9-]{36}$/);
    expect((result.output as any).populationMembers).toHaveLength(4);
    expect(readFileSync(join(root, 'config/fixtures/varrock-proto-v1.json'), 'utf8')).not.toContain('society-lobster-four');
});
for (const [name, edit] of [
    ['duplicate avatars', (f: typeof fixture) => { f.avatars[1]!.username = f.avatars[0]!.username; }],
    ['accelerated clock', (f: typeof fixture) => { f.clock.profile.rate.simulationMilliseconds = 60; }],
    ['infinite imports', (f: typeof fixture) => { (f.protocol as any).externalImports = 'unlimited'; }],
    ['regeneration', (f: typeof fixture) => { (f.protocol as any).regeneration = 'automatic'; }],
    ['unaffordable procurement/wages', (f: typeof fixture) => { f.kitchen.treasuryGp = 1; }],
    ['invented bed slots', (f: typeof fixture) => { f.housing.maximumConcurrentTenants = 4; }],
    ['unskilled cook', (f: typeof fixture) => { f.avatars.find(a => a.agentId === f.kitchen.cookAgentId)!.personalSkills.Cooking = 1; }],
    ['missing native tool', (f: typeof fixture) => { f.avatars[0]!.tools = []; }],
    ['bootstrap substituted for internal supply', (f: typeof fixture) => { f.kitchen.cookedOpening = 100; }]
] as const) test(`fixture rejects ${name}`, () => { expect(() => validateIntegrationFixture(changed(edit))).toThrow(); });

test('fixture 1.0.1 admits first procurement from empty stock; older captured fixture definitions retain validation', () => {
    expect(fixture.version).toBe('1.0.1'); expect(fixture.kitchen.rawOpening).toBe(0);
    expect(() => validateIntegrationFixture(changed(f => { f.kitchen.rawOpening = 1; }))).toThrow('empty raw stock');
    expect(validateIntegrationFixture(changed(f => { f.version = '1.0.0'; f.kitchen.rawOpening = 2; })).version).toBe('1.0.0');
});

test('regression bundle format requires every exact case and cannot be relabelled as live acceptance', () => {
    // Artifact-format-only fixture. These summaries are not native economic evidence.
    const cases = INTEGRATION_ACCEPTANCE_CASES.map(caseId => ({ caseId, fixtureDigest: fixture.digest, worldId: integrationWorldId(fixture),
        nativeCheckpointDigest: 'c'.repeat(64), evidenceFilesDigest: 'd'.repeat(64), boundaries: ['publication', 'arrival', 'transport', 'clock'], correlations: [],
        actors: fixture.avatars.map(a => ({ actorId: a.agentId, gp: a.coinsGp })), processKilled: caseId.startsWith('crash-') }));
    const input = { fixtureDigest: fixture.digest, worldId: integrationWorldId(fixture), sourceDigest: 'a'.repeat(64), baselineSeal: 'b'.repeat(64), cases };
    const bundle = buildIntegrationRegressionBundle(input); expect(verifyIntegrationRegressionBundle(bundle)).toBeTrue();
    expect(bundle.eligibleForLiveAcceptance).toBeFalse();
    expect(() => buildIntegrationRegressionBundle({ ...input, cases: cases.slice(1) })).toThrow('every exact case');
    expect(() => buildIntegrationRegressionBundle({ ...input, cases: cases.map((c, i) => i === 1 ? cases[0]! : c) })).toThrow('every exact case');
    expect(() => verifyIntegrationRegressionBundle({ ...bundle, eligibleForLiveAcceptance: true } as any)).toThrow();
});

test('delayed source delivery preserves event time while binding at the observed clock head without rewinding it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'si-a14-clock-')), clock = new SimulationClockStore(join(directory, 'clock.sqlite'));
    let inbox: ReplanInboxStore | undefined;
    try {
        const wall = '2026-10-19T10:00:00.000Z', later = '2026-10-19T10:00:01.000Z';
        clock.create({ clockId: 'world', profile: fixture.clock.profile, wallTime: wall, simulationTime: fixture.clock.initialSimulationTime });
        clock.observe('world', later);
        inbox = new ReplanInboxStore(join(directory, 'inbox.sqlite'), { store: clock, clockId: 'world' });
        const event = { eventId: 'afaa1400-0000-4000-8000-000000000005', agentId: 'sifisher', type: 'skill-finished' as const,
            sourceKey: 'si-a14:delayed-source', occurredAt: wall, summary: 'Canonical terminal source arrived after restart.' };
        const delivered = inbox.enqueue(event, wall); expect(delivered.created).toBeTrue();
        expect(delivered.record.event.occurredAt).toBe(wall); expect(delivered.record.simulationStamp?.wallTime).toBe(later);
        inbox.close(); inbox = new ReplanInboxStore(join(directory, 'inbox.sqlite'), { store: clock, clockId: 'world' });
        expect(inbox.get(event.eventId)?.simulationStamp).toEqual(delivered.record.simulationStamp);
        expect(inbox.enqueue(event, wall).created).toBeFalse(); expect(clock.get('world')!.lastObservedWallTime).toBe(later);
        expect(() => clock.observe('world', wall)).toThrow('regression');
    } finally { inbox?.close(); clock.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('actual preflight keeps draft food procedures blocked without publishing or creating stores', async () => {
    const report = await preflightIntegrationDefinition(root, fixture);
    expect(report.definitionReady).toBeTrue(); expect(report.executableSkillsReady).toBeFalse();
    expect(report.verifiedSkills.map(s => s.id)).toEqual(['trade.lumbridge.give-item']);
    expect(report.errors).toHaveLength(3); expect(report.routeStatus).toContain('no transport');
});
test('production CLI read-only preflight reports actual publication blockers and create refuses them before any state is written', () => {
    const directory = mkdtempSync(join(tmpdir(), 'si-a13-cli-'));
    try {
        cpSync(join(root, 'config'), join(directory, 'config'), { recursive: true });
        cpSync(join(root, 'agent-skills/catalog'), join(directory, 'agent-skills/catalog'), { recursive: true });
        const cli = join(root, 'scripts/society-integration-fixture.ts');
        const result = Bun.spawnSync([process.execPath, cli, 'preflight', '--root', directory], { stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(2);
        const report = JSON.parse(result.stdout.toString());
        expect(report.errors).toHaveLength(3); expect(report.baseline).toBeNull();
        const create = Bun.spawnSync([process.execPath, cli, 'create', '--root', directory, '--output', join(directory, 'output'), '--offline'], { stdout: 'pipe', stderr: 'pipe' });
        expect(create.exitCode).not.toBe(0); expect(create.stderr.toString()).toContain('Verified skills are not ready');
        expect(existsSync(join(directory, '.local'))).toBeFalse(); expect(existsSync(join(directory, 'output'))).toBeFalse();
    } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
test('wrong verified checksum/body or a draft returned by a resolver cannot authorize apply', async () => {
    const report = await preflightIntegrationDefinition(root, fixture, async (id, version) => {
        const body = JSON.parse(readFileSync(join(root, `agent-skills/catalog/${id}@${version}.skill.json`), 'utf8'));
        if (id.includes('gather')) body.limits.maxOperations = 2;
        return new SkillRegistry().register(body, { trusted: true });
    });
    expect(report.executableSkillsReady).toBeFalse(); expect(report.errors.length).toBeGreaterThan(0);
});
test('arbitrary existing workspace cannot be adopted as a fresh integration stage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'si-a13-guard-'));
    try { await expect(bootstrapIntegrationStage(directory, fixture, {} as any)).rejects.toThrow('isolated staging'); expect(existsSync(join(directory, '.local'))).toBeFalse(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
});
test('offline failure occurs before output and a failed staged apply never changes source or publishes partial state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'si-a13-rollback-'));
    try {
        const source = join(directory, 'source'); mkdirSync(source); mkdirSync(join(source, 'server/engine/data/pack'), { recursive: true });
        writeFileSync(join(source, 'package.json'), '{"name":"technical-stage-test"}\n'); writeFileSync(join(source, 'server/engine/data/pack/input.dat'), 'native-boundary-test');
        const git = (args: string[]) => { const result = Bun.spawnSync(['git', '-C', source, ...args]); expect(result.exitCode).toBe(0); };
        git(['init', '-q']); git(['add', 'package.json']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@local.invalid', 'commit', '-qm', 'Technical staging boundary']);
        const output = join(directory, 'output');
        await expect(createIntegrationWorkspace({ sourceRoot: source, output, fixture, assertOffline: () => { throw new Error('active writer'); } })).rejects.toThrow('active writer');
        expect(existsSync(output)).toBeFalse();
        let copyFailed = false;
        await expect(createIntegrationWorkspace({ sourceRoot: source, output, fixture, assertOffline: () => {},
            progress: (phase, completed) => {
                if (phase === 'copy' && completed === 0) {
                    const stage = readdirSync(directory).find(name => name.startsWith('.society-stage-'))!;
                    mkdirSync(join(directory, stage, 'package.json')); copyFailed = true;
                }
            }, bootstrapNative: async () => { throw new Error('Bootstrap must not run after a copy failure'); }
        })).rejects.toThrow();
        expect(copyFailed).toBeTrue(); expect(existsSync(output)).toBeFalse();
        expect(readdirSync(directory).filter(name => name.startsWith('.society-stage-'))).toEqual([]);
        await expect(createIntegrationWorkspace({ sourceRoot: source, output, fixture, assertOffline: () => {}, bootstrapNative: async stage => {
            writeFileSync(join(stage, 'partial-native-state'), 'unpublished'); throw new Error('injected native bootstrap boundary failure');
        } })).rejects.toThrow('boundary failure');
        expect(existsSync(output)).toBeFalse(); expect(readFileSync(join(source, 'package.json'), 'utf8')).toContain('technical-stage-test');
        expect(existsSync(join(source, 'partial-native-state'))).toBeFalse();
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
