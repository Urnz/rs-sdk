import type { RegisteredSkill, SkillRunResult } from '../agent-skills/types.js';
import type { FacilityAccessGrantEvidence, FacilityCapabilityCatalog } from '../facility-capability/types.js';
import { authorizeFacilityCapability } from '../facility-capability/authorization.js';
import { healthDigest, healthKey, healthTime } from './policy.js';
import type { HealthContext } from './types.js';

/** Issued by an authoritative clinical completion source, never by model text or a generic skill result. */
export interface HealthTreatmentReceipt {
    receiptId: string; treatmentId: string; patientAgentId: string; injuryId: string;
    practitionerAgentId: string; practitionerUsername: string; runId: string;
    clockId: string; clockProfileDigest: string; healthPolicyDigest: string; membershipSourceDigest: string;
    completedAtSimulationTime: string; facilityId: string; grantId: string;
    herbloreLevel: number; evidenceDigest: string;
}
export interface HealthTreatmentAuthority {
    receipt(receiptId: string): HealthTreatmentReceipt | null;
    skill(id: string, version: string): RegisteredSkill | null;
    run(runId: string): SkillRunResult | null;
    facilityCatalog: FacilityCapabilityCatalog;
    grants: readonly FacilityAccessGrantEvidence[];
    verifyGrant(grant: FacilityAccessGrantEvidence): boolean;
}
export function verifyHealthTreatment(context: HealthContext, receiptId: string,
    authority: HealthTreatmentAuthority): HealthTreatmentReceipt {
    healthKey(receiptId);
    const receipt = authority.receipt(receiptId);
    if (!receipt || receipt.receiptId !== receiptId || receipt.patientAgentId !== context.member.agentId) {
        throw new Error('Health treatment requires authoritative patient-bound completion evidence');
    }
    const { evidenceDigest, ...facts } = receipt;
    if (healthDigest(facts) !== evidenceDigest) throw new Error('Health treatment receipt digest is invalid');
    if (receipt.clockId !== context.clock.clockId || receipt.clockProfileDigest !== context.clock.profileDigest
        || receipt.healthPolicyDigest !== context.policy.digest || receipt.membershipSourceDigest !== context.member.sourceResultDigest) {
        throw new Error('Health treatment clock/policy/membership binding is invalid');
    }
    const treatment = context.policy.treatments.find(item => item.treatmentId === receipt.treatmentId);
    if (!treatment) throw new Error('Health treatment is not configured/verified');
    const completed = healthTime(receipt.completedAtSimulationTime);
    if (completed > healthTime(context.clock.simulationTime) || completed < healthTime(context.member.joinedAtSimulationTime)
        || !Number.isInteger(receipt.herbloreLevel) || receipt.herbloreLevel < treatment.minimumHerbloreLevel
        || receipt.herbloreLevel > 99) throw new Error('Health treatment competence/time evidence is invalid');
    const skill = authority.skill(treatment.skill.id, treatment.skill.version), run = authority.run(receipt.runId);
    if (!skill || skill.definition.status !== 'verified' || skill.checksum !== treatment.skill.checksum
        || skill.definition.id !== treatment.skill.id || skill.definition.version !== treatment.skill.version
        || !run || run.runId !== receipt.runId || run.status !== 'completed' || run.username !== receipt.practitionerUsername
        || run.skill.id !== treatment.skill.id || run.skill.version !== treatment.skill.version
        || run.parameters?.['patient-agent-id'] !== receipt.patientAgentId || run.parameters?.['injury-id'] !== receipt.injuryId) {
        throw new Error('Health treatment requires an exact verified completed skill run');
    }
    const authorization = authorizeFacilityCapability(authority.facilityCatalog,
        { subjectAgentId: receipt.practitionerAgentId, facilityId: receipt.facilityId,
            capabilityId: treatment.capabilityId, at: receipt.completedAtSimulationTime }, authority.grants,
        grant => grant.grantId === receipt.grantId && authority.verifyGrant(grant));
    if (authorization.grantId !== receipt.grantId) throw new Error('Health treatment facility binding is invalid');
    return structuredClone(receipt);
}
