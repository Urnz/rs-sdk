import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLearningStore } from '../learning.js';

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function store(): Promise<{ path: string; learning: SkillLearningStore }> {
    const root = await mkdtemp(join(tmpdir(), 'rs-skill-learning-'));
    roots.push(root);
    const path = join(root, 'learning.json');
    return { path, learning: new SkillLearningStore(path) };
}

describe('durable skill learning and grant lifecycle', () => {
    test('records an idempotent organization learning event backed by an active grant', async () => {
        const { path, learning } = await store();
        const granted = await learning.grant({ externalKey: 'membership:alice:miners',
            kind: 'organization-membership', agentId: 'alice', resourceId: 'miners', grantedBy: 'admin',
            validFrom: '2026-08-30T10:00:00.000Z' }, '2026-08-30T10:00:00.000Z');
        const first = await learning.learn({ externalKey: 'learning:alice:copper', agentId: 'alice',
            skill: { id: 'mining.copper', version: '1.0.0' },
            policy: { kind: 'organization', organizationId: 'miners' },
            occurredAt: '2026-08-30T10:01:00.000Z' }, '2026-08-30T10:01:01.000Z');
        const duplicate = await learning.learn({ externalKey: 'learning:alice:copper', agentId: 'alice',
            skill: { id: 'mining.copper', version: '1.0.0' },
            policy: { kind: 'organization', organizationId: 'miners' },
            occurredAt: '2026-08-30T10:01:00.000Z' });
        expect(granted.created).toBeTrue();
        expect(first).toMatchObject({ created: true, event: { learningMode: 'organization-training',
            supportingGrantId: granted.grant.grantId } });
        expect(duplicate).toMatchObject({ created: false, event: { eventId: first.event.eventId } });
        await expect(learning.learn({ externalKey: 'learning:alice:copper', agentId: 'alice',
            skill: { id: 'mining.copper', version: '1.0.0' }, policy: { kind: 'public' },
            occurredAt: '2026-08-30T10:01:00.000Z' })).rejects.toThrow('external key collision');
        expect((await new SkillLearningStore(path).listEvents('alice'))).toHaveLength(1);
    });

    test('revocation is optimistic and prevents future learning while preserving history', async () => {
        const { learning } = await store();
        const grant = (await learning.grant({ externalKey: 'license:bob:smith', kind: 'license',
            agentId: 'bob', resourceId: 'smith-1', grantedBy: 'guild' }, '2026-08-30T10:00:00.000Z')).grant;
        await learning.learn({ externalKey: 'learning:bob:smith', agentId: 'bob',
            skill: { id: 'smith.bronze', version: '1.0.0' }, policy: { kind: 'licensed', licenseId: 'smith-1' },
            occurredAt: '2026-08-30T10:05:00.000Z' });
        const revoked = await learning.revoke(grant.grantId, grant.revision, 'Licence expired.',
            '2026-08-30T10:10:00.000Z');
        expect(revoked).toMatchObject({ revision: 2, revokeReason: 'Licence expired.' });
        await expect(learning.revoke(grant.grantId, grant.revision, 'Again.')).rejects.toThrow('changed');
        await expect(learning.learn({ externalKey: 'learning:bob:smith-advanced', agentId: 'bob',
            skill: { id: 'smith.iron', version: '1.0.0' }, policy: { kind: 'licensed', licenseId: 'smith-1' },
            occurredAt: '2026-08-30T10:11:00.000Z' })).rejects.toThrow('not allowed');
        expect(await learning.listEvents('bob')).toHaveLength(1);
        expect((await learning.accessSubject('bob', '2026-08-30T10:11:00.000Z')).licenseIds).toEqual([]);
    });

    test('derives teacher grants and validity windows without granting unrelated access', async () => {
        const { learning } = await store();
        await learning.grant({ externalKey: 'teacher:student:master', kind: 'teacher-relationship',
            agentId: 'student', resourceId: 'master', grantedBy: 'admin',
            validFrom: '2026-08-30T10:00:00.000Z', validUntil: '2026-08-30T11:00:00.000Z' });
        expect(await learning.accessSubject('student', '2026-08-30T10:30:00.000Z')).toMatchObject({
            teacherAgentIds: ['master'], organizationIds: [], licenseIds: []
        });
        await expect(learning.learn({ externalKey: 'learning:student:late', agentId: 'student',
            skill: { id: 'route.secret', version: '1.0.0' },
            policy: { kind: 'teachable', teacherAgentId: 'master' },
            occurredAt: '2026-08-30T11:00:00.000Z' })).rejects.toThrow('not allowed');
        const publicLearning = await learning.learn({ externalKey: 'learning:student:public', agentId: 'student',
            skill: { id: 'route.public', version: '1.0.0' }, policy: { kind: 'public' },
            occurredAt: '2026-08-30T11:00:00.000Z' });
        expect(publicLearning.event).toMatchObject({ learningMode: 'self-study', supportingGrantId: null });
    });
});
