import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadPopulationAgePolicy, validatePopulationAgePolicy } from '../age.js';
import { loadPopulationMortalityPolicy, validatePopulationMortalityPolicy } from '../mortality.js';
import { createPopulationDeathEvidence } from '../death.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { admitNaturalPopulationDeaths } from '../../server/engine/src/mods/PopulationDeathRuntime.js';
import { applyHealthAuditedDamage } from '../../server/engine/src/mods/PlayerHealthDamage.js';
import { assertLocalAvatarCanAct, reconcilePopulationDeaths } from '../../server/gateway/admin/population-death-runtime.js';
import { listAdminAgents } from '../../server/gateway/admin/agent-state.js';

const config = join(import.meta.dir, '../../config');
const { digest: _ageDigest, ...ageDefinition } = loadPopulationAgePolicy(join(config, 'population-age-policy.json'));
const age = validatePopulationAgePolicy({ ...ageDefinition, simulationMillisecondsPerYear: 1000 });
const { digest: _mortalityDigest, ...mortalityDefinition } = loadPopulationMortalityPolicy(join(config, 'population-mortality-policy.json'));
const mortality = validatePopulationMortalityPolicy({ ...mortalityDefinition,
    agePolicy: { policyId: age.policyId, version: age.version, digest: age.digest } });
const initial = '2001-01-01T00:00:00.000Z', wall = '2026-10-13T10:00:00.000Z';
const damageId = '10000000-0000-4000-8000-000000000001';
const closers: Array<() => void> = [], directories: string[] = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(birth = true) {
    const directory = mkdtempSync(join(tmpdir(), 'population-death-')); directories.push(directory);
    const statePath = join(directory, 'agents.sqlite'), sourcePath = join(directory, 'source.sqlite');
    const clock = new SimulationClockStore(join(directory, 'clock.sqlite')); closers.push(() => clock.close());
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'death-test', version: '1.0.0',
        seed: 'death-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: wall, simulationTime: initial });
    const agents = new AgentStateStore(statePath, { store: clock, clockId: 'world' }); closers.push(() => agents.close());
    agents.createIdentity({ agentId: 'alice', playerUsername: 'Alice', displayName: 'Alice', background: 'Death test', personalityTraits: ['steady'] }, wall);
    if (birth) agents.setCharacterBirth('alice', 1, initial, 'born', wall);
    agents.bindPopulationMember({ agentId: 'alice', playerUsername: 'alice', worldProfile: { profileId: 'mature-society',
        version: '1.0.0', digest: 'a'.repeat(64) }, lifecyclePolicy: { ...age.lifecyclePolicy, kind: 'finite' },
        simulationClock: { clockId: 'world', profileDigest: state.profileDigest }, joinedAtSimulationTime: initial,
        sourceResultId: 'genesis-' + 'b'.repeat(24), sourceResultDigest: 'c'.repeat(64) }, wall);
    const source = new PlayerHealthEvidenceStore(sourcePath); closers.push(() => source.close());
    const observe = (elapsed = 0) => clock.observe('world', new Date(Math.max(Date.parse(wall) + elapsed,
        Date.parse(clock.get('world')!.lastObservedWallTime))).toISOString(), 42);
    const death = () => createPopulationDeathEvidence(agents.getPopulationMember('alice')!, observe(), age, mortality,
        { damageEventId: damageId, sessionId: 'session-1', engineTick: 42 });
    const damage = { username: 'alice', sessionId: 'session-1', engineTick: 42, occurredAt: wall,
        hpBefore: 10, hpAfter: 0, maxHp: 10, damageType: 1 };
    const reader = () => { const value = new PlayerHealthEvidenceStore(sourcePath, true); closers.push(() => value.close()); return value; };
    return { agents, source, clock, statePath, sourcePath, observe, death, damage, reader };
}

describe('authoritative terminal population death', () => {
    test('a proposal alone does not kill; the engine consumes the exact due natural candidate once, including offline members', () => {
        const local = fixture();
        expect(admitNaturalPopulationDeaths(local.agents, local.observe(), local.source, age, mortality)).toBe(0);
        expect(() => createPopulationDeathEvidence(local.agents.getPopulationMember('alice')!, local.observe(), age, mortality)).toThrow('not due');
        const lifespan = local.agents.getPopulationMortality('alice', age, mortality)!.traits.naturalLifespanSimulationMilliseconds;
        const observation = local.observe(lifespan + 10000);
        expect(admitNaturalPopulationDeaths(local.agents, observation, local.source, age, mortality)).toBe(1);
        expect(admitNaturalPopulationDeaths(local.agents, observation, local.source, age, mortality)).toBe(0);
        expect(local.agents.getCharacterLifecycle('alice')!.status).toBe('active');
        expect(reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality)).toBe(1);
        const event = local.agents.getPopulationDeath('alice')!;
        expect(event.cause.kind).toBe('natural-mortality');
        expect(event.atSimulationTime).toBe(new Date(Date.parse(initial) + lifespan).toISOString());
        expect(local.agents.getCharacterLifecycle('alice')).toMatchObject({ status: 'deceased', currentAgeSimulationMilliseconds: lifespan });
        expect(reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality)).toBe(0);
    });
    test('unknown birth does not invent natural death; verified lethal damage can still close the avatar', () => {
        const local = fixture(false);
        expect(admitNaturalPopulationDeaths(local.agents, local.observe(500000), local.source, age, mortality)).toBe(0);
        const observation = local.clock.observe('world', new Date(Date.parse(wall) + 500000).toISOString(), 42);
        const event = createPopulationDeathEvidence(local.agents.getPopulationMember('alice')!, observation, age, mortality,
            { damageEventId: damageId, sessionId: 'session-1', engineTick: 42 });
        local.source.record({ ...local.damage, occurredAt: observation.wallTime }, damageId, event);
        reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality);
        expect(local.agents.getCharacterLifecycle('alice')).toMatchObject({ status: 'deceased', birthAtSimulationTime: null });
    });
    test('lethal evidence and closure are atomic; nonzero HP and mismatched session cannot produce death', () => {
        const local = fixture(), death = local.death();
        expect(() => local.source.record({ ...local.damage, hpAfter: 1 }, damageId, death)).toThrow('lethal HP');
        expect(() => local.source.record({ ...local.damage, sessionId: 'forged' }, damageId, death)).toThrow('lethal HP');
        expect(local.source.list()).toEqual([]); expect(local.source.listDeaths()).toEqual([]);
        local.source.record(local.damage, damageId, death);
        expect(local.source.deathFor('Alice')!.eventId).toBe(death.eventId);
        expect(() => local.source.record({ ...local.damage, hpAfter: 5 })).toThrow('Terminal avatar');
    });
    test('engine commit failure restores HP/hitmarks and leaves neither injury nor closure', () => {
        const local = fixture(), death = local.death();
        const database = new Database(local.sourcePath);
        database.run("CREATE TRIGGER fail_death BEFORE INSERT ON engine_population_death BEGIN SELECT RAISE(ABORT,'simulated death write failure'); END");
        const player = { levels: new Uint8Array([10]), masks: 0, hitmarkSlot: 0, hitmarkDamage: 0, hitmarkType: 0, hitmark2Damage: 0, hitmark2Type: 0 };
        expect(() => applyHealthAuditedDamage(player, 0, 10, () => { player.levels[0] = 0; player.masks = 1; },
            () => local.source.record(local.damage, damageId, death))).toThrow('simulated death write failure');
        database.close(true); expect(player.levels[0]).toBe(10); expect(player.masks).toBe(0);
        expect(local.source.list()).toEqual([]); expect(local.source.listDeaths()).toEqual([]);
    });
    test('exact replay preserves one event and freezes age after restart; autonomy is paused without settling debts', () => {
        const local = fixture(), event = local.death();
        local.agents.createAutonomyEnrollment('alice', { status: 'desired', policyId: 'local-test', policyVersion: '1.0.0' }, wall);
        local.source.record(local.damage, damageId, event);
        const reader = local.reader(); local.agents.consumePopulationDeath(reader, event.eventId, age, mortality);
        const revision = local.agents.getCharacterLifecycle('alice')!.revision;
        local.agents.consumePopulationDeath(reader, event.eventId, age, mortality);
        expect(local.agents.getCharacterLifecycle('alice')!.revision).toBe(revision);
        expect(local.agents.getAutonomyEnrollment('alice')!.status).toBe('paused');
        expect(() => local.agents.resumeAutonomyEnrollment('alice', 2)).toThrow('closed');
        local.observe(100000);
        const reopened = new AgentStateStore(local.statePath, { store: local.clock, clockId: 'world' }); closers.push(() => reopened.close());
        expect(reopened.getPopulationDeath('alice')!.eventId).toBe(event.eventId);
        expect(reopened.getCharacterLifecycle('alice')!.currentAgeSimulationMilliseconds).toBe(0);
        expect(() => reopened.assertCharacterCanAct('alice')).toThrow('closed');
        expect(local.source.record(local.damage, damageId, event).eventId).toBe(damageId);
    });
    test('a forged id or writer object cannot mark a death in AgentState', () => {
        const local = fixture();
        expect(() => local.agents.consumePopulationDeath(local.source, local.death().eventId, age, mortality)).toThrow('read-only');
        expect(() => local.agents.consumePopulationDeath(local.reader(), local.death().eventId, age, mortality)).toThrow('missing');
        expect(local.agents.getPopulationDeath('alice')).toBeNull(); expect(local.agents.getCharacterLifecycle('alice')!.status).toBe('active');
    });
    test('admin projects the real engine death and exposes closed lifecycle to trusted decisions', async () => {
        const local = fixture(), event = local.death(); local.source.record(local.damage, damageId, event);
        const result = await listAdminAgents(local.statePath, { simulationClock: { store: local.clock, clockId: 'world' },
            populationAgePolicy: age, populationMortalityPolicy: mortality, populationDeathSourcePath: local.sourcePath,
            observedAt: wall, skillRuns: [] });
        expect(result.agents[0]!.characterLifecycle!.status).toBe('deceased');
        expect(result.agents[0]!.populationDeath!.eventId).toBe(event.eventId);
        expect(result.agents[0]!.decisionContext).toContain('character-lifecycle-closed');
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('terminal');
    });
    test('stale birth/lifecycle revisions fail closed while the engine latch continues to block actions', () => {
        const local = fixture(false), event = local.death(); local.source.record(local.damage, damageId, event);
        local.agents.setCharacterBirth('alice', 1, initial, 'born', wall);
        expect(() => reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality)).toThrow('membership changed');
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('terminal');
        expect(local.agents.getPopulationDeath('alice')).toBeNull();
    });
    test('AgentState event and lifecycle mutation roll back together when the lifecycle update fails', () => {
        const local = fixture(), event = local.death(); local.source.record(local.damage, damageId, event);
        const database = new Database(local.statePath);
        database.run("CREATE TRIGGER fail_lifecycle BEFORE UPDATE OF status ON agent_character_lifecycle BEGIN SELECT RAISE(ABORT,'simulated lifecycle failure'); END");
        expect(() => reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality)).toThrow('simulated lifecycle failure');
        database.close(true); expect(local.agents.getPopulationDeath('alice')).toBeNull();
        expect(local.agents.getCharacterLifecycle('alice')!.status).toBe('active');
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('terminal');
    });
    test('reset history cannot admit death; identity/control rebinding cannot bypass a finite lifecycle', () => {
        const local = fixture();
        expect(() => local.agents.updateIdentity('alice', 1, { playerUsername: 'bob' }, wall)).toThrow('cannot be rebound');
        const profile = local.agents.getControlProfile('alice')!;
        expect(() => local.agents.setControlProfile('alice', profile.revision, { ...profile, subjectId: 'bob', avatarPlayerUsername: 'bob' }, wall)).toThrow('cannot be changed');
        local.agents.resetPopulationMember('alice', 'c'.repeat(64), 1, wall);
        expect(admitNaturalPopulationDeaths(local.agents, local.observe(500000), local.source, age, mortality)).toBe(0);
        expect(() => local.death()).toThrow('Inactive');
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('closed');
    });
    test('finite execution requires a ready authority; compatibility avatars keep classic HP-zero behavior', () => {
        const local = fixture();
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('unavailable');
        local.source.heartbeat(wall); expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).not.toThrow();
        local.source.record({ ...local.damage, username: 'classic' });
        expect(local.source.deathFor('classic')).toBeNull();
        expect(() => assertLocalAvatarCanAct('classic', local.statePath, local.sourcePath, wall)).not.toThrow();
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, join(directories.at(-1)!, 'absent.sqlite'), wall)).toThrow('unavailable');
    });
    test('tampered death source is rejected before gateway actions or lifecycle projection', () => {
        const local = fixture(), event = local.death(); local.source.record(local.damage, damageId, event);
        const database = new Database(local.sourcePath);
        database.run("UPDATE engine_population_death SET username='bob'"); database.close(true);
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('audit');
        expect(() => reconcilePopulationDeaths(local.agents, local.sourcePath, age, mortality)).toThrow('audit');
    });
    test('removing the last lethal event cannot reopen a terminal avatar, even before AgentState reconciliation', () => {
        const local = fixture(), event = local.death(); local.source.record(local.damage, damageId, event);
        const database = new Database(local.sourcePath); database.run('DELETE FROM engine_population_death'); database.close(true);
        expect(() => assertLocalAvatarCanAct('alice', local.statePath, local.sourcePath, wall)).toThrow('truncated');
        expect(() => new PlayerHealthEvidenceStore(local.sourcePath, true)).toThrow('truncated');
    });
    test('an engine-known finite avatar never falls back to compatibility when its identity source disappears', () => {
        const local = fixture(); local.source.bindFiniteAvatar(local.agents.getPopulationMember('alice')!);
        local.source.heartbeat(wall);
        expect(() => assertLocalAvatarCanAct('alice', join(directories.at(-1)!, 'missing-agents.sqlite'), local.sourcePath, wall)).toThrow('identity source');
        expect(() => assertLocalAvatarCanAct('classic', join(directories.at(-1)!, 'missing-agents.sqlite'), local.sourcePath, wall)).not.toThrow();
        const member = local.agents.getPopulationMember('alice')!;
        expect(() => local.source.bindFiniteAvatar({ ...member, sourceResultDigest: 'd'.repeat(64) })).toThrow('conflicts');
    });
    test('v22 AgentState and v1 engine upgrade add empty death history and preserve existing state/evidence', () => {
        const local = fixture(); local.source.record({ ...local.damage, hpAfter: 5 }, damageId);
        const database = new Database(local.statePath);
        // Recreate the actual v22 shape, including absence of the later memory-archive schema.
        for(const row of database.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_%'").all() as Array<{name:string}>) database.run(`DROP TRIGGER ${row.name}`);
        for(const table of ['agent_memory_transfer','agent_population_memory_archive','agent_memory_audit','agent_memory_audit_tail'])database.run(`DROP TABLE ${table}`);
        database.run('DROP TABLE agent_population_entry');
        database.run('DROP TABLE agent_population_death'); database.run('PRAGMA user_version=22'); database.close(true);
        const upgraded = new AgentStateStore(local.statePath, { store: local.clock, clockId: 'world' }); closers.push(() => upgraded.close());
        expect(upgraded.getPopulationDeath('alice')).toBeNull(); expect(upgraded.getCharacterLifecycle('alice')!.status).toBe('active');
        const sourceDatabase = new Database(local.sourcePath); sourceDatabase.run('DROP TABLE engine_population_death'); sourceDatabase.run('PRAGMA user_version=1'); sourceDatabase.close(true);
        const oldReader = new PlayerHealthEvidenceStore(local.sourcePath, true); expect(oldReader.listDeaths()).toEqual([]); oldReader.close();
        const newWriter = new PlayerHealthEvidenceStore(local.sourcePath); closers.push(() => newWriter.close());
        expect(newWriter.list()[0]!.eventId).toBe(damageId); expect(newWriter.listDeaths()).toEqual([]);
    });
});
