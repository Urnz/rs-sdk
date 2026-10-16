import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadPopulationEntryEnvironment } from '../../server/gateway/admin/population-entry.js';
import { readPopulationDemographics } from '../../server/gateway/admin/population-demographics.js';
import { createPopulationDeathEvidence } from '../../population-lifecycle/death.js';
import { loadPopulationMortalityPolicy } from '../../population-lifecycle/mortality.js';
import { PopulationEstateStore } from '../../population-estate/store.js';
import { loadEstatePolicy } from '../../population-estate/policy.js';
import { installEstateSourceSchema } from '../../population-estate/schema.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { PropertyStore } from '../../server/engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import type { EstateRuntimeOptions } from '../../population-estate/runtime.js';
import { handleAdminRequest, type AdminRouteContext } from '../../server/gateway/admin/routes.js';

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const configDirectory = join(import.meta.dir, '../../config'), wall = '2026-10-14T10:00:00.000Z', initial = '2001-01-01T00:00:00.000Z';
const from = '2000-12-31T23:59:59.999Z';
function raw<T>(path: string, action: (db: Database) => T): T {
    const db = new Database(path); try { return action(db); } finally { db.close(true); }
}
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'demographic-read-')); roots.push(root);
    const sources = Object.fromEntries(['agents', 'business', 'contracts', 'treasury', 'banking', 'property', 'governance', 'escrow']
        .map(domain => [domain, join(root, `${domain}.sqlite`)])) as EstateRuntimeOptions['sources'];
    const clock = new SimulationClockStore(join(root, 'clock.sqlite')); closers.push(() => clock.close());
    const state = clock.create({ clockId: 'world', status: 'paused', profile: { schemaVersion: 1, profileId: 'metrics-test', version: '1.0.0',
        seed: 'metrics', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: wall, simulationTime: initial });
    const shared = { store: clock, clockId: 'world' }, environment = loadPopulationEntryEnvironment(configDirectory);
    const agents = new AgentStateStore(sources.agents, shared); closers.push(() => agents.close());
    agents.createIdentity({ agentId: 'founder', playerUsername: 'founder', displayName: 'Founder', background: 'Metrics fixture.', personalityTraits: ['careful'] }, wall);
    agents.setCharacterBirth('founder', 1, '1975-01-01T00:00:00.000Z', 'imported', wall);
    const profile = environment.profiles.profiles.find(item => item.profileId === 'mature-society')!;
    agents.bindPopulationMember({ agentId: 'founder', playerUsername: 'founder', worldProfile: { profileId: profile.profileId, version: profile.version, digest: profile.digest },
        lifecyclePolicy: { ...environment.policy.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: 'world', profileDigest: state.profileDigest },
        joinedAtSimulationTime: initial, sourceResultId: 'genesis-' + 'a'.repeat(24), sourceResultDigest: 'b'.repeat(64) }, wall);
    agents.setSkillKnowledge('founder', { id: 'procedure.gather-loc-until-full', version: '1.0.0' }, 'known', null, wall);
    const estate: EstateRuntimeOptions = { statePath: join(root, 'estates.sqlite'), engineDeathPath: join(root, 'engine.sqlite'), sources,
        policy: loadEstatePolicy(join(configDirectory, 'population-estate-policy.json')) };
    const coordinator = new PopulationEstateStore(estate.statePath); coordinator.close();
    const properties = new PropertyStore(loadPropertyCatalog(join(configDirectory, 'properties.json')), sources.property, wall); properties.close();
    raw(sources.property, db => installEstateSourceSchema(db));
    const engine = new PlayerHealthEvidenceStore(estate.engineDeathPath); closers.push(() => engine.close()); engine.heartbeat(wall);
    const options = { agentPath: sources.agents, enginePath: estate.engineDeathPath, configDirectory, estate, simulationClock: shared };
    const read = (now = wall) => readPopulationDemographics(options, from, now);
    const die = (consume = true) => {
        const mortality = loadPopulationMortalityPolicy(join(configDirectory, 'population-mortality-policy.json'));
        const proof = createPopulationDeathEvidence(agents.getPopulationMember('founder')!, clock.observe('world', wall, 42), environment.age, mortality,
            { damageEventId: '10000000-0000-4000-8000-000000000001', sessionId: 'metrics', engineTick: 42 });
        engine.record({ username: 'founder', sessionId: 'metrics', engineTick: 42, occurredAt: wall, hpBefore: 10, hpAfter: 0, maxHp: 10, damageType: 1 },
            '10000000-0000-4000-8000-000000000001', proof);
        if (consume) { const reader = new PlayerHealthEvidenceStore(estate.engineDeathPath, true);
            try { agents.consumePopulationDeath(reader, proof.eventId, environment.age, mortality); } finally { reader.close(); } }
    };
    return { root, agents, engine, clock, options, environment, read, die };
}

describe('read-only demographic source integration', () => {
    test('uses actual finite membership, immutable entry receipts, age policy and engine/estate sources without advancing or mutating them', () => {
        const local = fixture(), request = { batchId: 'cohort', seed: 'metrics-arrivals', count: 2, anchorAgentId: 'founder' };
        const plan = local.agents.previewPopulationEntry(request, local.environment);
        local.agents.applyPopulationEntry(request, local.environment, plan.digest, 'Metrics fixture cohort.', () => {}, wall);
        const before = local.clock.get('world'), report = local.read();
        expect(report.status).toBe('complete'); expect(report.sections.population.value).toMatchObject({ recordedMembers: 3, activeLivingMembers: 3 });
        expect(report.sections.birthsAndEntries.value).toMatchObject({ admissions: 3, genesisAdmissions: 1, seededArrivals: 2, birthsInPopulation: 0 });
        expect(report.sections.inheritance.value).toMatchObject({ appliedPropertyTransfers: 0, valueGp: null });
        expect(local.clock.get('world')).toEqual(before); expect(local.agents.listIdentities()).toHaveLength(3);
        expect(local.read()).toEqual(report);
        raw(local.options.estate.statePath, db => { const query = db.prepare('SELECT COUNT(*) AS count FROM estate_case');
            try { expect(query.get()).toEqual({ count: 0 }); } finally { query.finalize(); } });
    });
    test('engine-only deaths affect aggregates without projecting death, creating archives or opening an estate', () => {
        const local = fixture(); local.die(false); const report = local.read();
        expect(report.sections.population.value).toMatchObject({ activeLivingMembers: 0, pendingDeathProjections: 1 });
        expect(report.sections.deaths.value?.total).toBe(1); expect(report.sections.specialistLosses.status).toBe('partial');
        expect(local.agents.getCharacterLifecycle('founder')!.status).toBe('active'); expect(local.agents.getPopulationMemoryArchive('founder')).toBeNull();
    });
    test('death-admission archives provide verified specialist losses after reopen', () => {
        const local = fixture(); local.die(); const report = local.read();
        expect(report.sections.specialistLosses.value).toMatchObject({ confirmedProfiles: 1, distinctSpecialistsLost: 1, missingProfiles: 0 });
        expect(report.sections.workforce.value?.eligibleDeathLosses).toBe(1);
    });
    test('stale or missing engine authority is unavailable, rather than zero', () => {
        const local = fixture(); expect(local.read('2026-10-14T10:01:00.000Z').sections.deaths.value).toBeNull();
        const report = readPopulationDemographics({ ...local.options, enginePath: join(local.root, 'missing-engine.sqlite'),
            estate: { ...local.options.estate, engineDeathPath: join(local.root, 'missing-engine.sqlite') } }, from, wall);
        expect(report.sections.population.value).toBeNull(); expect(report.sections.birthsAndEntries.status).toBe('verified');
        expect(existsSync(join(local.root, 'missing-engine.sqlite'))).toBe(false);
    });
    test('missing estate or property does not hide available population metrics or fabricate zero inheritance', () => {
        const local = fixture();
        const report = readPopulationDemographics({ ...local.options, estate: { ...local.options.estate, statePath: join(local.root, 'missing-estate.sqlite') } }, from, wall);
        expect(report.sections.ageStructure.status).toBe('verified'); expect(report.sections.inheritance.value).toBeNull();
        expect(existsSync(join(local.root, 'missing-estate.sqlite'))).toBe(false);
        const property = readPopulationDemographics({ ...local.options, estate: { ...local.options.estate,
            sources: { ...local.options.estate.sources, property: join(local.root, 'missing-property.sqlite') } } }, from, wall);
        expect(property.sections.inheritance.status).toBe('unavailable');
    });
    test('read-only stores reject writes, never migrate old schemas and never create missing parent directories', () => {
        const local = fixture(), reader = new AgentStateStore(local.options.agentPath, undefined, true);
        try { expect(() => reader.createIdentity({ agentId: 'forbidden', playerUsername: 'forbidden', displayName: 'Forbidden', background: 'No writes.', personalityTraits: ['careful'] }, wall)).toThrow(); }
        finally { reader.close(); }
        raw(local.options.agentPath, db => db.run('PRAGMA user_version=24'));
        expect(() => new AgentStateStore(local.options.agentPath, undefined, true)).toThrow('migration');
        raw(local.options.agentPath, db => { const query = db.prepare('PRAGMA user_version'); try { expect(query.get()).toEqual({ user_version: 24 }); } finally { query.finalize(); } });
        expect(() => new AgentStateStore(join(local.root, 'absent', 'agents.sqlite'), undefined, true)).toThrow(); expect(existsSync(join(local.root, 'absent'))).toBe(false);
    });
    test('conflicting source paths and invalid windows are refused', () => {
        const local = fixture(); expect(() => readPopulationDemographics({ ...local.options, agentPath: join(local.root, 'other.sqlite') }, from, wall)).toThrow('authority');
        expect(() => readPopulationDemographics(local.options, '2002-01-01T00:00:00.000Z', wall)).toThrow('window');
    });
    test('advancing simulation time during a read returns unavailable sections, preserving a consistent observation boundary', () => {
        const local = fixture(), original = local.clock.get.bind(local.clock); let reads = 0;
        local.clock.get = (id: string) => { const value = original(id); if (++reads === 2 && value) return { ...value, lastSimulationTime: '2001-01-01T00:00:01.000Z' }; return value; };
        try { const report = local.read(); expect(report.status).toBe('unavailable'); expect(report.sections.birthsAndEntries.value).toBeNull();
            expect(report.sources.agents.issue).toContain('changed'); } finally { local.clock.get = original; }
    });
    test('the GET endpoint requires admin authorization and exposes aggregate JSON through the actual gateway context', async () => {
        const local = fixture(); local.engine.heartbeat(new Date().toISOString());
        const context: AdminRouteContext = { gatewayBots: () => new Map(), supervisor: {} as AdminRouteContext['supervisor'],
            agentStatePath: local.options.agentPath, simulationClock: local.options.simulationClock, populationDemographicOptions: local.options };
        const url = new URL(`http://localhost:7780/api/admin/population-demographics?fromSimulationTime=${encodeURIComponent(from)}`);
        expect((await handleAdminRequest(new Request(url), url, context))?.status).toBe(401);
        const response = await handleAdminRequest(new Request(url, { headers: { 'X-Admin-Request': 'rs-sdk-admin', Origin: url.origin } }), url, context);
        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({ ok: true, report: { status: 'complete', sections: { population: { value: { recordedMembers: 1 } } } } });
    });
    test('the GET endpoint returns 503 with unavailable sections when population authority is absent', async () => {
        const local = fixture(), absent = join(local.root, 'missing-agents.sqlite'); local.engine.heartbeat(new Date().toISOString());
        const options = { ...local.options, agentPath: absent, estate: { ...local.options.estate, sources: { ...local.options.estate.sources, agents: absent } } };
        const context: AdminRouteContext = { gatewayBots: () => new Map(), supervisor: {} as AdminRouteContext['supervisor'],
            agentStatePath: absent, simulationClock: local.options.simulationClock, populationDemographicOptions: options };
        const url = new URL(`http://localhost:7780/api/admin/population-demographics?fromSimulationTime=${encodeURIComponent(from)}`);
        const response = await handleAdminRequest(new Request(url, { headers: { 'X-Admin-Request': 'rs-sdk-admin', Origin: url.origin } }), url, context);
        expect(response?.status).toBe(503); expect(await response?.json()).toMatchObject({ ok: false, report: { status: 'unavailable' } });
        expect(existsSync(absent)).toBe(false);
    });
});
