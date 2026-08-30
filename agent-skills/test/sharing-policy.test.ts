import { describe, expect, test } from 'bun:test';
import { decideSkillPolicy, validateSkillSharingPolicy } from '../sharing-policy.js';

describe('fail-closed skill sharing policy', () => {
    test('distinguishes common knowledge and public self-study without auto-learning either', () => {
        expect(decideSkillPolicy({ kind: 'common' }, { agentId: 'newcomer' })).toMatchObject({
            accessible: true, learningEligible: true, learningMode: 'common-knowledge'
        });
        expect(decideSkillPolicy({ kind: 'public' }, { agentId: 'newcomer' })).toMatchObject({
            accessible: true, learningEligible: true, learningMode: 'self-study'
        });
    });

    test('requires exact organization, teacher, and license grants', () => {
        expect(decideSkillPolicy({ kind: 'organization', organizationId: 'miners-guild' },
            { agentId: 'miner', organizationIds: [] })).toMatchObject({ discoverable: false, accessible: false });
        expect(decideSkillPolicy({ kind: 'organization', organizationId: 'miners-guild' },
            { agentId: 'miner', organizationIds: ['Miners-Guild'] })).toMatchObject({
            accessible: true, learningMode: 'organization-training'
        });
        expect(decideSkillPolicy({ kind: 'teachable', teacherAgentId: 'master-a' },
            { agentId: 'student' })).toMatchObject({ discoverable: true, accessible: false });
        expect(decideSkillPolicy({ kind: 'teachable', teacherAgentId: 'master-a' },
            { agentId: 'student', teacherAgentIds: ['master-a'] })).toMatchObject({
            accessible: true, learningMode: 'teacher-training'
        });
        expect(decideSkillPolicy({ kind: 'licensed', licenseId: 'smithing-licence' },
            { agentId: 'smith', licenseIds: ['other'] })).toMatchObject({ accessible: false });
        expect(decideSkillPolicy({ kind: 'licensed', licenseId: 'smithing-licence' },
            { agentId: 'smith', licenseIds: ['smithing-licence'] })).toMatchObject({
            accessible: true, learningMode: 'licensed-use'
        });
    });

    test('keeps private and isolated skills unavailable while always allowing their author', () => {
        expect(decideSkillPolicy({ kind: 'private', ownerAgentId: 'owner' }, { agentId: 'other' }))
            .toMatchObject({ discoverable: false, accessible: false, learningEligible: false });
        expect(decideSkillPolicy({ kind: 'public' }, { agentId: 'other', isolatedDiscovery: true }))
            .toMatchObject({ discoverable: false, accessible: false, learningMode: 'unavailable' });
        expect(decideSkillPolicy({ kind: 'private', ownerAgentId: 'owner' }, { agentId: 'owner' }, 'owner'))
            .toMatchObject({ accessible: true, learningMode: 'author-knowledge' });
        expect(() => validateSkillSharingPolicy({ kind: 'licensed', licenseId: '../escape' }))
            .toThrow('unsupported characters');
    });
});
