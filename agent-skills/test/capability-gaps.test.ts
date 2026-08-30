import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CapabilityGapStore, resolveSkillForCapability, type SkillResolutionCandidate } from '../capability-gaps.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function store() {
    const root = await mkdtemp(join(tmpdir(), 'rs-capability-gaps-'));
    temporaryDirectories.push(root);
    const path = join(root, 'gaps.json');
    return { gaps: new CapabilityGapStore(path), path };
}

const skills: SkillResolutionCandidate[] = [{
    id: 'mining.varrock-east.copper-to-bank', version: '1.0.0', name: 'Varrock copper mining',
    description: 'Mine copper ore and deposit it in the Varrock East bank.',
    tags: ['mining', 'banking', 'copper'], status: 'verified', visibility: 'shared'
}, {
    id: 'fishing.karamja.lobster-to-bank', version: '1.0.0', name: 'Karamja lobster fishing',
    description: 'Catch lobsters and carry them to a bank.',
    tags: ['fishing', 'banking', 'lobster'], status: 'verified', visibility: 'shared'
}];

describe('capability gap registry', () => {
    test('deduplicates the same semantic gap across agents and counts each request', async () => {
        const { gaps } = await store();
        const first = await gaps.report({ agentId: 'miner1', goalId: 'earn-copper', title: 'Mine copper ore',
            description: 'Mine copper and bank the ore.', tags: ['mining', 'copper'] }, '2026-08-30T10:00:00.000Z');
        const second = await gaps.report({ agentId: 'miner2', goalId: 'earn-copper-too', title: 'MINE copper ore',
            description: 'Mine copper and bank the ore!', tags: ['copper', 'mining'] }, '2026-08-30T10:01:00.000Z');
        const third = await gaps.report({ agentId: 'miner1', goalId: 'earn-copper', title: 'Mine copper ore',
            description: 'Mine copper and bank the ore.', tags: ['mining', 'copper'] }, '2026-08-30T10:02:00.000Z');

        expect(first.created).toBeTrue();
        expect(second).toMatchObject({ created: false, deduplicated: true, gap: { gapId: first.gap.gapId } });
        expect(third.gap.requesters).toHaveLength(2);
        expect(third.gap.requesters.find(item => item.agentId === 'miner1')?.requestCount).toBe(2);
        expect(await gaps.list()).toHaveLength(1);
    });

    test('blocks only the matching planning anchor and releases it after verification', async () => {
        const { gaps } = await store();
        const reported = await gaps.report({ agentId: 'miner1', goalId: 'find-copper-route',
            anchorGoalId: 'build-mining-career', title: 'Find a copper route' });
        expect(await gaps.findPending('miner1', 'build-mining-career')).toMatchObject({ gapId: reported.gap.gapId });
        expect(await gaps.findPending('miner1', 'buy-food')).toBeNull();
        expect(await gaps.findPending('miner2', 'build-mining-career')).toBeNull();

        const assigned = await gaps.transition(reported.gap.gapId, reported.gap.revision, 'assigned', {
            assignedWorkerId: 'skill-builder'
        });
        const draft = await gaps.transition(assigned.gapId, assigned.revision, 'draft', {
            draftSkill: { id: 'travel.copper-route', version: '0.1.0' }
        });
        const validating = await gaps.transition(draft.gapId, draft.revision, 'validating');
        const trial = await gaps.transition(validating.gapId, validating.revision, 'live-trial');
        await gaps.transition(trial.gapId, trial.revision, 'verified', {
            resolvedSkill: { id: 'travel.copper-route', version: '1.0.0' }
        });
        expect(await gaps.findPending('miner1', 'build-mining-career')).toBeNull();
        const wakeups = await gaps.claimVerifiedWakeups();
        expect(wakeups).toEqual([{ gapId: reported.gap.gapId, agentId: 'miner1', goalId: 'find-copper-route',
            anchorGoalId: 'build-mining-career', resolvedSkill: { id: 'travel.copper-route', version: '1.0.0' } }]);
        expect(await gaps.claimVerifiedWakeups()).toHaveLength(0);
        expect(await gaps.releaseWakeup(wakeups[0]!)).toBeTrue();
        expect(await gaps.claimVerifiedWakeups()).toHaveLength(1);
    });

    test('serializes concurrent reports and enforces the worker verification lifecycle', async () => {
        const { gaps, path } = await store();
        const secondStore = new CapabilityGapStore(path);
        const reports = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? secondStore : gaps).report({
            agentId: `agent${index}`, goalId: 'learn-route', title: 'Find a route to a new mine',
            description: 'Travel to the mine and return safely.'
        })));
        const open = reports.at(-1)!.gap;
        expect((await gaps.list())[0]?.requesters).toHaveLength(10);

        const assigned = await gaps.transition(open.gapId, open.revision, 'assigned', { assignedWorkerId: 'skill-builder' });
        const draft = await gaps.transition(open.gapId, assigned.revision, 'draft', {
            draftSkill: { id: 'travel.new-mine', version: '0.1.0' }
        });
        const validating = await gaps.transition(open.gapId, draft.revision, 'validating');
        const trial = await gaps.transition(open.gapId, validating.revision, 'live-trial');
        const verified = await gaps.transition(open.gapId, trial.revision, 'verified', {
            resolvedSkill: { id: 'travel.new-mine', version: '1.0.0' }
        });

        expect(verified).toMatchObject({ status: 'verified', assignedWorkerId: 'skill-builder',
            resolvedSkill: { id: 'travel.new-mine', version: '1.0.0' } });
        await expect(gaps.transition(open.gapId, verified.revision, 'open')).rejects.toThrow('Invalid');
    });

    test('recovers an abandoned builder assignment after its lease expires', async () => {
        const { gaps } = await store();
        await gaps.report({ agentId: 'miner1', goalId: 'mine', title: 'Mine ore' }, '2026-08-30T10:00:00.000Z');
        const first = await gaps.claimForBuilder('builder-one', { maxAttemptsPerGap: 3,
            maxCostMicrosPerGap: 1000, cooldownMs: 0, leaseMs: 5000 }, '2026-08-30T10:00:01.000Z');
        const active = await gaps.claimForBuilder('builder-two', { maxAttemptsPerGap: 3,
            maxCostMicrosPerGap: 1000, cooldownMs: 0, leaseMs: 5000 }, '2026-08-30T10:00:03.000Z');
        const recovered = await gaps.claimForBuilder('builder-two', { maxAttemptsPerGap: 3,
            maxCostMicrosPerGap: 1000, cooldownMs: 0, leaseMs: 5000 }, '2026-08-30T10:00:07.000Z');

        expect(first?.assignedWorkerId).toBe('builder-one');
        expect(active).toBeNull();
        expect(recovered).toMatchObject({ status: 'assigned', assignedWorkerId: 'builder-two',
            builderAttempts: 2, lastBuilderError: null });
        expect(recovered?.builderAttemptId).not.toBe(first?.builderAttemptId);
    });
});

describe('deterministic shared skill resolution', () => {
    test('finds a unique public verified skill without an LLM call', () => {
        const result = resolveSkillForCapability({ title: 'Mine copper ore', description: 'Bank the copper afterwards.' }, skills);
        expect(result).toMatchObject({ source: 'shared-library', skill: {
            id: 'mining.varrock-east.copper-to-bank', version: '1.0.0'
        }, knowledge: 'unlearned', requiresLearning: true });
        expect(result?.matchedTerms).toContain('copper');
    });

    test('prefers a known skill and fails closed for ambiguous or isolated discovery', () => {
        const known = [{ id: 'mining.varrock-east.copper-to-bank', version: '1.0.0' }];
        expect(resolveSkillForCapability({ title: 'Mine copper ore' }, skills, known)).toMatchObject({
            source: 'known', knowledge: 'learned', requiresLearning: false
        });
        expect(resolveSkillForCapability({ title: 'Mine copper ore' }, skills,
            [{ ...known[0]!, status: 'blocked' }])).toBeNull();
        expect(resolveSkillForCapability({ title: 'Use a bank' }, skills)).toBeNull();
        expect(resolveSkillForCapability({ title: 'Mine copper ore' }, skills, [], 'isolated-discovery')).toBeNull();
    });
});
