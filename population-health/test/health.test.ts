import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../agent-state/index.js';
import { SimulationClockStore } from '../../simulation-clock/index.js';
import { loadPopulationAgePolicy, validatePopulationAgePolicy } from '../../population-lifecycle/index.js';
import { SkillRegistry } from '../../agent-skills/registry.js';
import type { SkillRunResult } from '../../agent-skills/types.js';
import { validateFacilityCapabilityCatalog } from '../../facility-capability/catalog.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { listAdminAgents } from '../../server/gateway/admin/agent-state.js';
import { healthDigest, loadHealthPolicy, PopulationHealthStore, runPopulationHealthCycle, validateHealthPolicy,
    type HealthContext, type HealthTreatmentAuthority, type HealthTreatmentReceipt } from '../index.js';

const directories: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const config = join(import.meta.dir, '../../config');
const agePolicy = loadPopulationAgePolicy(join(config, 'population-age-policy.json'));
const policy = loadHealthPolicy(join(config, 'population-health-policy.json'));
const { digest: _policyDigest, ...policyDefinition } = policy;
const wall = '2026-10-13T10:00:00.000Z', initial = '2001-01-01T00:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(wall) + ms).toISOString();
const injuryId = 'engine-damage:10000000-0000-4000-8000-000000000001';

function harness(birth: string | null = '1981-01-06T00:00:00.000Z') {
    const directory = mkdtempSync(join(tmpdir(), 'population-health-')); directories.push(directory);
    const agentPath = join(directory, 'agents.sqlite'), healthPath = join(directory, 'health.sqlite'), enginePath = join(directory, 'engine.sqlite');
    const clock = new SimulationClockStore(join(directory, 'clock.sqlite'));
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'health-test', version: '1.0.0',
        seed: 'health-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: wall, simulationTime: initial });
    const agents = new AgentStateStore(agentPath, { store: clock, clockId: 'world' });
    agents.createIdentity({ agentId: 'alice', playerUsername: 'Alice', displayName: 'Alice', background: 'Health fixture.', personalityTraits: ['steady'] }, wall);
    agents.bindPopulationMember({ agentId: 'alice', playerUsername: 'alice', worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...agePolicy.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: 'world', profileDigest: state.profileDigest },
        joinedAtSimulationTime: initial, sourceResultId: 'genesis-0123456789abcdef01234567', sourceResultDigest: 'c'.repeat(64) }, wall);
    if (birth !== null) agents.setCharacterBirth('alice', 1, birth, 'imported', wall);
    let health = new PopulationHealthStore(healthPath);
    const engine = new PlayerHealthEvidenceStore(enginePath);
    closers.push(() => clock.close(), () => agents.close(), () => engine.close(), () => health.close());
    const context = (): HealthContext => {
        const state = clock.get('world')!;
        return { member: agents.getPopulationMember('alice')!, agePolicy, policy,
            clock: { clockId: 'world', profileDigest: state.profileDigest, simulationTime: state.lastSimulationTime,
                wallTime: state.lastObservedWallTime, status: state.status, revision: state.revision, engineTick: null },
            playerTime: clock.getPlayerTimeState('world', 'alice') };
    };
    const damage = (after = 8, id = '10000000-0000-4000-8000-000000000001') => engine.record({ username: 'alice', sessionId: 'session-1',
        engineTick: 42, occurredAt: wall, hpBefore: 10, hpAfter: after, maxHp: 10, damageType: 1 }, id);
    const sleep = (ms = 1, expires: string | null = null) => {
        clock.startPlayerSleep('world', 'alice', { sleeperKind: 'npc-agent', sleepPlaceId: 'bed-1', access: { kind: 'bed-entitlement',
            evidenceId: 'bed-grant-1', sourceDigest: 'd'.repeat(64), validUntilSimulationTime: expires } }, later(ms));
    };
    return { agentPath, healthPath, enginePath, agents, clock, engine, context, damage, sleep, get health() { return health; },
        restart() { health.close(); health = new PopulationHealthStore(healthPath); } };
}

function treatmentFixture(context: HealthContext): { context: HealthContext; authority: HealthTreatmentAuthority; receipt: HealthTreatmentReceipt } {
    const registry = new SkillRegistry();
    const skillDefinition = JSON.parse(readFileSync(join(config, '../agent-skills/catalog/procedure.gather-loc-until-full@1.0.0.skill.json'), 'utf8'));
    // A reviewed source fixture stands in for a clinical completion authority, never a shipped treatment.
    skillDefinition.id = 'test.clinic-treatment'; skillDefinition.tags = ['health'];
    const registered = registry.register(skillDefinition, { trusted: true });
    const activePolicy = validateHealthPolicy({ ...policyDefinition, treatments: [{ treatmentId: 'clinic-care',
        skill: { id: registered.definition.id, version: '1.0.0', checksum: registered.checksum },
        capabilityId: 'medicine.clinical-care', minimumHerbloreLevel: 3, reliefBurden: 1000 }] });
    const facts = { receiptId: 'receipt-1', treatmentId: 'clinic-care', patientAgentId: 'alice', injuryId,
        practitionerAgentId: 'doctor', practitionerUsername: 'doctor', runId: 'clinical-run-1',
        clockId: context.clock.clockId, clockProfileDigest: context.clock.profileDigest,
        healthPolicyDigest: activePolicy.digest, membershipSourceDigest: context.member.sourceResultDigest,
        completedAtSimulationTime: context.clock.simulationTime, facilityId: 'clinic', grantId: 'doctor-grant', herbloreLevel: 3 };
    const receipt = { ...facts, evidenceDigest: healthDigest(facts) };
    const run: SkillRunResult = { runId: facts.runId, username: 'doctor', skill: { id: registered.definition.id, version: '1.0.0' },
        status: 'completed', reason: 'verified treatment fixture', message: 'completed', operations: 1, durationMs: 1, events: [],
        parameters: { 'patient-agent-id': 'alice', 'injury-id': injuryId } };
    const authority: HealthTreatmentAuthority = { receipt: () => receipt, skill: (id, version) => registry.get({ id, version }), run: () => run,
        facilityCatalog: validateFacilityCapabilityCatalog({ schemaVersion: 1, facilities: [{ facilityId: 'clinic', label: 'Test clinic',
            propertyId: 'clinic-property', businessId: null, capabilities: [{ capabilityId: 'medicine.clinical-care', capacityUnits: 1 }],
            allowedAccessKinds: ['explicit'] }] }, new Set(['clinic-property'])),
        grants: [{ grantId: 'doctor-grant', kind: 'explicit', subjectAgentId: 'doctor', facilityId: 'clinic', capabilityId: 'medicine.clinical-care',
            validFrom: initial, validUntil: null, status: 'active', sourceEvidenceId: 'clinic-entitlement' }], verifyGrant: () => true };
    return { context: { ...context, policy: activePolicy }, authority, receipt };
}

describe('persistent finite population injuries and health recovery', () => {
    test('no baseline is invented; damage is idempotent, audited and survives restart', () => {
        const local = harness(); expect(local.health.get(local.context())).toBeNull();
        const evidence = local.damage(), first = local.health.ingestDamage(local.context(), evidence);
        expect(first).toMatchObject({ status: 'injured', injuryBurden: 2000, restRequired: true, treatmentRequired: false });
        expect(local.health.ingestDamage(local.context(), evidence)).toEqual(first);
        expect(local.health.events()).toHaveLength(1); local.restart(); expect(local.health.get(local.context())).toEqual(first);
        expect(() => local.health.ingestDamage(local.context(), { ...evidence, hpAfter: 7 })).toThrow('evidence');
    });
    test('awake time does not heal; fresh authorized sleep heals, preserving injury history', () => {
        const local = harness(); local.health.ingestDamage(local.context(), local.damage());
        local.clock.observe('world', later(3600000)); expect(local.health.advance(local.context())!.injuryBurden).toBe(2000);
        local.sleep(3600001); local.clock.observe('world', later(10800001));
        expect(local.health.advance(local.context())).toMatchObject({ status: 'well', injuryBurden: 0, restRequired: false });
        expect(local.health.events().some(event => event.kind === 'injury')).toBeTrue();
        local.restart(); expect(local.health.get(local.context())!.injuryBurden).toBe(0);
    });
    test('severe injury keeps its care floor and treatment need after long rest', () => {
        const local = harness(); local.health.ingestDamage(local.context(), local.damage(2)); local.sleep();
        local.clock.observe('world', later(36000001));
        expect(local.health.advance(local.context())).toMatchObject({ injuryBurden: 1000, treatmentRequired: true, restRequired: true });
    });
    test('later explicit birth registration grants no recovery before the known birth', () => {
        const local = harness(null); local.health.ingestDamage(local.context(), local.damage()); local.sleep();
        local.clock.observe('world', later(7200000));
        local.agents.setCharacterBirth('alice', 1, local.clock.get('world')!.lastSimulationTime, 'born', later(7200000));
        expect(local.health.advance(local.context())!.injuryBurden).toBe(2000);
        local.clock.observe('world', later(10800000));
        expect(local.health.advance(local.context())!.injuryBurden).toBe(800);
    });
    test('expired access, pre-injury sleep, unknown birth and missing rest do not manufacture recovery', () => {
        const local = harness(); local.sleep();
        local.clock.observe('world', later(2)); local.health.ingestDamage(local.context(), local.damage());
        local.clock.observe('world', later(36000002)); expect(local.health.advance(local.context())!.injuryBurden).toBe(2000);
        local.clock.recordPlayerRest('world', 'alice', 'awake', later(36000002));
        local.sleep(36000003, new Date(Date.parse(initial) + 36000003 + 1800000).toISOString());
        local.clock.observe('world', later(39600003)); expect(local.health.advance(local.context())!.injuryBurden).toBe(1500);
        const unknown = local.context(); unknown.member.characterLifecycle.birthAtSimulationTime = null;
        local.clock.observe('world', later(43200003)); unknown.clock.simulationTime = local.clock.get('world')!.lastSimulationTime;
        expect(local.health.advance(unknown)!.injuryBurden).toBe(1500);
    });
    test('partitioning/restart preserves fractional recovery and paused clocks do not heal', () => {
        const direct = harness(), incremental = harness();
        for (const local of [direct, incremental]) { local.health.ingestDamage(local.context(), local.damage()); local.sleep(); }
        for (const ms of [12346, 456790, 999991]) { incremental.clock.observe('world', later(ms)); incremental.health.advance(incremental.context()); incremental.restart(); }
        direct.clock.observe('world', later(999991));
        expect(direct.health.advance(direct.context())!.state.injuries).toEqual(incremental.health.get(incremental.context())!.state.injuries);
        expect(direct.health.get(direct.context())!.state.recoveryRemainder).toBe(incremental.health.get(incremental.context())!.state.recoveryRemainder);
        direct.clock.pause('world', direct.clock.get('world')!.revision, later(999991));
        const paused = direct.health.get(direct.context()); direct.clock.observe('world', later(99999999));
        expect(direct.health.advance(direct.context())).toEqual(paused);
    });
    test('regeneration integrates an age-stage crossing rather than applying the final age retroactively', () => {
        const birth = new Date(Date.parse(initial) - 50 * agePolicy.simulationMillisecondsPerYear + 1800000).toISOString();
        const direct = harness(birth), incremental = harness(birth);
        for (const local of [direct, incremental]) { local.health.ingestDamage(local.context(), local.damage()); local.sleep(); }
        incremental.clock.observe('world', later(1800000)); incremental.health.advance(incremental.context());
        incremental.clock.observe('world', later(3600000));
        direct.clock.observe('world', later(3600000));
        const final = direct.health.advance(direct.context())!;
        expect(final.injuryBurden).toBe(1076);
        expect(final.state.injuries).toEqual(incremental.health.advance(incremental.context())!.state.injuries);
    });
    test('splitting the same damage across smaller injuries does not multiply recovery capacity', () => {
        const single = harness(), split = harness();
        single.health.ingestDamage(single.context(), single.damage(6));
        split.health.ingestDamage(split.context(), split.damage(8));
        split.health.ingestDamage(split.context(), split.damage(8, '10000000-0000-4000-8000-000000000002'));
        for (const local of [single, split]) { local.sleep(); local.clock.observe('world', later(3600001)); local.health.advance(local.context()); }
        expect(single.health.get(single.context())!.injuryBurden).toBe(3000);
        expect(split.health.get(split.context())!.injuryBurden).toBe(3000);
    });
    test('reset retains health history without recovery or further injury admission', () => {
        const local = harness(), evidence = local.damage(); local.health.ingestDamage(local.context(), evidence); local.sleep();
        local.agents.resetPopulationMember('alice', 'c'.repeat(64), 1, later(1));
        local.clock.observe('world', later(36000001));
        expect(local.health.advance(local.context())).toMatchObject({ status: 'inactive', injuryBurden: 2000, restRequired: false });
        expect(() => local.health.ingestDamage(local.context(), evidence)).toThrow('active finite');
        local.restart(); expect(local.health.get(local.context())!.state.revision).toBe(1);
    });
    test('policy/clock conflicts and state tampering fail closed', () => {
        const local = harness(); local.health.ingestDamage(local.context(), local.damage());
        expect(() => local.health.get({ ...local.context(), policy: { ...policy, digest: '0'.repeat(64) } })).toThrow('stale');
        expect(() => local.health.get({ ...local.context(), clock: { ...local.context().clock, clockId: 'other' } })).toThrow('exact shared');
        const database = new Database(local.healthPath); database.run('UPDATE population_health_state SET state_digest=?1', ['0'.repeat(64)]); database.close(true);
        expect(() => local.health.get(local.context())).toThrow('snapshot audit');
    });
    test('verified clinical evidence clears care need once; forged/generic runs and stale revisions fail', () => {
        const local = harness(), treatment = treatmentFixture(local.context()), damage = local.damage(2);
        local.health.ingestDamage(treatment.context, damage);
        expect(() => local.health.treat(treatment.context, 'receipt-1', 2, treatment.authority)).toThrow('revision');
        expect(() => local.health.treat(treatment.context, 'receipt-1', 1, { ...treatment.authority, receipt: () => null })).toThrow('authoritative');
        expect(() => local.health.treat(treatment.context, 'receipt-1', 1, { ...treatment.authority, verifyGrant: () => false })).toThrow('entitlement');
        expect(() => local.health.treat(treatment.context, 'receipt-1', 1, { ...treatment.authority, run: () => ({ ...treatment.authority.run('x')!, parameters: {} }) })).toThrow('completed skill');
        const insufficient = { ...treatment.receipt, herbloreLevel: 2 };
        const { evidenceDigest: _evidenceDigest, ...insufficientFacts } = insufficient;
        insufficient.evidenceDigest = healthDigest(insufficientFacts);
        expect(() => local.health.treat(treatment.context, 'receipt-1', 1, { ...treatment.authority, receipt: () => insufficient })).toThrow('competence');
        const treated = local.health.treat(treatment.context, 'receipt-1', 1, treatment.authority);
        expect(treated).toMatchObject({ treatmentRequired: false, injuryBurden: 7000 });
        expect(local.health.treat(treatment.context, 'receipt-1', 1, treatment.authority)).toEqual(treated);
        expect(local.health.events().filter(event => event.kind === 'treatment')).toHaveLength(1);
        local.restart(); expect(local.health.get(treatment.context)).toEqual(treated);
    });
    test('the shipped policy has no invented verified medicine; invalid recovery/configuration is rejected', () => {
        expect(policy.treatments).toEqual([]);
        for (const patch of [{ recoveryBurdenPerSimulationHour: 0 }, { untreatedRecoveryFloor: 0 },
            { maximumOpenInjuries: 257 }, { agePolicy: { ...policy.agePolicy, digest: 'invalid' } }, { extra: true }]) {
            expect(() => validateHealthPolicy({ ...policyDefinition, ...patch })).toThrow();
        }
    });
    test('adding a verified care protocol explicitly migrates an existing injury without rewriting its history', () => {
        const local = harness(), treatment = treatmentFixture(local.context());
        const { digest: _digest, ...newDefinition } = treatment.context.policy;
        treatment.context.policy = validateHealthPolicy({ ...newDefinition, version: '1.0.1' });
        treatment.receipt.healthPolicyDigest = treatment.context.policy.digest;
        const { evidenceDigest: _receiptDigest, ...facts } = treatment.receipt;
        treatment.receipt.evidenceDigest = healthDigest(facts);
        const injured = local.health.ingestDamage(local.context(), local.damage(2));
        const migrated = local.health.addTreatmentProtocols(treatment.context, policy, 1, 'enable-clinic-1');
        expect(migrated.state.injuries).toEqual(injured.state.injuries);
        expect(local.health.addTreatmentProtocols(treatment.context, policy, 1, 'enable-clinic-1')).toEqual(migrated);
        expect(local.health.treat(treatment.context, 'receipt-1', 2, treatment.authority).treatmentRequired).toBeFalse();
        expect(() => local.health.addTreatmentProtocols({ ...treatment.context,
            policy: validateHealthPolicy({ ...newDefinition, version: '1.0.2', recoveryBurdenPerSimulationHour: 2000 }) },
            treatment.context.policy, 3, 'rewrite-biology')).toThrow('unchanged biology');
    });
    test('real engine ledger ingestion is restart/replay safe; missing source blocks healing', () => {
        const local = harness(); local.damage();
        const options = { statePath: local.healthPath, engineEvidencePath: local.enginePath, policy };
        const first = runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, wall);
        expect(first.byAgent.get('alice')!.injuryBurden).toBe(2000);
        local.restart(); expect(runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, wall).byAgent.get('alice')).toEqual(first.byAgent.get('alice')!);
        local.sleep();
        const missing = runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy,
            { ...options, engineEvidencePath: join(directories[directories.length - 1]!, 'missing.sqlite') }, later(7200001));
        expect(missing.sourceAvailable).toBeFalse(); expect(missing.byAgent.get('alice')!.injuryBurden).toBe(2000);
        expect(missing.byAgent.get('alice')!.sourceStatus).toBe('unavailable');
        expect(local.agents.getCharacterLifecycle('alice')!.status).toBe('active');
    });
    test('admin and trusted decision context expose authoritative injury needs from the real source', async () => {
        const local = harness(); local.damage(2);
        const result = await listAdminAgents(local.agentPath, { simulationClock: { store: local.clock, clockId: 'world' },
            populationHealth: { statePath: local.healthPath, engineEvidencePath: local.enginePath, policy },
            skillRuns: [], observedAt: wall });
        expect(result.agents[0]!.populationHealth).toMatchObject({ injuryBurden: 8000, status: 'critical', treatmentRequired: true });
        expect(result.agents[0]!.decisionContext).toContain('rest required true; treatment required true');
    });
    test('a stale producer stops recovery and cannot earn retrospective healing when it resumes', () => {
        const local = harness(); local.damage();
        const options = { statePath: local.healthPath, engineEvidencePath: local.enginePath, policy };
        runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, wall);
        local.sleep();
        const stopped = runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, later(7200001));
        expect(stopped.sourceAvailable).toBeFalse(); expect(stopped.byAgent.get('alice')!.injuryBurden).toBe(2000);
        local.engine.heartbeat(later(7200001));
        const resumed = runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, later(7200001));
        expect(resumed.sourceAvailable).toBeTrue(); expect(resumed.byAgent.get('alice')!.injuryBurden).toBe(2000);
    });
    test('malformed readiness metadata also consumes a blocked observation before failure', () => {
        const local = harness(); local.damage();
        const options = { statePath: local.healthPath, engineEvidencePath: local.enginePath, policy };
        runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, wall); local.sleep();
        const database = new Database(local.enginePath);
        database.run("UPDATE engine_health_producer SET observed_at='invalid'"); database.close(true);
        expect(() => runPopulationHealthCycle(local.agents, { store: local.clock, clockId: 'world' }, agePolicy, options, later(7200001))).toThrow('canonical');
        const blocked = local.health.get(local.context())!;
        expect(blocked.injuryBurden).toBe(2000);
        expect(blocked.state.observedAtSimulationTime).toBe(local.clock.get('world')!.lastSimulationTime);
    });
});
