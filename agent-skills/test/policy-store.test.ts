import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolicySkillStore } from '../policy-store.js';
import { SkillLibrary } from '../library.js';
import { SkillRegistry } from '../registry.js';
import { FileSkillStore } from '../store.js';
import type { SkillDefinition } from '../types.js';

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ root: string; store: PolicySkillStore; base: SkillDefinition }> {
    const root = await mkdtemp(join(tmpdir(), 'rs-policy-skills-'));
    roots.push(root);
    const base = JSON.parse(await readFile(join(process.cwd(), 'agent-skills', 'catalog',
        'mining.varrock-east.copper-to-bank@1.0.0.skill.json'), 'utf8')) as SkillDefinition;
    return { root, store: new PolicySkillStore(root), base };
}

function version(base: SkillDefinition, id: string): SkillDefinition {
    return { ...structuredClone(base), id, name: id };
}

describe('policy-specific skill persistence', () => {
    test('opens only directories derived from the exact subject grants', async () => {
        const { store, base } = await fixture();
        const alice = { actorKind: 'human' as const, actorId: 'alice', subject: { agentId: 'alice' } };
        await store.save(version(base, 'policy.public'), { kind: 'public' }, alice);
        await store.save(version(base, 'policy.common'), { kind: 'common' }, alice);
        await store.save(version(base, 'policy.guild'), { kind: 'organization', organizationId: 'miners' }, {
            ...alice, subject: { agentId: 'alice', organizationIds: ['miners'] }
        });
        await store.save(version(base, 'policy.taught'), { kind: 'teachable', teacherAgentId: 'master' }, {
            ...alice, subject: { agentId: 'alice', teacherAgentIds: ['master'] }
        });
        await store.save(version(base, 'policy.licensed'), { kind: 'licensed', licenseId: 'smith-1' }, {
            ...alice, subject: { agentId: 'alice', licenseIds: ['smith-1'] }
        });

        expect((await store.loadAccessibleTo({ agentId: 'bob' })).map(item => item.definition.id).sort())
            .toEqual(['policy.common', 'policy.public']);
        expect((await store.loadAccessibleTo({ agentId: 'bob', organizationIds: ['miners'] }))
            .map(item => item.definition.id)).toContain('policy.guild');
        expect((await store.loadAccessibleTo({ agentId: 'bob', teacherAgentIds: ['master'], licenseIds: ['smith-1'] }))
            .map(item => item.definition.id).sort()).toEqual([
                'policy.common', 'policy.licensed', 'policy.public', 'policy.taught'
            ]);
    });

    test('rejects unauthorized writes and keeps isolated discovery fail-closed', async () => {
        const { store, base } = await fixture();
        await expect(store.save(version(base, 'policy.denied'),
            { kind: 'organization', organizationId: 'guild' },
            { actorKind: 'human', actorId: 'outsider', subject: { agentId: 'outsider' } }))
            .rejects.toThrow('cannot save');
        await store.save(version(base, 'policy.public'), { kind: 'public' },
            { actorKind: 'human', actorId: 'alice', subject: { agentId: 'alice' } });
        expect(await store.loadAccessibleTo({ agentId: 'alice', isolatedDiscovery: true })).toEqual([]);
    });

    test('loads only an accessible policy catalog into the registry', async () => {
        const { root, store, base } = await fixture();
        await store.save(version(base, 'policy.public'), { kind: 'public' },
            { actorKind: 'human', actorId: 'alice', subject: { agentId: 'alice' } });
        await store.save(version(base, 'policy.guild'), { kind: 'organization', organizationId: 'guild' },
            { actorKind: 'human', actorId: 'alice', subject: { agentId: 'alice', organizationIds: ['guild'] } });
        const library = new SkillLibrary(new SkillRegistry(), new FileSkillStore(join(root, 'legacy-unused')));
        await library.loadPolicyCatalog(store, { agentId: 'bob' });
        expect(library.registry.getLatest('policy.public')).not.toBeNull();
        expect(library.registry.getLatest('policy.guild')).toBeNull();
    });
});
