import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import { createSkillParameterBinding } from '../../../agent-state/skill-binding.js';
import { appendAudit } from './audit.js';
import { acceptanceBundleDigest, buildAcceptanceBundle, verifyAcceptanceBundle } from './acceptance-bundle.js';
import { EXPERIMENT_ADAPTERS } from './experiment-applied-profile.js';
import { validateExperimentParameterProfile } from './experiment-parameters.js';
import { MultiAgentExperimentStore, multiAgentExperimentDefinition,
    type MultiAgentExperimentCandidate, type MultiAgentExperimentEnvironment } from './multi-agent-experiments.js';
import type { EconomySnapshot } from './types.js';
import { readFile } from 'node:fs/promises';
import { adminPublicDir } from './paths.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

const at = '2026-09-01T10:00:00.000Z';
const runIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

function profile() {
    return validateExperimentParameterProfile({ profileId: 'acceptance.profile', version: '1.0.0',
        label: 'Acceptance profile', origin: 'manual', parameters: { respawns: [{ targetKey: 'loc:2090', ticks: 100 }],
            xpRewards: [{ activityKey: 'skill:mining', multiplier: 1 }],
            marketPrices: [{ itemId: 436, itemName: 'Copper ore', buyGp: 3, sellGp: 1 }],
            finishedProducts: [{ itemId: 1205, itemName: 'Bronze dagger', valueGp: 16 }] } }, at);
}

function environment(): MultiAgentExperimentEnvironment {
    const source = profile();
    return { schemaVersion: 1, activeRevision: 2, capturedAt: at,
        mods: EXPERIMENT_ADAPTERS.map(adapter => ({ id: adapter.id, version: '1.0.0', dataSchemaVersion: 1,
            ...adapter.build(source) })) };
}

function economy(timestamp: string): EconomySnapshot {
    return { timestamp, bots: 2, online: 2, totalCoins: 200, totalXp: 0, sessionXpGained: 0,
        totalXpPerHour: 0, averageTotalLevel: 1, itemStock: [] };
}

function candidate(agentId: string): MultiAgentExperimentCandidate {
    return { agentId, role: 'player', subjectKind: 'player', identityPlayerUsername: agentId,
        avatarPlayerUsername: agentId, onlineFresh: true, avatarBaseline: { username: agentId,
            position: { x: 3200, z: 3400, level: 0 }, hitpoints: { current: 10, maximum: 10 }, runEnergy: 10_000,
            inventory: [{ id: 995, name: 'Coins', count: 100 }], equipment: [], bankKnown: true, bank: [],
            skills: Array.from({ length: 19 }, (_, index) => ({ name: `Skill ${index}`,
                level: 1, baseLevel: 1, experience: 0 })) } };
}

describe('exportable acceptance bundle', () => {
    test('exposes a downloadable acceptance action in the experiment UI', async () => {
        const [script, routes] = await Promise.all([readFile(join(adminPublicDir, 'admin.js'), 'utf8'),
            readFile(join(adminPublicDir, '..', 'routes.ts'), 'utf8')]);
        expect(script).toContain('data-action="experiment-acceptance-export"');
        expect(script).toContain('/acceptance-bundle`');
        expect(script).toContain('downloadJson(`acceptance-');
        expect(routes).toContain('buildAcceptanceBundle(acceptanceBundleMatch[1]');
        expect(routes).toContain('Content-Disposition');
    });

    test('contains exact versions, baselines, correlations and verified audit chain', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-acceptance-bundle-')); directories.push(root);
        const experimentPath = join(root, 'experiments.sqlite'), agentPath = join(root, 'agents.sqlite');
        const auditPath = join(root, 'audit.jsonl');
        const experiments = new MultiAgentExperimentStore(experimentPath);
        const agents = new AgentStateStore(agentPath);
        const ids = ['agent-a', 'agent-b'];
        const definition = multiAgentExperimentDefinition({ label: 'Acceptance run', seed: 'seed-15-11',
            summary: 'Prove export evidence.', agentIds: ids,
            parameterProfileId: 'acceptance.profile', parameterProfileVersion: '1.0.0' });
        const candidates = new Map(ids.map(id => [id, candidate(id)]));
        const goals = Object.fromEntries(ids.map(id => [id, [{ goalId: `${id}.goal`, horizon: 'immediate' as const,
            status: 'active' as const, revision: 1, updatedAt: at, completedAt: null }]]));
        const run = experiments.create(definition, candidates, economy(at), goals, environment(), profile(), at,
            '33333333-3333-4333-8333-333333333333');
        ids.forEach((id, index) => experiments.recordParticipant(run.experimentId, id, { timestamp: at,
            event: { eventId: run.participants.find(item => item.agentId === id)!.eventId, agentId: id,
                type: 'manual-request', sourceKey: `acceptance:${id}`, occurredAt: at, summary: 'Acceptance.' },
            gate: { accepted: true, reason: 'accepted', nextAllowedAt: at },
            outcome: { runId: runIds[index]!, status: 'executing', reason: 'Accepted.' }, error: null }, at));
        experiments.markDispatched(run.experimentId, economy('2026-09-01T10:00:01.000Z'), at);
        ids.forEach((id, index) => {
            agents.createIdentity({ agentId: id, playerUsername: id, displayName: id,
                background: 'Acceptance fixture agent.', personalityTraits: ['careful'], controlProfile: {
                    role: 'player', subjectKind: 'player', subjectId: id, avatarPlayerUsername: id,
                    decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
                    dailyLlmBudgetMicros: 1_000, dailyOperationalBudgetGp: 1_000 } }, at);
            agents.createAutonomyEnrollment(id, { status: 'desired', policyId: 'private-local-default',
                policyVersion: '1.0.0' }, at);
            const binding = createSkillParameterBinding({ sourceKind: 'goal', sourceId: `${id}.goal`, parameters: {} });
            agents.createGoal(id, { goalId: `${id}.life`, horizon: 'life', title: 'Acceptance life' }, at);
            agents.createGoal(id, { goalId: `${id}.long`, parentGoalId: `${id}.life`, horizon: 'long-term',
                title: 'Acceptance long-term' }, at);
            agents.createGoal(id, { goalId: `${id}.current`, parentGoalId: `${id}.long`, horizon: 'current',
                title: 'Acceptance current' }, at);
            agents.createGoal(id, { goalId: `${id}.goal`, parentGoalId: `${id}.current`,
                horizon: 'immediate', title: 'Acceptance goal',
                skill: { id: 'test.acceptance', version: '1.0.0' }, execution: { policy: 'one-shot',
                    binding: { sourceKind: binding.sourceKind, sourceId: binding.sourceId,
                        parameters: binding.parameters } } }, at);
            agents.recordDecision(id, 1, { decisionId: `${id}.decision`, trigger: 'event' }, at);
            agents.recordSkillDispatch({ runId: runIds[index]!, decisionId: `${id}.decision`, agentId: id,
                goalId: `${id}.goal`, skill: { id: 'test.acceptance', version: '1.0.0' }, binding,
                policyId: 'private-local-default', policyVersion: '1.0.0' }, at);
            experiments.recordSkillRun(runIds[index]!, { runId: runIds[index]!, username: id,
                skill: { id: 'test.acceptance', version: '1.0.0' }, status: 'completed', reason: 'Done.', message: '',
                operations: 1, durationMs: 100, startedAt: at, finishedAt: '2026-09-01T10:00:02.000Z', events: [] },
            true, 'Done.', '2026-09-01T10:00:02.000Z');
        });
        experiments.finish(run.experimentId, economy('2026-09-01T10:00:03.000Z'), goals,
            { 'agent-a': [], 'agent-b': [] }, '2026-09-01T10:00:03.000Z');
        await appendAudit({ operator: 'system', action: 'multi-agent-experiment.completed',
            reason: 'Acceptance evidence.', success: true, after: { experimentId: run.experimentId, runIds } }, auditPath);
        agents.close(); experiments.close();

        const bundle = await buildAcceptanceBundle(run.experimentId, { experimentPath, agentPath, auditPath,
            fixture: null, sourceRevision: 'f'.repeat(40), now: '2026-09-01T10:01:00.000Z' });
        expect(acceptanceBundleDigest(bundle)).toBe(bundle.bundleDigest);
        expect(verifyAcceptanceBundle(bundle)).toBeTrue();
        expect(bundle).toMatchObject({ schemaVersion: 1, manifest: { seed: 'seed-15-11',
            build: { worldBuild: 'lostcity-local-private', sourceRevision: 'f'.repeat(40) },
            parameterProfile: { id: 'acceptance.profile', version: '1.0.0' },
            policies: [{ agentId: expect.any(String), policyId: 'private-local-default', policyVersion: '1.0.0' },
                { agentId: expect.any(String), policyId: 'private-local-default', policyVersion: '1.0.0' }] },
        audit: { verification: { valid: true, chainedEntries: 1 }, relevantEntries: [expect.any(Object)] } });
        expect(bundle.baselineDigests).toHaveLength(2);
        expect(bundle.correlationIds).toMatchObject({ eventIds: expect.any(Array), runIds,
            decisionIds: ['agent-a.decision', 'agent-b.decision'], goalIds: ['agent-a.goal', 'agent-b.goal'] });
        bundle.manifest.seed = 'tampered';
        expect(verifyAcceptanceBundle(bundle)).toBeFalse();
    });
});
