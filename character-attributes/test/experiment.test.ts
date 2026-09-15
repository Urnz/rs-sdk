import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSkillPotentialProfile, loadSkillCapPolicyCatalog, loadSkillPotentialPolicyCatalog,
    runSkillPotentialExperiment, validateAttributeProfile, type SkillPotentialExperimentDefinition } from '../index.js';

const config = (name: string) => join(import.meta.dir, '..', '..', 'config', name);

function profile(id: string, attributeValue: number) {
    const attributes = validateAttributeProfile({ schemaVersion: 1, profileId: `attribute:${id}:profile`,
        version: '1.0.0', characterAgentId: id, lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
        source: { origin: 'human-allocation', policyId: 'test', policyVersion: '1.0.0', seedDigest: null },
        scale: { minimum: 0, maximum: 10 }, values: { intellect: attributeValue, dexterity: attributeValue,
            vigor: attributeValue, endurance: attributeValue, perception: attributeValue, will: attributeValue } });
    const policy = loadSkillPotentialPolicyCatalog(config('skill-potential-policies.json')).policies[0]!;
    return createSkillPotentialProfile(attributes, policy);
}

function policy(kind: 'attribute-hard-cap' | 'attribute-soft-cap' = 'attribute-hard-cap') {
    return loadSkillCapPolicyCatalog(config('skill-cap-policies.json')).policies
        .find(candidate => candidate.kind === kind)!;
}

function definition(): SkillPotentialExperimentDefinition {
    const treatment = policy();
    return { schemaVersion: 1, experimentId: 'potential-learning-paired', version: '1.0.0',
        treatmentPolicy: { policyId: treatment.policyId, version: treatment.version, digest: treatment.digest },
        events: [
            { eventId: 'fishing-20', skillId: 'fishing', baseXp: 80, currentLevel: 20 },
            { eventId: 'fishing-40', skillId: 'fishing', baseXp: 80, currentLevel: 40 }
        ] };
}

describe('skill potential control-treatment experiment', () => {
    test('replays identical workloads and exposes aptitude-dependent treatment outcomes', () => {
        const report = runSkillPotentialExperiment(definition(), [
            { participantId: 'low', profile: profile('low', 0) },
            { participantId: 'high', profile: profile('high', 10) }
        ], policy());
        const summary = (id: string, arm: string) => report.summaries
            .find(item => item.participantId === id && item.arm === arm)!;
        expect(summary('low', 'control-vanilla')).toMatchObject({ awards: 2, baseXp: 160, grantedXp: 160 });
        expect(summary('high', 'control-vanilla')).toMatchObject({ awards: 2, baseXp: 160, grantedXp: 160 });
        expect(summary('low', 'treatment-potential')).toMatchObject({ grantedXp: 60,
            adjustedXp: -100, blockedAwards: 1 });
        expect(summary('high', 'treatment-potential')).toMatchObject({ grantedXp: 200,
            adjustedXp: 40, blockedAwards: 0 });
        expect(report.telemetry).toHaveLength(8);
    });

    test('is byte-for-byte deterministic for the same profiles, policy and events', () => {
        const participants = [{ participantId: 'neutral', profile: profile('neutral', 5) }];
        expect(runSkillPotentialExperiment(definition(), participants, policy()))
            .toEqual(runSkillPotentialExperiment(definition(), participants, policy()));
    });

    test('measures soft-cap exposure independently from hard-cap blocks', () => {
        const treatment = policy('attribute-soft-cap');
        const input = definition();
        input.treatmentPolicy = { policyId: treatment.policyId, version: treatment.version, digest: treatment.digest };
        input.events = [{ eventId: 'fishing-70', skillId: 'fishing', baseXp: 80, currentLevel: 70 }];
        const report = runSkillPotentialExperiment(input,
            [{ participantId: 'neutral', profile: profile('neutral', 5) }], treatment);
        expect(report.summaries.find(item => item.arm === 'treatment-potential')).toMatchObject({
            baseXp: 80, grantedXp: 20, adjustedXp: -60, blockedAwards: 0, softCappedAwards: 1
        });
    });

    test('rejects unpaired ambiguity, non-target skills and changed policy evidence', () => {
        const input = definition();
        input.events = [{ eventId: 'woodcutting', skillId: 'woodcutting' as never, baseXp: 10, currentLevel: 1 }];
        expect(() => runSkillPotentialExperiment(input,
            [{ participantId: 'one', profile: profile('one', 5) }], policy())).toThrow('not potential-enabled');
        const duplicate = definition();
        duplicate.events.push({ ...duplicate.events[0]! });
        expect(() => runSkillPotentialExperiment(duplicate,
            [{ participantId: 'one', profile: profile('one', 5) }], policy())).toThrow('duplicated');
        const changed = definition();
        changed.treatmentPolicy.digest = '0'.repeat(64);
        expect(() => runSkillPotentialExperiment(changed,
            [{ participantId: 'one', profile: profile('one', 5) }], policy())).toThrow('does not match');
        expect(() => runSkillPotentialExperiment(definition(), [], policy())).toThrow('1-1000 participants');
    });
});
