import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import { PolicySkillStore } from '../../../agent-skills/policy-store.js';
import { SkillLearningStore } from '../../../agent-skills/learning.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { resolveLearnAndPlan } from './deterministic-learning.js';
import { listAdminSkillsForAgent } from './skill-catalog.js';
import { listAdminSkillLearning } from './skill-learning.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture(policy: 'public' | 'organization' = 'public') {
    const root = await mkdtemp(join(tmpdir(), 'rs-deterministic-learning-'));
    directories.push(root);
    const agentPath = join(root, 'agents.sqlite');
    const policyRoot = join(root, 'policy');
    const learningPath = join(root, 'learning.json');
    const base = JSON.parse(await readFile(join(process.cwd(), 'agent-skills', 'catalog',
        'mining.varrock-east.copper-to-bank@1.0.0.skill.json'), 'utf8')) as SkillDefinition;
    const definition = { ...structuredClone(base), id: 'craft.mooncloth', name: 'Weave mooncloth',
        description: 'Weave mooncloth at the lunar loom.', tags: ['mooncloth', 'weaving'] };
    const store = new PolicySkillStore(policyRoot);
    await store.save(definition, policy === 'public' ? { kind: 'public' }
        : { kind: 'organization', organizationId: 'weavers' }, {
        actorKind: 'human', actorId: 'author', subject: { agentId: 'author',
            ...(policy === 'organization' ? { organizationIds: ['weavers'] } : {}) }
    });
    const agents = new AgentStateStore(agentPath);
    agents.createIdentity({ agentId: 'student', playerUsername: 'Student', displayName: 'Student',
        background: 'Learns deterministic work.', personalityTraits: ['careful'] });
    const life = agents.createGoal('student', { goalId: 'life', horizon: 'life', title: 'Master a trade' });
    const long = agents.createGoal('student', { goalId: 'long', parentGoalId: life.goalId,
        horizon: 'long-term', title: 'Become a weaver' });
    const current = agents.createGoal('student', { goalId: 'current', parentGoalId: long.goalId,
        horizon: 'current', title: 'Learn lunar weaving' });
    const goal = agents.createGoal('student', { goalId: 'now', parentGoalId: current.goalId,
        horizon: 'immediate', title: 'Weave mooncloth', description: 'Use the lunar loom.', priority: 90 });
    agents.setWorkingMemory('student', null, { summary: 'Ready at the loom.',
        observedAt: '2026-08-30T14:00:00.000Z' });
    agents.close();
    return { agentPath, policyRoot, learningPath, goal };
}

describe('LLM-free deterministic skill learning', () => {
    test('learns one unambiguous public match, assigns it to the goal and returns an execution decision', async () => {
        const paths = await fixture();
        const catalog = await listAdminSkillsForAgent('student', { ...paths, at: '2026-08-30T14:01:00.000Z' });
        const result = await resolveLearnAndPlan('student', paths.goal, catalog, [], {
            agentPath: paths.agentPath, catalog: paths, now: '2026-08-30T14:01:00.000Z'
        });
        expect(result).toMatchObject({ learned: true, assigned: true,
            resolution: { skill: { id: 'craft.mooncloth' }, requiresLearning: true },
            decision: { kind: 'execute-skill', goalId: 'now', skill: { id: 'craft.mooncloth' } } });
        expect((await listAdminSkillLearning(paths.learningPath)).events).toHaveLength(1);
    });

    test('does not auto-learn an organization skill even when it is visible through a grant', async () => {
        const paths = await fixture('organization');
        const learning = new SkillLearningStore(paths.learningPath);
        await learning.grant({ externalKey: 'membership:student:weavers', kind: 'organization-membership',
            agentId: 'student', resourceId: 'weavers', grantedBy: 'admin' }, '2026-08-30T14:00:30.000Z');
        const catalog = await listAdminSkillsForAgent('student', { ...paths, at: '2026-08-30T14:01:00.000Z' });
        expect(catalog.some(skill => skill.id === 'craft.mooncloth')).toBeTrue();
        expect(await resolveLearnAndPlan('student', paths.goal, catalog, [], {
            agentPath: paths.agentPath, catalog: paths, now: '2026-08-30T14:01:00.000Z'
        })).toBeNull();
        expect((await listAdminSkillLearning(paths.learningPath)).events).toEqual([]);
    });
});
