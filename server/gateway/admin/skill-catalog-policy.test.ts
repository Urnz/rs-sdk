import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLearningStore } from '../../../agent-skills/learning.js';
import { PolicySkillStore } from '../../../agent-skills/policy-store.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { listAdminSkillsForAgent, resolveAdminSkillForAgent } from './skill-catalog.js';
import { createAdminAgent, listAdminAgents } from './agent-state.js';
import { learnAdminSkill } from './skill-learning.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'rs-admin-policy-catalog-'));
    directories.push(directory);
    const policyRoot = join(directory, 'policy');
    const learningPath = join(directory, 'learning.json');
    const base = JSON.parse(await readFile(join(process.cwd(), 'agent-skills', 'catalog',
        'mining.varrock-east.copper-to-bank@1.0.0.skill.json'), 'utf8')) as SkillDefinition;
    const definition = (id: string): SkillDefinition => ({ ...structuredClone(base), id, name: id });
    const policies = new PolicySkillStore(policyRoot);
    await policies.save(definition('policy.public-admin'), { kind: 'public' }, {
        actorKind: 'human', actorId: 'author', subject: { agentId: 'author' }
    });
    await policies.save(definition('policy.guild-admin'), { kind: 'organization', organizationId: 'miners' }, {
        actorKind: 'human', actorId: 'author', subject: { agentId: 'author', organizationIds: ['miners'] }
    });
    return { policyRoot, learningPath };
}

describe('agent-scoped admin policy catalog', () => {
    test('loads public policy skills but never opens an organization catalog without its exact grant', async () => {
        const paths = await fixture();
        const before = await listAdminSkillsForAgent('student', paths);
        expect(before.find(skill => skill.id === 'policy.public-admin')).toMatchObject({ policy: { kind: 'public' } });
        expect(before.some(skill => skill.id === 'policy.guild-admin')).toBeFalse();
        await expect(resolveAdminSkillForAgent('policy.guild-admin@1.0.0', 'student', paths)).rejects.toThrow();

        const learning = new SkillLearningStore(paths.learningPath);
        const membership = await learning.grant({ externalKey: 'membership:student:miners',
            kind: 'organization-membership', agentId: 'student', resourceId: 'miners', grantedBy: 'admin'
        }, '2026-08-30T13:00:00.000Z');
        const after = await listAdminSkillsForAgent('student', { ...paths, at: '2026-08-30T13:01:00.000Z' });
        expect(after.find(skill => skill.id === 'policy.guild-admin')).toMatchObject({
            policy: { kind: 'organization', organizationId: 'miners' }
        });
        await expect(resolveAdminSkillForAgent('policy.guild-admin@1.0.0', 'student', {
            ...paths, at: '2026-08-30T13:01:00.000Z'
        })).resolves.toMatchObject({ policy: { kind: 'organization', organizationId: 'miners' } });

        const agentPath = join(paths.policyRoot, '..', 'agents.sqlite');
        createAdminAgent({ agentId: 'student', playerUsername: 'Student', displayName: 'Student',
            background: 'Policy catalog test agent.', personalityTraits: ['careful'] }, agentPath);
        const view = await listAdminAgents(agentPath, { skillCatalog: {
            ...paths, at: '2026-08-30T13:01:00.000Z'
        } });
        expect(view.agents[0]?.skillRelationships.find(item => item.reference.id === 'policy.guild-admin'))
            .toMatchObject({ access: 'accessible', knowledge: 'unlearned', executable: false,
                policy: { kind: 'organization', organizationId: 'miners' } });
        expect(view.agents[0]?.catalogSkills.some(skill => skill.id === 'policy.guild-admin')).toBeTrue();

        const candidate = await resolveAdminSkillForAgent('policy.guild-admin@1.0.0', 'student', {
            ...paths, at: '2026-08-30T13:02:00.000Z'
        });
        await learnAdminSkill('student', candidate.definition, { agentPath, learningPath: paths.learningPath,
            policy: candidate.policy, now: '2026-08-30T13:02:00.000Z' });
        const learned = await listAdminAgents(agentPath, { skillCatalog: {
            ...paths, at: '2026-08-30T13:03:00.000Z'
        } });
        expect(learned.agents[0]?.skillRelationships.find(item => item.reference.id === 'policy.guild-admin'))
            .toMatchObject({ knowledge: 'known', executable: true });

        await learning.revoke(membership.grant.grantId, membership.grant.revision, 'Membership ended.',
            '2026-08-30T13:04:00.000Z');
        const revoked = await listAdminAgents(agentPath, { skillCatalog: {
            ...paths, at: '2026-08-30T13:05:00.000Z'
        } });
        expect(revoked.agents[0]?.knownSkills).toHaveLength(1);
        expect(revoked.agents[0]?.skillRelationships.some(item => item.reference.id === 'policy.guild-admin')).toBeFalse();
        expect(revoked.agents[0]?.catalogSkills.some(skill => skill.id === 'policy.guild-admin')).toBeFalse();
    });
});
