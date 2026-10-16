import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AgentPopulationMember, AgentSkillKnowledge } from '../../agent-state/types.js';
import type { PopulationMemoryArchive } from '../../agent-state/memory-archive.js';
import { loadPopulationEntryEnvironment } from '../../server/gateway/admin/population-entry.js';
import { validatePopulationAgePolicy } from '../age.js';
import { loadPopulationMortalityPolicy, validatePopulationMortalityPolicy } from '../mortality.js';
import { createPopulationDeathEvidence, type PopulationDeathRecord } from '../death.js';
import { generatePopulationEntry } from '../entry.js';
import { healthDigest } from '../../population-health/policy.js';
import { buildPopulationDemographics, demographicVerified, demographicUnavailable, loadDemographicPolicy, validateDemographicPolicy,
    type DemographicAgents, type DemographicInheritance } from '../demographics.js';

const config = join(import.meta.dir, '../../config'), loaded = loadPopulationEntryEnvironment(config);
const { digest: ageDigest, ...ageDefinition } = loaded.age;
const age = validatePopulationAgePolicy({ ...ageDefinition, simulationMillisecondsPerYear: 1000 });
const { digest: mortalityDigest, ...mortalityDefinition } = loadPopulationMortalityPolicy(join(config, 'population-mortality-policy.json'));
const mortality = validatePopulationMortalityPolicy({ ...mortalityDefinition, agePolicy: { policyId: age.policyId, version: age.version, digest: age.digest } });
const policy = loadDemographicPolicy(join(config, 'population-demographics-policy.json'));
const base = '2001-01-01T00:00:00.000Z', wall = '2026-10-14T10:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(base) + ms).toISOString();
const clock = { clockId: 'world', profileDigest: 'd'.repeat(64), simulationTime: at(20000), wallTime: wall, engineTick: null, status: 'paused' as const, revision: 1 };
const emptyInheritance: DemographicInheritance = { basis: 'cumulative-native-property-history', cases: 0, blockedCases: 0,
    preparedDecisions: 0, completedDecisions: 0, appliedPropertyTransfers: 0, distinctHeirs: 0, awaitingCompletionTransfers: 0, valueGp: null, windowAttributedTransfers: null };
function member(id: string, birth: string | null, join = at(-1)): AgentPopulationMember {
    const profile = loaded.profiles.profiles.find(item => item.profileId === 'mature-society')!;
    return { agentId: id, playerUsername: id, worldProfile: { profileId: profile.profileId, version: profile.version, digest: profile.digest },
        lifecyclePolicy: { ...age.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: clock.clockId, profileDigest: clock.profileDigest },
        joinedAtSimulationTime: join, sourceResultId: 'genesis-' + 'a'.repeat(24), sourceResultDigest: 'b'.repeat(64),
        status: 'active', resetAtSimulationTime: null, createdAt: wall, updatedAt: wall, revision: 1,
        characterLifecycle: { agentId: id, origin: 'imported', createdAtSimulationTime: join, birthAtSimulationTime: birth,
            ageAtObservationMilliseconds: 0, ageObservedAtSimulationTime: join, currentAgeSimulationMilliseconds: 0,
            status: 'active', statusChangedAtSimulationTime: join, createdAt: wall, updatedAt: wall, revision: 1 } };
}
function skill(id: string, status: AgentSkillKnowledge['status'] = 'known', version = '1.0.0'): AgentSkillKnowledge {
    return { agentId: id, skill: { id: 'procedure.gather-loc-until-full', version }, status, learnedAt: wall, updatedAt: wall, revision: 1 };
}
function fixture() {
    const founder = member('founder', at(-10000)), child = member('child', base), unknown = member('unknown', null), elder = member('elder', at(-60000));
    child.characterLifecycle.origin = 'born';
    const entryPlan = generatePopulationEntry({ batchId: 'wave-1', seed: 'cohort', count: 2, anchorAgentId: 'founder' }, founder, at(19000), { ...loaded, age });
    const body = { plan: entryPlan, reason: 'Generated fixture arrivals', appliedAt: wall }, receipt = { ...body, digest: healthDigest(body) };
    const entrants = entryPlan.entrants.map(item => ({ ...member(item.identity.agentId, item.birthAtSimulationTime, entryPlan.joinedAtSimulationTime),
        playerUsername: item.identity.playerUsername!, sourceResultId: entryPlan.entryId, sourceResultDigest: entryPlan.digest }));
    const data: DemographicAgents = { members: [founder, child, unknown, elder, ...entrants], entries: [receipt],
        skills: { founder: [skill('founder')], child: [skill('child', 'preferred')] }, archives: {}, projectedDeaths: {} };
    const records: PopulationDeathRecord[] = [];
    function death(target: AgentPopulationMember, when = at(19500), kind: 'lethal' | 'natural' = 'lethal') {
        const evidence = createPopulationDeathEvidence(target, { ...clock, simulationTime: when }, age, mortality,
            kind === 'lethal' ? { damageEventId: '10000000-0000-4000-8000-000000000001', sessionId: 'demographic', engineTick: 42 } : undefined);
        return { ...evidence, sequence: records.length + 1, eventDigest: healthDigest(evidence) };
    }
    const kill = (target = founder, mode: 'confirmed' | 'late' | 'pending' = 'confirmed', kind: 'lethal' | 'natural' = 'lethal') => {
        const record = death(target, at(19500), kind); records.push(record);
        if (mode !== 'pending') {
            data.projectedDeaths[target.agentId] = record;
            target.characterLifecycle.status = 'deceased'; target.characterLifecycle.statusChangedAtSimulationTime = record.atSimulationTime;
            const archive: PopulationMemoryArchive = { schemaVersion: 1, agentId: target.agentId, deathEventId: record.eventId,
                deathDigest: record.eventDigest, deathRecordDigest: healthDigest(record), deathAtSimulationTime: record.atSimulationTime,
                deathRecordedAt: wall, capturedAt: wall, captureMode: mode === 'confirmed' ? 'death-admission' : 'late-reconciliation',
                records: { episodes: [], social: [], semantic: [], consolidation: [], skills: (data.skills[target.agentId] ?? [])
                    .map(skill => ({ skill_id: skill.skill.id, skill_version: skill.skill.version, status: skill.status })) }, actorLinks: [], controlProfile: null };
            data.archives[target.agentId] = { archive, digest: healthDigest(archive) };
        }
        return record;
    };
    const input = () => ({ clock, fromSimulationTime: at(17000), policy, age, agents: demographicVerified(data),
        engine: demographicVerified(records), inheritance: demographicVerified(emptyInheritance) });
    return { data, records, founder, child, unknown, elder, entrants, kill, input, report: () => buildPopulationDemographics(input()) };
}

describe('finite-population demographic aggregation', () => {
    test('current age structure keeps unknown ages explicit and counts distinct recorded skill holders', () => {
        const local = fixture(), report = local.report();
        expect(report.status).toBe('complete'); expect(report.sections.population.value).toMatchObject({ recordedMembers: 6, activeLivingMembers: 6, terminalMembers: 0, resetMembers: 0 });
        expect(report.sections.ageStructure.value).toMatchObject({ known: 5, unknown: 1 });
        expect(report.sections.ageStructure.value?.stages.find(stage => stage.stageId === 'elder')?.members).toBe(1);
        expect(report.sections.workforce.value).toMatchObject({ currentEligible: 4, unknownAgeLivingMembers: 1, eligibleAdmissions: 2, eligibilityTransitions: 1 });
        expect(report.sections.workforce.value?.bySpecialism.find(item => item.specialismId === 'gathering')?.potentialHolders).toBe(2);
    });
    test('adult imported arrivals are entries, never births, and replayed source receipts do not inflate admissions', () => {
        const local = fixture(); local.data.entries.push(local.data.entries[0]!);
        expect(local.report().sections.birthsAndEntries.value).toMatchObject({ admissions: 2, seededArrivals: 2, genesisAdmissions: 0, birthsInPopulation: 0 });
        expect(local.report().sections.workforce.value?.eligibilityTransitions).toBe(1);
    });
    test('birth events use origin and membership dates, not identity registration or imported dates', () => {
        const local = fixture(); local.child.characterLifecycle.birthAtSimulationTime = at(18000); local.child.joinedAtSimulationTime = at(18000);
        const report = local.report(); expect(report.sections.birthsAndEntries.value?.birthsInPopulation).toBe(1);
        expect(report.sections.workforce.value?.currentEligible).toBe(3);
        expect(report.sections.workforce.value?.eligibleAdmissions).toBe(2);
        local.child.characterLifecycle.origin = 'imported'; expect(local.report().sections.birthsAndEntries.value?.birthsInPopulation).toBe(0);
    });
    test('window bounds are (from,to], including deaths at to but excluding events at from', () => {
        const local = fixture(); const death = local.kill();
        const report = buildPopulationDemographics({ ...local.input(), clock: { ...clock, simulationTime: death.atSimulationTime }, fromSimulationTime: at(19000) });
        expect(report.sections.birthsAndEntries.value?.admissions).toBe(0); expect(report.sections.deaths.value?.total).toBe(1);
        expect(buildPopulationDemographics({ ...local.input(), fromSimulationTime: death.atSimulationTime }).sections.deaths.value?.total).toBe(0);
        expect(() => buildPopulationDemographics({ ...local.input(), fromSimulationTime: at(20001) })).toThrow('window');
    });
    test('engine-only terminal deaths remove live workers while missing archives remain an explicit lower bound', () => {
        const local = fixture(); local.kill(local.founder, 'pending'); const report = local.report();
        expect(report.sections.population.value).toMatchObject({ activeLivingMembers: 5, pendingDeathProjections: 1 });
        expect(report.sections.workforce.value).toMatchObject({ currentEligible: 3, eligibleDeathLosses: 1 });
        expect(report.sections.specialistLosses.status).toBe('partial'); expect(report.sections.specialistLosses.value).toMatchObject({ missingProfiles: 1, confirmedProfiles: 0, distinctSpecialistsLost: 0 });
    });
    test('specialist losses use contemporaneous archives and deduplicate several skills within a specialism', () => {
        const local = fixture(); local.data.skills.founder!.push(skill('founder'));
        local.kill(); delete local.data.skills.founder;
        const report = local.report(); expect(report.sections.specialistLosses.status).toBe('verified');
        expect(report.sections.specialistLosses.value).toMatchObject({ confirmedProfiles: 1, distinctSpecialistsLost: 1, missingProfiles: 0 });
        expect(report.sections.specialistLosses.value?.bySpecialism.find(item => item.specialismId === 'gathering')?.holdersLost).toBe(1);
    });
    test('blocked skills and mismatched versions are not qualifications or specialist losses', () => {
        const local = fixture(); local.data.skills.founder = [skill('founder', 'blocked'), skill('founder', 'known', '0.1.0')];
        expect(local.report().sections.workforce.value?.bySpecialism.find(item => item.specialismId === 'gathering')?.potentialHolders).toBe(1);
        local.kill(); expect(local.report().sections.specialistLosses.value?.distinctSpecialistsLost).toBe(0);
    });
    test('late archives cannot establish a death-time skill profile', () => {
        const local = fixture(); local.kill(local.founder, 'late');
        expect(local.report().sections.specialistLosses).toMatchObject({ status: 'partial', value: { lateProfiles: 1, confirmedProfiles: 0 } });
    });
    test('unknown birth at death stays unknown for workforce losses', () => {
        const local = fixture(); local.kill(local.unknown);
        expect(local.report().sections.workforce.value).toMatchObject({ unknownAgeDeathLosses: 1, eligibleDeathLosses: 0 });
    });
    test('natural mortality and lethal deaths have separate counters', () => {
        const local = fixture(); local.elder.characterLifecycle.birthAtSimulationTime = at(-150000); local.kill(local.elder, 'confirmed', 'natural');
        expect(buildPopulationDemographics({ ...local.input(), fromSimulationTime: at(-2) }).sections.deaths.value).toMatchObject({ total: 1, natural: 1, lethal: 0 });
    });
    test('reset members leave current structure and labour, while entry/reset history remains countable', () => {
        const local = fixture(); const target = local.entrants[0]!; target.status = 'reset'; target.resetAtSimulationTime = at(19500);
        const report = local.report(); expect(report.sections.population.value).toMatchObject({ activeLivingMembers: 5, resetMembers: 1 });
        expect(report.sections.birthsAndEntries.value).toMatchObject({ admissions: 2, seededArrivals: 2, resets: 1 });
        expect(report.sections.workforce.value?.currentEligible).toBe(3);
    });
    test('missing engine data never yields zero deaths or a fabricated live workforce', () => {
        const local = fixture(), report = buildPopulationDemographics({ ...local.input(), engine: demographicUnavailable('engine missing') });
        expect(report.status).toBe('partial'); expect(report.sections.deaths.value).toBeNull(); expect(report.sections.workforce.value).toBeNull();
        expect(report.sections.birthsAndEntries.status).toBe('verified');
    });
    test('missing inheritance is separate from verified zero; wealth valuation and unrecorded simulation attribution stay null', () => {
        const local = fixture(); expect(local.report().sections.inheritance.value).toMatchObject({ appliedPropertyTransfers: 0, valueGp: null, windowAttributedTransfers: null });
        const report = buildPopulationDemographics({ ...local.input(), inheritance: demographicUnavailable('property missing') });
        expect(report.sections.inheritance.value).toBeNull(); expect(report.sections.ageStructure.status).toBe('verified');
    });
    test('conflicting engine/projection or duplicate death evidence makes dependent sections unavailable', () => {
        const local = fixture(); const record = local.kill(); local.records.push(record);
        expect(local.report().sections.deaths.status).toBe('unavailable'); local.records.pop();
        local.data.projectedDeaths.founder = { ...record, eventDigest: 'e'.repeat(64) };
        expect(local.report().sections.population.value).toBeNull();
    });
    test('exact clock and lifecycle binding is mandatory and future observations are rejected', () => {
        const local = fixture(); local.founder.simulationClock = { ...local.founder.simulationClock, profileDigest: 'f'.repeat(64) };
        expect(() => local.report()).toThrow('binding');
    });
    test('a natural death observed beyond the reporting clock cannot establish a historical count after clock rollback', () => {
        const local = fixture(); local.elder.characterLifecycle.birthAtSimulationTime = at(-150000);
        const prior = local.kill(local.elder, 'pending', 'natural');
        const { sequence, eventDigest, ...body } = prior;
        const event = { ...body, clock: { ...body.clock, simulationTime: at(21000) } };
        local.records[0] = { ...event, sequence, eventDigest: healthDigest(event) };
        expect(buildPopulationDemographics({ ...local.input(), fromSimulationTime: at(-2) }).sections.deaths.status).toBe('unavailable');
    });
    test('a projected death with a reopened AgentState lifecycle is inconsistent rather than a healthy live member', () => {
        const local = fixture(); local.kill(); local.founder.characterLifecycle.status = 'active';
        expect(local.report().sections.population.value).toBeNull(); expect(local.report().sections.workforce.status).toBe('unavailable');
    });
    test('the workload threshold independently controls potential supply and qualification transitions', () => {
        const local = fixture(), { digest, ...definition } = policy;
        const strict = validateDemographicPolicy({ ...definition, minimumWorkloadCapacityBasisPoints: 11000 });
        const report = buildPopulationDemographics({ ...local.input(), policy: strict });
        expect(report.sections.workforce.value).toMatchObject({ currentEligible: 0, eligibleAdmissions: 0, eligibilityTransitions: 0 });
        expect(report.sections.ageStructure.value).toMatchObject({ known: 5, unknown: 1 });
    });
    test('policy validation rejects ambiguous definitions and policy tampering; empty sources produce verified zero', () => {
        const { digest, ...definition } = policy;
        for (const patch of [{ workingAgeYears: { minimum: 70, maximumExclusive: 18 } }, { minimumWorkloadCapacityBasisPoints: -1 }, { specialisms: [definition.specialisms[0], definition.specialisms[0]] }])
            expect(() => validateDemographicPolicy({ ...definition, ...patch })).toThrow();
        const local = fixture(); expect(() => buildPopulationDemographics({ ...local.input(), policy: { ...policy, digest: 'a'.repeat(64) } })).toThrow('digest');
        const report = buildPopulationDemographics({ ...local.input(), agents: demographicVerified({ members: [], skills: {}, archives: {}, entries: [], projectedDeaths: {} }) });
        expect(report.status).toBe('complete'); expect(report.sections.population.value?.recordedMembers).toBe(0); expect(report.sections.deaths.value?.total).toBe(0);
        expect(local.report()).toEqual(local.report());
    });
});
