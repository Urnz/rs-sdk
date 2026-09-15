import { createHash } from 'node:crypto';
import { applySkillPotentialProgression } from './progression.js';
import { skillCapPolicyDigest } from './skill-cap-policy.js';
import { POTENTIAL_ENABLED_SKILLS, SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION, type SkillCapPolicy,
    type SkillPotentialExperimentDefinition, type SkillPotentialExperimentReport,
    type SkillPotentialExperimentReportDefinition, type SkillPotentialProfile,
    type SkillPotentialTelemetryEvent, type SkillPotentialTelemetrySummary } from './types.js';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const enabledSkills = new Set<string>(POTENTIAL_ENABLED_SKILLS);

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function identifier(value: string, field: string): string {
    if (!IDENTIFIER.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function integer(value: number, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}

function validateDefinition(value: SkillPotentialExperimentDefinition, policy: SkillCapPolicy):
    SkillPotentialExperimentDefinition {
    if (value.schemaVersion !== SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION
        || !VERSION.test(value.version) || !Array.isArray(value.events)) {
        throw new Error('Skill potential experiment identity is invalid');
    }
    if (value.events.length < 1 || value.events.length > 10_000) {
        throw new Error('Skill potential experiment requires 1-10000 events');
    }
    if (!DIGEST.test(value.treatmentPolicy.digest)
        || value.treatmentPolicy.policyId !== policy.policyId
        || value.treatmentPolicy.version !== policy.version
        || value.treatmentPolicy.digest !== policy.digest) {
        throw new Error('Treatment policy evidence does not match');
    }
    const seen = new Set<string>();
    const events = value.events.map((event, index) => {
        const eventId = identifier(event.eventId, `events[${index}].eventId`);
        if (seen.has(eventId)) throw new Error(`Experiment event is duplicated: ${eventId}`);
        seen.add(eventId);
        if (!enabledSkills.has(event.skillId)) throw new Error(`Experiment skill is not potential-enabled: ${event.skillId}`);
        return { eventId, skillId: event.skillId,
            baseXp: integer(event.baseXp, `events[${index}].baseXp`, 0, 2_000_000_000),
            currentLevel: integer(event.currentLevel, `events[${index}].currentLevel`, 1, 99) };
    });
    return { schemaVersion: SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION,
        experimentId: identifier(value.experimentId, 'experimentId'), version: value.version,
        treatmentPolicy: { ...value.treatmentPolicy }, events };
}

function validatePolicy(policy: SkillCapPolicy): void {
    if (!DIGEST.test(policy.digest)) throw new Error('Treatment policy digest is invalid');
    const { digest: supplied, ...definition } = policy;
    if (skillCapPolicyDigest(definition) !== supplied) throw new Error('Treatment policy digest does not match');
}

function summarize(participantId: string, arm: SkillPotentialTelemetrySummary['arm'],
    telemetry: SkillPotentialTelemetryEvent[]): SkillPotentialTelemetrySummary {
    const selected = telemetry.filter(item => item.participantId === participantId && item.arm === arm);
    const baseXp = selected.reduce((sum, item) => sum + item.event.baseXp, 0);
    const grantedXp = selected.reduce((sum, item) => sum + item.grantedXp, 0);
    return { participantId, arm, awards: selected.length, baseXp, grantedXp,
        adjustedXp: grantedXp - baseXp,
        blockedAwards: selected.filter(item => item.award?.reason === 'personal-cap-reached').length,
        softCappedAwards: selected.filter(item => {
            const softCap = item.award?.capDecision?.personalSoftCapLevel;
            return typeof softCap === 'number' && item.event.currentLevel >= softCap;
        }).length };
}

export function runSkillPotentialExperiment(definitionValue: SkillPotentialExperimentDefinition,
    participantsValue: Array<{ participantId: string; profile: SkillPotentialProfile }>,
    treatmentPolicy: SkillCapPolicy): SkillPotentialExperimentReport {
    validatePolicy(treatmentPolicy);
    const definition = validateDefinition(definitionValue, treatmentPolicy);
    if (participantsValue.length < 1 || participantsValue.length > 1_000
        || participantsValue.length * definition.events.length > 250_000) {
        throw new Error('Experiment requires 1-1000 participants and at most 250000 paired events');
    }
    const participantIds = new Set<string>();
    const participants = participantsValue.map((participant, index) => {
        const participantId = identifier(participant.participantId, `participants[${index}].participantId`);
        if (participantIds.has(participantId)) throw new Error(`Experiment participant is duplicated: ${participantId}`);
        participantIds.add(participantId);
        if (!DIGEST.test(participant.profile.digest)) throw new Error('Participant potential profile digest is invalid');
        return { participantId, profile: participant.profile };
    });
    const telemetry: SkillPotentialTelemetryEvent[] = [];
    for (const participant of participants) {
        for (const event of definition.events) {
            telemetry.push({ participantId: participant.participantId, arm: 'control-vanilla', event,
                award: null, grantedXp: event.baseXp });
            const award = applySkillPotentialProgression(event.baseXp, event.skillId, event.currentLevel,
                participant.profile, treatmentPolicy);
            telemetry.push({ participantId: participant.participantId, arm: 'treatment-potential', event,
                award, grantedXp: award.grantedXp });
        }
    }
    const summaries = participants.flatMap(participant => [
        summarize(participant.participantId, 'control-vanilla', telemetry),
        summarize(participant.participantId, 'treatment-potential', telemetry)
    ]);
    const experiment = { experimentId: definition.experimentId, version: definition.version,
        digest: digest(definition) };
    const reportDefinition: SkillPotentialExperimentReportDefinition = {
        schemaVersion: SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION, experiment,
        treatmentPolicy: { policyId: treatmentPolicy.policyId, version: treatmentPolicy.version,
            digest: treatmentPolicy.digest }, workloadFingerprint: digest(definition.events),
        participants: participants.map(item => ({ participantId: item.participantId,
            potentialProfileDigest: item.profile.digest })), telemetry, summaries
    };
    return { ...reportDefinition, digest: digest(reportDefinition) };
}
