import type { AgentPopulationMember } from '../agent-state/types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { healthDigest, healthInteger, healthObject, healthTime } from '../population-health/policy.js';
import { evaluatePopulationAge, type PopulationAgePolicy } from './age.js';
import { evaluatePopulationMortality, type PopulationMortalityPolicy } from './mortality.js';

export type PopulationDeathCause = { kind: 'engine-hp-zero'; damageEventId: string; sessionId: string; engineTick: number }
    | { kind: 'natural-mortality'; candidateId: string; mortalityPolicyDigest: string };
export interface PopulationDeathEvidence {
    schemaVersion: 1; eventId: string; agentId: string; playerUsername: string; membershipDigest: string;
    memberRevision: number; lifecycleRevision: number; clock: SimulationClockObservation;
    atSimulationTime: string; recordedAt: string; cause: PopulationDeathCause; agePolicyDigest: string;
}
export interface PopulationDeathRecord extends PopulationDeathEvidence { sequence: number; eventDigest: string }

/** No observation-derived age or mutable status/revision enters the immutable identity digest. */
export function populationDeathMembershipDigest(member: AgentPopulationMember): string {
    return healthDigest({ agentId: member.agentId, playerUsername: member.playerUsername, worldProfile: member.worldProfile,
        lifecyclePolicy: member.lifecyclePolicy, simulationClock: member.simulationClock,
        joinedAtSimulationTime: member.joinedAtSimulationTime, sourceResultId: member.sourceResultId,
        sourceResultDigest: member.sourceResultDigest, createdAt: member.createdAt,
        lifecycleCreatedAt: member.characterLifecycle.createdAtSimulationTime,
        birthAt: member.characterLifecycle.birthAtSimulationTime });
}

export function createPopulationDeathEvidence(member: AgentPopulationMember, clock: SimulationClockObservation,
    agePolicy: PopulationAgePolicy, mortalityPolicy: PopulationMortalityPolicy,
    lethal?: { damageEventId: string; sessionId: string; engineTick: number }): PopulationDeathEvidence {
    evaluatePopulationAge(member, clock, agePolicy);
    if (member.status !== 'active' || member.characterLifecycle.status !== 'active') throw new Error('Inactive population cannot die again');
    const mortality = evaluatePopulationMortality(member, clock, agePolicy, mortalityPolicy);
    if (!lethal && !mortality.candidate?.due) throw new Error('Natural mortality candidate is not due');
    const cause: PopulationDeathCause = lethal ? { kind: 'engine-hp-zero', ...lethal }
        : { kind: 'natural-mortality', candidateId: mortality.candidate!.candidateId, mortalityPolicyDigest: mortalityPolicy.digest };
    const membershipDigest = populationDeathMembershipDigest(member);
    const eventId = `population-death-${healthDigest({ membershipDigest, cause })}`;
    return validatePopulationDeathEvidence({ schemaVersion: 1, eventId, agentId: member.agentId,
        playerUsername: member.playerUsername, membershipDigest, memberRevision: member.revision,
        lifecycleRevision: member.characterLifecycle.revision, clock,
        atSimulationTime: lethal ? clock.simulationTime : mortality.candidate!.atSimulationTime,
        recordedAt: clock.wallTime, cause, agePolicyDigest: agePolicy.digest });
}

export function validatePopulationDeathEvidence(raw: unknown): PopulationDeathEvidence {
    const item = healthObject(raw, ['schemaVersion','eventId','agentId','playerUsername','membershipDigest','memberRevision',
        'lifecycleRevision','clock','atSimulationTime','recordedAt','cause','agePolicyDigest'], 'Population death');
    const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (item.schemaVersion !== 1 || typeof item.eventId !== 'string' || !/^population-death-[a-f0-9]{64}$/.test(item.eventId)
        || typeof item.agentId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(item.agentId)
        || typeof item.playerUsername !== 'string' || !/^[a-z0-9]{1,12}$/.test(item.playerUsername)
        || !digest(item.membershipDigest) || !digest(item.agePolicyDigest)) throw new Error('Population death identity is invalid');
    healthInteger(item.memberRevision, 1, Number.MAX_SAFE_INTEGER); healthInteger(item.lifecycleRevision, 1, Number.MAX_SAFE_INTEGER);
    const clock = healthObject(item.clock, ['clockId','profileDigest','simulationTime','wallTime','status','revision','engineTick'], 'Death clock');
    if (typeof clock.clockId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(clock.clockId) || !digest(clock.profileDigest)
        || !['running','paused'].includes(String(clock.status))) throw new Error('Death clock is invalid');
    healthInteger(clock.revision, 1, Number.MAX_SAFE_INTEGER);
    if (clock.engineTick !== null) healthInteger(clock.engineTick, 0, Number.MAX_SAFE_INTEGER);
    for (const value of [clock.wallTime, clock.simulationTime, item.atSimulationTime, item.recordedAt]) {
        if (typeof value !== 'string') throw new Error('Death timestamp is invalid'); healthTime(value);
    }
    if (item.recordedAt !== clock.wallTime || String(item.atSimulationTime) > String(clock.simulationTime)) throw new Error('Death time is invalid');
    const rawCause = item.cause as Record<string, unknown>;
    if (rawCause?.kind === 'engine-hp-zero') {
        const cause = healthObject(rawCause, ['kind','damageEventId','sessionId','engineTick'], 'Lethal death cause');
        if (typeof cause.damageEventId !== 'string' || !/^[a-f0-9-]{36}$/.test(cause.damageEventId)
            || typeof cause.sessionId !== 'string' || cause.sessionId.length < 1 || cause.sessionId.length > 128
            || item.atSimulationTime !== clock.simulationTime) throw new Error('Lethal death cause is invalid');
        healthInteger(cause.engineTick, 0, Number.MAX_SAFE_INTEGER);
    } else if (rawCause?.kind === 'natural-mortality') {
        const cause = healthObject(rawCause, ['kind','candidateId','mortalityPolicyDigest'], 'Natural death cause');
        if (typeof cause.candidateId !== 'string' || !/^natural-mortality-[a-f0-9]{32}$/.test(cause.candidateId)
            || !digest(cause.mortalityPolicyDigest)) throw new Error('Natural death cause is invalid');
    } else throw new Error('Unsupported death cause');
    if (item.eventId !== `population-death-${healthDigest({ membershipDigest: item.membershipDigest, cause: item.cause })}`)
        throw new Error('Population death event id conflict');
    return structuredClone(item) as unknown as PopulationDeathEvidence;
}
