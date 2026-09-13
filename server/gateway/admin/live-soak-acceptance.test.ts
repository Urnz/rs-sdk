import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { appendAudit } from './audit.js';
import type { AgentTimelineEntry } from './agent-timeline.js';
import { buildLiveSoakAcceptanceBundle, liveSoakAcceptanceDigest,
    verifyLiveSoakAcceptanceBundle, type LiveSoakSession } from './live-soak-acceptance.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

function timeline(agentId: string, index: number): AgentTimelineEntry[] {
    const skills = index === 0 ? ['production.varrock.bronze-daggers', 'shopping.lumbridge.buy-hammers',
        'procedure.bank.deposit-item'] : ['mining.varrock-east.copper-to-bank',
        'mining.varrock-east.copper-to-general-store', 'procedure.bank.deposit-item'];
    const entries = skills.map((skillId, runIndex): AgentTimelineEntry => ({
        id: `skill:${agentId}.run.${runIndex}`, timestamp: `2026-09-12T10:1${runIndex}:00.000Z`,
        kind: 'evidence', status: 'completed', summary: 'Verified terminal.',
        correlation: { eventId: `${agentId}.event.${runIndex}`, decisionId: `${agentId}.decision.${runIndex}`,
            runId: `${agentId}.run.${runIndex}`, goalId: `${agentId}.goal.${runIndex}` },
        details: { skill: { id: skillId, version: '1.0.0' }, classification: 'completed' }
    }));
    if (index < 2) entries.push({ id: `domain:${agentId}`, timestamp: `2026-09-12T10:20:0${index}.000Z`,
        kind: 'domain-action', status: 'completed', summary: 'Bounded work order.',
        correlation: { sourceId: `work-order-${index}` }, details: { requesterAgentId: 'varrock-forge-mind',
            assigneeAgentId: agentId, settlementId: `settlement-${index}` } });
    return entries;
}

describe('live soak acceptance bundle', () => {
    test('proves duration, restart continuity, exact correlations, limits and cohort coverage', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-live-soak-')); directories.push(root);
        const sessionPath = join(root, 'session.json'), snapshotsPath = join(root, 'snapshots.jsonl');
        const agentPath = join(root, 'agents.sqlite'), auditPath = join(root, 'audit.jsonl');
        const agentIds = Array.from({ length: 6 }, (_, index) => `agent-${index}`);
        const store = new AgentStateStore(agentPath);
        for (const agentId of agentIds) store.createIdentity({ agentId, playerUsername: agentId,
            displayName: agentId, background: 'Live soak fixture agent.', personalityTraits: ['reliable'],
            controlProfile: { role: 'player', subjectKind: 'player', subjectId: agentId,
                avatarPlayerUsername: agentId, decisionIntervalMs: 60_000, maxDecisionsPerDay: 100,
                dailyLlmBudgetMicros: 10_000, dailyOperationalBudgetGp: 1_000 } },
        '2026-09-12T10:00:00.000Z');
        store.close();
        const intervention = { kind: 'gateway-engine-stack-restart', plannedElapsedMinutes: 30,
            status: 'completed', startedAt: '2026-09-12T10:30:00.000Z',
            finishedAt: '2026-09-12T10:31:00.000Z', beforeRunId: 'run-before', afterRunId: 'run-after',
            error: null };
        const session: LiveSoakSession = { schemaVersion: 1, sessionId: 'soak-test', fixtureId: 'varrock-proto-v1',
            fixtureVersion: '1.0.0', fixturePath: 'fixture.json', agentIds, botNames: agentIds,
            durationMinutes: 60, snapshotIntervalSeconds: 60, startedAt: '2026-09-12T10:00:00.000Z',
            plannedFinishedAt: '2026-09-12T11:00:00.000Z', status: 'completed', processId: 1,
            initialRunId: 'run-before', finalRunId: 'run-after', finishedAt: '2026-09-12T11:00:01.000Z',
            plannedOperatorInterventions: [intervention], unplannedOperatorInterventions: [], error: null };
        await writeFile(sessionPath, JSON.stringify(session));
        const autonomy = agentIds.map(agentId => ({ agentId, status: 'backoff' }));
        await writeFile(snapshotsPath, [
            { sessionId: session.sessionId, kind: 'pre-restart', capturedAt: intervention.startedAt,
                elapsedSeconds: 1_800, runId: 'run-before', health: { healthy: true }, autonomy, captureError: null },
            { sessionId: session.sessionId, kind: 'post-restart', capturedAt: intervention.finishedAt,
                elapsedSeconds: 1_860, runId: 'run-after', health: { healthy: true }, autonomy, captureError: null }
        ].map(item => JSON.stringify(item)).join('\n'));
        await appendAudit({ operator: 'system', action: 'soak.test', reason: 'Acceptance.', success: true }, auditPath);
        const timelines = new Map(agentIds.map((agentId, index) => [agentId, timeline(agentId, index)]));
        const bundle = await buildLiveSoakAcceptanceBundle(sessionPath, { agentPath, auditPath, snapshotsPath,
            timelines, sourceRevision: 'f'.repeat(40), now: '2026-09-12T11:01:00.000Z' });
        expect(liveSoakAcceptanceDigest(bundle)).toBe(bundle.bundleDigest);
        expect(verifyLiveSoakAcceptanceBundle(bundle)).toBeTrue();
        expect(bundle.criteria).toEqual({ completedSixtyMinutes: true, sixPersistentAgents: true,
            plannedRestartContinuous: true, noUnplannedIntervention: true,
            everyAgentHasThreeTerminalsOrBackoff: true, productionShopAndBankObserved: true,
            twoSocialEventsObserved: true, auditAndCorrelationIntegrity: true, accepted: true });
        expect(bundle.correlationIds).toMatchObject({ runIds: expect.arrayContaining(['agent-0.run.0']),
            settlementIds: ['settlement-0', 'settlement-1'] });
        expect(bundle.restartContinuity).toMatchObject({ preRestartSnapshot: { runId: 'run-before' },
            postRestartSnapshot: { runId: 'run-after' } });
        bundle.manifest.initialRunId = 'tampered';
        expect(verifyLiveSoakAcceptanceBundle(bundle)).toBeFalse();
    });
});
