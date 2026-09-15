import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { evaluateSkillIntroductionGate, loadSkillIntroductionGatePolicyCatalog,
    type NewPersonalSkillProposal } from '../index.js';

const policyPath = join(import.meta.dir, '..', '..', 'config', 'skill-introduction-gate-policies.json');
const checksum = 'a'.repeat(64);

function policy() {
    return loadSkillIntroductionGatePolicyCatalog(policyPath).policies[0]!;
}

function proposal(): NewPersonalSkillProposal {
    return { schemaVersion: 1, proposalId: 'proposal-engineering', proposedSkillId: 'engineering', version: '1.0.0',
        requirements: [
            { requirementId: 'material-knowledge', description: 'Understand and select suitable materials.' },
            { requirementId: 'repeatable-assembly', description: 'Execute a repeatable assembly procedure.' },
            { requirementId: 'precision-workspace', description: 'Use calibrated precision infrastructure.' }
        ],
        alternatives: {
            personalSkills: [{ skillId: 'smithing', minimumLevel: 50, covers: ['material-knowledge'] }],
            verifiedProcedures: [{ skill: { id: 'assemble-device', version: '1.0.0', checksum },
                covers: ['repeatable-assembly'] }],
            providedCapabilities: [{ capabilityId: 'precision-workshop', providerKind: 'facility',
                covers: ['precision-workspace'] }]
        },
        gapEvidence: [] };
}

describe('new personal skill decision gate', () => {
    test('prefers existing skill, procedure and facility composition when it covers every requirement', () => {
        const decision = evaluateSkillIntroductionGate(proposal(), policy());
        expect(decision).toMatchObject({ outcome: 'use-existing-composition', mayIntroducePersonalSkill: false,
            coveredRequirementIds: ['material-knowledge', 'repeatable-assembly', 'precision-workspace'],
            uncoveredRequirementIds: [] });
        expect(decision.reasons[0]).toContain('Every requirement is covered');
    });

    test('requires independent and experimental evidence for every uncovered modeling gap', () => {
        const value = proposal();
        value.alternatives.providedCapabilities = [];
        value.gapEvidence = [{ evidenceId: 'analysis-1', requirementId: 'precision-workspace',
            source: 'domain-analysis', sourceDigest: 'b'.repeat(64), finding: 'Existing facilities lack calibration.' }];
        const decision = evaluateSkillIntroductionGate(value, policy());
        expect(decision).toMatchObject({ outcome: 'evidence-required', mayIntroducePersonalSkill: false,
            uncoveredRequirementIds: ['precision-workspace'] });
        expect(decision.reasons.join(' ')).toContain('lacks 2 independent');
        expect(decision.reasons.join(' ')).toContain('lacks experiment evidence');
    });

    test('justifies only a candidate after sufficient evidence without creating the skill', () => {
        const value = proposal();
        value.alternatives.providedCapabilities = [];
        value.gapEvidence = [
            { evidenceId: 'analysis-1', requirementId: 'precision-workspace', source: 'domain-analysis',
                sourceDigest: 'b'.repeat(64), finding: 'Domain decomposition leaves calibration uncovered.' },
            { evidenceId: 'experiment-1', requirementId: 'precision-workspace', source: 'experiment',
                sourceDigest: 'c'.repeat(64), finding: 'Paired trial cannot reproduce precision through composition.' }
        ];
        const first = evaluateSkillIntroductionGate(value, policy());
        const second = evaluateSkillIntroductionGate(value, policy());
        expect(first).toEqual(second);
        expect(first).toMatchObject({ outcome: 'candidate-justified', mayIntroducePersonalSkill: true,
            uncoveredRequirementIds: ['precision-workspace'] });
        expect(first.proposal.proposedSkillId).toBe('engineering');
    });

    test('rejects unknown coverage, weak procedure evidence and changed policy evidence', () => {
        const unknown = proposal();
        unknown.alternatives.personalSkills[0]!.covers = ['missing-requirement'];
        expect(() => evaluateSkillIntroductionGate(unknown, policy())).toThrow('unknown requirement');
        const weak = proposal();
        weak.alternatives.verifiedProcedures[0]!.skill.checksum = 'not-verified';
        expect(() => evaluateSkillIntroductionGate(weak, policy())).toThrow('evidence is invalid');
        expect(() => evaluateSkillIntroductionGate(proposal(), { ...policy(), digest: '0'.repeat(64) }))
            .toThrow('digest does not match');
    });
});
