import { readFileSync } from 'node:fs';
import type { AgentPopulationMember, AgentSkillKnowledge } from '../agent-state/types.js';
import type { PopulationMemoryArchive } from '../agent-state/memory-archive.js';
import type { PopulationEntryReceipt } from './entry.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { healthDigest, healthObject, healthTime } from '../population-health/policy.js';
import { validatePopulationAgePolicy, type PopulationAgePolicy } from './age.js';
import { populationDeathMembershipDigest, validatePopulationDeathEvidence, type PopulationDeathRecord } from './death.js';

export interface DemographicPolicyDefinition {
    schemaVersion: 1; policyId: string; version: string;
    workingAgeYears: { minimum: number; maximumExclusive: number };
    minimumWorkloadCapacityBasisPoints: number;
    specialisms: Array<{ specialismId: string; skills: Array<{ id: string; version: string }> }>;
}
export interface DemographicPolicy extends DemographicPolicyDefinition { digest: string }
export interface DemographicSource<T> { status: 'verified' | 'unavailable'; value: T | null; digest: string | null; issue: string | null }
export interface DemographicSection<T> { status: 'verified' | 'partial' | 'unavailable'; value: T | null; issues: string[] }
export interface DemographicAgents {
    members: AgentPopulationMember[];
    skills: Record<string, AgentSkillKnowledge[]>;
    archives: Record<string, { archive: PopulationMemoryArchive; digest: string } | null>;
    entries: PopulationEntryReceipt[];
    projectedDeaths: Record<string, PopulationDeathRecord | null>;
}
export interface DemographicInheritance {
    basis: 'cumulative-native-property-history';
    cases: number; blockedCases: number; preparedDecisions: number; completedDecisions: number;
    appliedPropertyTransfers: number; distinctHeirs: number; awaitingCompletionTransfers: number;
    valueGp: null; windowAttributedTransfers: null;
}
const KEY = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
export function validateDemographicPolicy(raw: unknown): DemographicPolicy {
    const value = healthObject(raw, ['schemaVersion', 'policyId', 'version', 'workingAgeYears',
        'minimumWorkloadCapacityBasisPoints', 'specialisms'], 'Demographic policy');
    const ages = healthObject(value.workingAgeYears, ['minimum', 'maximumExclusive'], 'Working age');
    if (value.schemaVersion !== 1 || typeof value.policyId !== 'string' || !KEY.test(value.policyId)
        || typeof value.version !== 'string' || !VERSION.test(value.version)
        || !Number.isSafeInteger(ages.minimum) || !Number.isSafeInteger(ages.maximumExclusive)
        || Number(ages.minimum) < 0 || Number(ages.maximumExclusive) <= Number(ages.minimum) || Number(ages.maximumExclusive) > 200
        || !Number.isSafeInteger(value.minimumWorkloadCapacityBasisPoints) || Number(value.minimumWorkloadCapacityBasisPoints) < 0
        || Number(value.minimumWorkloadCapacityBasisPoints) > 40000 || !Array.isArray(value.specialisms) || value.specialisms.length > 64)
        throw new Error('Demographic policy identity, working ages or capacity threshold is invalid');
    const specialisms = value.specialisms.map(raw => {
        const item = healthObject(raw, ['specialismId', 'skills'], 'Demographic specialism');
        if (typeof item.specialismId !== 'string' || !KEY.test(item.specialismId) || !Array.isArray(item.skills)
            || item.skills.length < 1 || item.skills.length > 64) throw new Error('Demographic specialism is invalid');
        const skills = item.skills.map(raw => {
            const skill = healthObject(raw, ['id', 'version'], 'Demographic skill');
            if (typeof skill.id !== 'string' || !KEY.test(skill.id) || typeof skill.version !== 'string' || !VERSION.test(skill.version))
                throw new Error('Demographic skill is invalid');
            return { id: skill.id, version: skill.version };
        }).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
        if (new Set(skills.map(item => `${item.id}@${item.version}`)).size !== skills.length) throw new Error('Duplicate demographic skill');
        return { specialismId: item.specialismId, skills };
    }).sort((a, b) => a.specialismId.localeCompare(b.specialismId));
    if (new Set(specialisms.map(item => item.specialismId)).size !== specialisms.length) throw new Error('Duplicate demographic specialism');
    const definition: DemographicPolicyDefinition = { schemaVersion: 1, policyId: value.policyId, version: value.version,
        workingAgeYears: { minimum: ages.minimum as number, maximumExclusive: ages.maximumExclusive as number },
        minimumWorkloadCapacityBasisPoints: value.minimumWorkloadCapacityBasisPoints as number, specialisms };
    return { ...definition, digest: healthDigest(definition) };
}
export function loadDemographicPolicy(path: string): DemographicPolicy { return validateDemographicPolicy(JSON.parse(readFileSync(path, 'utf8'))); }
export function demographicVerified<T>(value: T): DemographicSource<T> { return { status: 'verified', value, digest: healthDigest(value), issue: null }; }
export function demographicUnavailable<T>(error: unknown): DemographicSource<T> { return { status: 'unavailable', value: null, digest: null, issue: String(error) }; }
const verified = <T>(value: T): DemographicSection<T> => ({ status: 'verified', value, issues: [] });
const unavailable = <T = never>(issues: string[]): DemographicSection<T> => ({ status: 'unavailable', value: null, issues });

export function verifyDemographicDeaths(data: DemographicAgents, records: PopulationDeathRecord[], clock: SimulationClockObservation) {
    const members = new Map(data.members.map(member => [member.agentId, member])), deaths = new Map<string, PopulationDeathRecord>();
    for (const record of records) {
        if (record.clock.clockId !== clock.clockId || record.clock.profileDigest !== clock.profileDigest) continue;
        const { sequence, eventDigest, ...body } = record, event = validatePopulationDeathEvidence(body), member = members.get(event.agentId);
        if (!member || deaths.has(event.agentId) || !Number.isSafeInteger(sequence) || sequence < 1 || eventDigest !== healthDigest(event)
            || event.playerUsername !== member.playerUsername || event.membershipDigest !== populationDeathMembershipDigest(member)
            || event.atSimulationTime < member.joinedAtSimulationTime || event.atSimulationTime > clock.simulationTime
            || event.clock.simulationTime > clock.simulationTime
            || member.resetAtSimulationTime !== null && event.atSimulationTime > member.resetAtSimulationTime)
            throw new Error('Demographic engine death conflicts with population/clock history');
        deaths.set(event.agentId, record);
    }
    for (const member of data.members) {
        const projected = data.projectedDeaths[member.agentId], death = deaths.get(member.agentId);
        if (projected && (!death || healthDigest(projected) !== healthDigest(death) || member.characterLifecycle.status !== 'deceased')
            || member.characterLifecycle.status === 'deceased' && (!death || member.characterLifecycle.statusChangedAtSimulationTime !== death.atSimulationTime))
            throw new Error('Demographic death projection conflicts with engine authority');
    }
    return deaths;
}

export function buildPopulationDemographics(input: { clock: SimulationClockObservation; fromSimulationTime: string;
    policy: DemographicPolicy; age: PopulationAgePolicy; agents: DemographicSource<DemographicAgents>;
    engine: DemographicSource<PopulationDeathRecord[]>; inheritance: DemographicSource<DemographicInheritance> }) {
    const { clock, fromSimulationTime: from, agents, engine, inheritance } = input;
    healthTime(from); healthTime(clock.simulationTime);
    if (from > clock.simulationTime) throw new Error('Demographic window starts after the shared clock');
    const { digest, ...definition } = input.policy, policy = validateDemographicPolicy(definition);
    const { digest: ageDigest, ...ageDefinition } = input.age, age = validatePopulationAgePolicy(ageDefinition);
    if (digest !== policy.digest || ageDigest !== age.digest) throw new Error('Demographic policy digest is stale');
    const inWindow = (at: string) => at > from && at <= clock.simulationTime;
    const sourceIssues = [agents.issue, engine.issue].filter((item): item is string => item !== null);
    const members = agents.value?.members ?? [];
    for (const member of members) {
        const { kind, ...lifecycle } = member.lifecyclePolicy;
        if (kind !== 'finite' || healthDigest(lifecycle) !== healthDigest(age.lifecyclePolicy)
            || member.simulationClock.clockId !== clock.clockId || member.simulationClock.profileDigest !== clock.profileDigest
            || member.joinedAtSimulationTime > clock.simulationTime || member.resetAtSimulationTime !== null && member.resetAtSimulationTime > clock.simulationTime
            || member.characterLifecycle.birthAtSimulationTime !== null && member.characterLifecycle.birthAtSimulationTime > clock.simulationTime)
            throw new Error('Demographic member policy/clock binding is invalid or changed during read');
    }
    const born = (member: AgentPopulationMember) => member.characterLifecycle.birthAtSimulationTime;
    const ageAt = (member: AgentPopulationMember, at: string) => {
        const birth = born(member); if (birth === null) return null;
        const value = healthTime(at) - healthTime(birth);
        if (!Number.isSafeInteger(value)) throw new Error('Demographic age is invalid');
        if (value < 0) return null; // A recorded later birth cannot supply pre-birth labour.
        return value;
    };
    const stageAt = (milliseconds: number) => [...age.stages].reverse().find(stage => milliseconds >= stage.fromAgeYears * age.simulationMillisecondsPerYear)!;
    const eligible = (member: AgentPopulationMember, at: string) => {
        const value = ageAt(member, at); if (value === null) return false;
        return value >= policy.workingAgeYears.minimum * age.simulationMillisecondsPerYear
            && value < policy.workingAgeYears.maximumExclusive * age.simulationMillisecondsPerYear
            && stageAt(value).modifiers.workloadCapacityBasisPoints >= policy.minimumWorkloadCapacityBasisPoints;
    };
    let deaths: Map<string, PopulationDeathRecord> | null = null;
    if (agents.value && engine.value) {
        try { deaths = verifyDemographicDeaths(agents.value, engine.value, clock); }
        catch (error) { sourceIssues.push(String(error)); }
    }
    const alive = deaths ? members.filter(member => member.status === 'active' && !deaths!.has(member.agentId)) : [];
    const windowDeaths = deaths ? [...deaths.values()].filter(death => inWindow(death.atSimulationTime)) : [];
    const admissions = members.filter(member => inWindow(member.joinedAtSimulationTime));
    const arrivals = new Set(agents.value?.entries.flatMap(receipt => receipt.plan.entrants.map(item => item.identity.agentId)) ?? []);
    const birthsAndEntries = agents.value ? verified({ admissions: admissions.length,
        genesisAdmissions: admissions.filter(member => member.sourceResultId.startsWith('genesis-')).length,
        seededArrivals: admissions.filter(member => arrivals.has(member.agentId)).length,
        birthsInPopulation: members.filter(member => member.characterLifecycle.origin === 'born' && born(member) !== null
            && born(member)! >= member.joinedAtSimulationTime && inWindow(born(member)!)
            && (member.resetAtSimulationTime === null || born(member)! <= member.resetAtSimulationTime)).length,
        resets: members.filter(member => member.resetAtSimulationTime !== null && inWindow(member.resetAtSimulationTime)).length })
        : unavailable<{ admissions: number; genesisAdmissions: number; seededArrivals: number; birthsInPopulation: number; resets: number }>([agents.issue!]);
    const population = deaths ? verified({ recordedMembers: members.length, activeLivingMembers: alive.length,
        terminalMembers: members.filter(member => member.status === 'active' && deaths!.has(member.agentId)).length,
        recordedDeaths: deaths.size, resetMembers: members.filter(member => member.status === 'reset').length,
        pendingDeathProjections: [...deaths.keys()].filter(id => !agents.value!.projectedDeaths[id]).length }) : unavailable(sourceIssues);
    const ages = alive.map(member => ageAt(member, clock.simulationTime));
    const ageStructure = deaths ? verified({ basis: 'active-living-members' as const, known: ages.filter(value => value !== null).length,
        unknown: ages.filter(value => value === null).length,
        stages: age.stages.map(stage => ({ stageId: stage.stageId, fromAgeYears: stage.fromAgeYears,
            members: ages.filter(value => value !== null && stageAt(value).stageId === stage.stageId).length })) }) : unavailable(sourceIssues);
    const deathMetrics = deaths ? verified({ total: windowDeaths.length,
        natural: windowDeaths.filter(death => death.cause.kind === 'natural-mortality').length,
        lethal: windowDeaths.filter(death => death.cause.kind === 'engine-hp-zero').length,
        starvation: windowDeaths.filter(death => death.cause.kind === 'starvation').length }) : unavailable(sourceIssues);
    const holders = (skills: Array<{ id: string; version: string }>, specialism: DemographicPolicy['specialisms'][number]) =>
        skills.some(skill => specialism.skills.some(required => required.id === skill.id && required.version === skill.version));
    const lost = new Map<string, Array<{ id: string; version: string }>>();
    let lateProfiles = 0, missingProfiles = 0;
    for (const death of windowDeaths) {
        const archive = agents.value!.archives[death.agentId]?.archive;
        if (!archive) { missingProfiles++; continue; }
        if (archive.deathEventId !== death.eventId || archive.deathDigest !== death.eventDigest) throw new Error('Demographic archive death binding conflicts');
        if (archive.captureMode !== 'death-admission') { lateProfiles++; continue; }
        lost.set(death.agentId, archive.records.skills.filter(row => row.status === 'known' || row.status === 'preferred')
            .map(row => ({ id: String(row.skill_id), version: String(row.skill_version) })));
    }
    const specialistLosses = deaths ? { ...verified({ deathsInWindow: windowDeaths.length, confirmedProfiles: lost.size,
        missingProfiles, lateProfiles, distinctSpecialistsLost: [...lost.values()].filter(skills => policy.specialisms.some(specialism => holders(skills, specialism))).length,
        bySpecialism: policy.specialisms.map(specialism => ({ specialismId: specialism.specialismId,
            holdersLost: [...lost.values()].filter(skills => holders(skills, specialism)).length })) }),
    status: missingProfiles + lateProfiles ? 'partial' as const : 'verified' as const,
    issues: missingProfiles + lateProfiles ? ['Some deaths lack a contemporaneous archived skill profile; confirmed losses are a lower bound.'] : [] } : unavailable(sourceIssues);
    const potential = alive.filter(member => eligible(member, clock.simulationTime));
    const transitions = deaths ? members.filter(member => {
        const birth = born(member); if (birth === null) return false;
        const thresholds = new Set([policy.workingAgeYears.minimum, ...age.stages.map(stage => stage.fromAgeYears)]);
        return [...thresholds].some(year => {
            const at = new Date(healthTime(birth) + year * age.simulationMillisecondsPerYear).toISOString();
            return at > member.joinedAtSimulationTime && inWindow(at) && eligible(member, at)
                && !eligible(member, new Date(healthTime(at) - 1).toISOString())
                && (member.resetAtSimulationTime === null || at <= member.resetAtSimulationTime)
                && (!deaths?.has(member.agentId) || at <= deaths.get(member.agentId)!.atSimulationTime);
        });
    }) : [];
    const workforce = deaths ? verified({ basis: 'potential-age-and-recorded-skill' as const, currentEligible: potential.length,
        unknownAgeLivingMembers: ages.filter(value => value === null).length,
        eligibleAdmissions: admissions.filter(member => eligible(member, member.joinedAtSimulationTime)).length,
        eligibilityTransitions: transitions.length,
        eligibleDeathLosses: windowDeaths.filter(death => eligible(members.find(member => member.agentId === death.agentId)!, death.atSimulationTime)).length,
        unknownAgeDeathLosses: windowDeaths.filter(death => born(members.find(member => member.agentId === death.agentId)!) === null).length,
        bySpecialism: policy.specialisms.map(specialism => ({ specialismId: specialism.specialismId,
            potentialHolders: potential.filter(member => holders((agents.value!.skills[member.agentId] ?? [])
                .filter(skill => skill.status === 'known' || skill.status === 'preferred').map(skill => skill.skill), specialism)).length })) }) : unavailable(sourceIssues);
    const inheritanceMetrics = inheritance.value ? verified(inheritance.value) : unavailable<DemographicInheritance>([inheritance.issue!]);
    const sections = { population, ageStructure, birthsAndEntries, deaths: deathMetrics, specialistLosses, workforce, inheritance: inheritanceMetrics };
    const statuses = Object.values(sections).map(section => section.status);
    const report = { schemaVersion: 1 as const, status: statuses.every(status => status === 'verified') ? 'complete' : statuses.every(status => status === 'unavailable') ? 'unavailable' : 'partial',
        clock, window: { fromSimulationTime: from, toSimulationTime: clock.simulationTime, bounds: '(from,to]' as const },
        scope: 'all-recorded-memberships-on-exact-clock-including-reset' as const,
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest }, agePolicyDigest: age.digest,
        sources: { agents: { status: agents.status, digest: agents.digest, issue: agents.issue },
            engine: { status: engine.status, digest: engine.digest, issue: engine.issue },
            inheritance: { status: inheritance.status, digest: inheritance.digest, issue: inheritance.issue } }, sections };
    return { ...report, digest: healthDigest(report) };
}
