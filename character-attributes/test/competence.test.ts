import { describe, expect, test } from 'bun:test';
import { satisfiesCompetence, validateCompetenceSnapshot } from '../index.js';

const checksum = 'a'.repeat(64);

function definition(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        snapshotId: 'competence:ada:42',
        characterAgentId: 'ada',
        observedAtSimulationTime: '2026-09-15T12:00:00.000Z',
        personalSkills: [{ kind: 'personal-rs-skill', characterAgentId: 'ada', skillId: 'fishing', level: 42 }],
        learnedProcedures: [{ kind: 'verified-agent-skill', characterAgentId: 'ada',
            skill: { id: 'fishing', version: '1.2.0', checksum },
            learnedAtSimulationTime: '2026-09-15T11:00:00.000Z', status: 'verified', executable: true }],
        providedCapabilities: [{ kind: 'provided-capability', characterAgentId: 'ada',
            capabilityId: 'fishing', provider: { kind: 'facility', providerId: 'dock-1' }, grantId: 'grant-1' }]
    };
}

describe('separate competence namespaces', () => {
    test('keeps personal levels, learned procedures and provided capabilities independently queryable', () => {
        const snapshot = validateCompetenceSnapshot(definition());
        expect(snapshot.personalSkills[0]!.level).toBe(42);
        expect(satisfiesCompetence(snapshot, {
            kind: 'personal-rs-skill', skillId: 'fishing', minimumLevel: 40
        })).toBeTrue();
        expect(satisfiesCompetence(snapshot, {
            kind: 'verified-agent-skill', skill: { id: 'fishing', version: '1.2.0', checksum }
        })).toBeTrue();
        expect(satisfiesCompetence(snapshot, {
            kind: 'provided-capability', capabilityId: 'fishing',
            provider: { kind: 'facility', providerId: 'dock-1' }
        })).toBeTrue();
    });

    test('does not let one competence kind satisfy another kind of requirement', () => {
        const value = definition();
        value.personalSkills = [];
        const snapshot = validateCompetenceSnapshot(value);
        expect(satisfiesCompetence(snapshot, {
            kind: 'personal-rs-skill', skillId: 'fishing', minimumLevel: 1
        })).toBeFalse();
        expect(satisfiesCompetence(snapshot, {
            kind: 'verified-agent-skill', skill: { id: 'fishing', version: '1.2.1', checksum }
        })).toBeFalse();
        expect(satisfiesCompetence(snapshot, {
            kind: 'provided-capability', capabilityId: 'fishing',
            provider: { kind: 'organization', providerId: 'dock-1' }
        })).toBeFalse();
    });

    test('enforces the personal RuneScape level range', () => {
        for (const level of [0, 100, 1.5]) {
            const value = definition();
            value.personalSkills = [{ kind: 'personal-rs-skill', characterAgentId: 'ada',
                skillId: 'fishing', level }];
            expect(() => validateCompetenceSnapshot(value)).toThrow('integer between 1 and 99');
        }
    });

    test('accepts only learned, verified, executable procedures with exact immutable identity', () => {
        const unverified = definition();
        unverified.learnedProcedures = [{ kind: 'verified-agent-skill', characterAgentId: 'ada',
            skill: { id: 'fishing', version: '1.2.0', checksum },
            learnedAtSimulationTime: '2026-09-15T11:00:00.000Z', status: 'draft', executable: true }];
        expect(() => validateCompetenceSnapshot(unverified)).toThrow('verified executable');
        const invalidChecksum = definition();
        invalidChecksum.learnedProcedures = [{ kind: 'verified-agent-skill', characterAgentId: 'ada',
            skill: { id: 'fishing', version: '1.2.0', checksum: 'invalid' },
            learnedAtSimulationTime: '2026-09-15T11:00:00.000Z', status: 'verified', executable: true }];
        expect(() => validateCompetenceSnapshot(invalidChecksum)).toThrow('lowercase SHA-256');
    });

    test('rejects foreign ownership, duplicates and cross-concept fields', () => {
        const foreign = definition();
        foreign.providedCapabilities = [{ kind: 'provided-capability', characterAgentId: 'grace',
            capabilityId: 'fishing', provider: { kind: 'facility', providerId: 'dock-1' }, grantId: 'grant-1' }];
        expect(() => validateCompetenceSnapshot(foreign)).toThrow('belongs to another character');
        const duplicate = definition();
        duplicate.personalSkills = [...duplicate.personalSkills as unknown[],
            ...duplicate.personalSkills as unknown[]];
        expect(() => validateCompetenceSnapshot(duplicate)).toThrow('identities must be unique');
        const mixed = definition();
        mixed.personalSkills = [{ kind: 'personal-rs-skill', characterAgentId: 'ada', skillId: 'fishing',
            level: 42, provider: { kind: 'facility', providerId: 'dock-1' } }];
        expect(() => validateCompetenceSnapshot(mixed)).toThrow('fields are invalid');
    });
});
