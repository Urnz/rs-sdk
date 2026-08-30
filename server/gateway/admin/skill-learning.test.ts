import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import { createAdminSkillGrant, learnAdminSkill, listAdminSkillLearning, revokeAdminSkillGrant } from './skill-learning.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';

const directories: string[] = [];

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'rs-admin-skill-learning-'));
    directories.push(directory);
    const agentPath = join(directory, 'agents.sqlite');
    const learningPath = join(directory, 'learning.json');
    const agents = new AgentStateStore(agentPath);
    agents.createIdentity({ agentId: 'student', playerUsername: 'Student', displayName: 'Student',
        background: 'Learns tested skills.', personalityTraits: ['careful'] });
    agents.close();
    return { agentPath, learningPath };
}

function skill(): SkillDefinition {
    return {
        schemaVersion: 1, id: 'mining.copper', version: '1.0.0', name: 'Mine copper',
        description: 'Mines and banks copper.', status: 'verified', tags: ['mining'], parameters: {},
        preconditions: [], steps: [],
        limits: { maxOperations: 10, timeoutMs: 60_000 },
        sharing: { visibility: 'shared' },
        provenance: { authorKind: 'human', authorId: 'admin', createdAt: '2026-08-30T09:00:00.000Z' }
    };
}

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('admin skill grant lifecycle', () => {
    test('creates, lists and optimistically revokes an audited grant', async () => {
        const paths = await fixture();
        const created = await createAdminSkillGrant({ agentId: 'student', kind: 'organization-membership',
            resourceId: 'miners-guild', externalKey: 'admin:test-membership' }, {
            ...paths, now: '2026-08-30T10:00:00.000Z'
        });
        expect(created).toMatchObject({ created: true, grant: { agentId: 'student', resourceId: 'miners-guild',
            grantedBy: 'local-admin', revision: 1 } });
        expect((await listAdminSkillLearning(paths.learningPath, '2026-08-30T10:01:00.000Z')).grants[0])
            .toMatchObject({ active: true });

        const revoked = await revokeAdminSkillGrant(created.grant.grantId, 1, 'Training ended.',
            paths.learningPath, '2026-08-30T10:02:00.000Z');
        expect(revoked).toMatchObject({ revision: 2, revokeReason: 'Training ended.' });
        expect((await listAdminSkillLearning(paths.learningPath, '2026-08-30T10:03:00.000Z')).grants[0])
            .toMatchObject({ active: false });
    });

    test('rejects grants for an unknown agent before writing the learning ledger', async () => {
        const paths = await fixture();
        await expect(createAdminSkillGrant({ agentId: 'missing', kind: 'license', resourceId: 'smithing' }, paths))
            .rejects.toThrow('létező persistent agenthez');
        expect((await listAdminSkillLearning(paths.learningPath)).grants).toEqual([]);
    });

    test('records catalog learning and reconciles AgentState idempotently', async () => {
        const paths = await fixture();
        const first = await learnAdminSkill('student', skill(), { ...paths, now: '2026-08-30T11:00:00.000Z' });
        const repeated = await learnAdminSkill('student', skill(), { ...paths, now: '2026-08-30T11:05:00.000Z' });

        expect(first).toMatchObject({ created: true, knowledgeCreated: true,
            event: { learningMode: 'self-study' }, knowledge: { status: 'known' } });
        expect(repeated).toMatchObject({ created: false, knowledgeCreated: false,
            event: { eventId: first.event.eventId } });
        expect((await listAdminSkillLearning(paths.learningPath)).events).toHaveLength(1);
        const agents = new AgentStateStore(paths.agentPath);
        expect(agents.getSnapshot('student')?.knownSkills).toEqual([expect.objectContaining({
            skill: { id: 'mining.copper', version: '1.0.0' }, status: 'known'
        })]);
        agents.close();
    });

    test('coalesces concurrent learning into one event and one AgentState record', async () => {
        const paths = await fixture();
        const results = await Promise.all(Array.from({ length: 8 }, () => learnAdminSkill('student', skill(), {
            ...paths, now: '2026-08-30T11:30:00.000Z'
        })));
        expect(results.filter(result => result.created)).toHaveLength(1);
        expect(results.filter(result => result.knowledgeCreated)).toHaveLength(1);
        expect(new Set(results.map(result => result.event.eventId)).size).toBe(1);
        expect((await listAdminSkillLearning(paths.learningPath)).events).toHaveLength(1);
    });

    test('requires the exact active grant and respects an explicit skill block', async () => {
        const paths = await fixture();
        await expect(learnAdminSkill('student', skill(), { ...paths, policy: {
            kind: 'organization', organizationId: 'miners-guild'
        }, now: '2026-08-30T12:00:00.000Z' })).rejects.toThrow('not allowed');
        await createAdminSkillGrant({ agentId: 'student', kind: 'organization-membership',
            resourceId: 'miners-guild', externalKey: 'admin:miners' }, { ...paths,
            now: '2026-08-30T12:01:00.000Z' });
        await expect(learnAdminSkill('student', skill(), { ...paths, policy: {
            kind: 'organization', organizationId: 'miners-guild'
        }, now: '2026-08-30T12:02:00.000Z' })).resolves.toMatchObject({
            event: { learningMode: 'organization-training', supportingGrantId: expect.any(String) }
        });

        const agents = new AgentStateStore(paths.agentPath);
        const known = agents.getSnapshot('student')!.knownSkills[0]!;
        agents.setSkillKnowledge('student', known.skill, 'blocked', known.revision);
        agents.close();
        await expect(learnAdminSkill('student', skill(), { ...paths, now: '2026-08-30T12:03:00.000Z' }))
            .rejects.toThrow('blokkolt');
    });
});
