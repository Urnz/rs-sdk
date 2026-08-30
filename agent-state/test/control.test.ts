import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore, buildAgentControlContext, decisionReadiness, listAgentDomainTools,
    physicalExecutionAuthority } from '../index.js';

const directories: string[] = [];

function createStore(): AgentStateStore {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-control-'));
    directories.push(directory);
    const store = new AgentStateStore(join(directory, 'agents.sqlite'));
    store.createIdentity({ agentId: 'forge-mind', playerUsername: 'Ferrye14', displayName: 'Forge Mind',
        background: 'Institution control test.', personalityTraits: ['careful'] }, '2026-08-30T08:00:00.000Z');
    return store;
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('agent role and subject control', () => {
    test('migrates player identities and binds institutions without granting an avatar', () => {
        const store = createStore();
        const player = store.getControlProfile('forge-mind')!;
        expect(player).toMatchObject({ role: 'player', subjectKind: 'player', subjectId: 'ferrye14',
            avatarPlayerUsername: 'ferrye14', revision: 1 });
        expect(physicalExecutionAuthority(player, 'Ferrye14').allowed).toBe(true);
        store.setEconomicActorLink('forge-mind', null, {
            actorKind: 'business', actorId: 'Varrock Forge', role: 'owner'
        }, '2026-08-30T08:30:00.000Z');

        const institution = store.setControlProfile('forge-mind', player.revision, {
            role: 'institution', subjectKind: 'business', subjectId: 'Varrock Forge',
            avatarPlayerUsername: null, decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 12,
            dailyLlmBudgetMicros: 250_000, dailyOperationalBudgetGp: 100_000
        }, '2026-08-30T09:00:00.000Z');
        expect(institution).toMatchObject({ role: 'institution', subjectKind: 'business',
            subjectId: 'varrock_forge', avatarPlayerUsername: null, revision: 2 });
        expect(store.listEconomicActorLinks('forge-mind')).toEqual([expect.objectContaining({
            actorKind: 'business', actorId: 'varrock_forge', role: 'self', source: 'identity'
        })]);
        expect(physicalExecutionAuthority(institution, 'Ferrye14')).toMatchObject({ allowed: false,
            playerUsername: null });
        expect(listAgentDomainTools(institution)).toContain('request-player-action');
        expect(listAgentDomainTools(institution)).not.toContain('execute-player-skill');
        expect(buildAgentControlContext(institution)).toContain('Subject: business:varrock_forge');
        store.close();
    });

    test('rejects invalid role-subject-avatar combinations', () => {
        const store = createStore();
        const profile = store.getControlProfile('forge-mind')!;
        expect(() => store.setControlProfile('forge-mind', profile.revision, {
            role: 'institution', subjectKind: 'business', subjectId: 'forge',
            avatarPlayerUsername: 'Ferrye14', decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
            dailyLlmBudgetMicros: 1, dailyOperationalBudgetGp: 1
        })).toThrow('only player agents may have');
        expect(() => store.setControlProfile('forge-mind', profile.revision, {
            role: 'service', subjectKind: 'faction', subjectId: 'white-knights',
            avatarPlayerUsername: null, decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
            dailyLlmBudgetMicros: 1, dailyOperationalBudgetGp: 1
        })).toThrow('cannot bind');
        store.close();
    });
});

describe('bounded decision rhythm and budgets', () => {
    test('persists decisions atomically and enforces cadence plus daily budgets', () => {
        const store = createStore();
        const initial = store.getControlProfile('forge-mind')!;
        const profile = store.setControlProfile('forge-mind', initial.revision, {
            role: 'institution', subjectKind: 'faction', subjectId: 'White Knights',
            avatarPlayerUsername: null, decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 2,
            dailyLlmBudgetMicros: 100, dailyOperationalBudgetGp: 1_000
        }, '2026-08-30T09:00:00.000Z');
        const first = store.recordDecision('forge-mind', profile.revision, {
            decisionId: 'decision.first', trigger: 'scheduled', llmCostMicros: 40, operationalBudgetGp: 300
        }, '2026-08-30T10:00:00.000Z');
        expect(first.profile.nextDecisionAt).toBe('2026-08-30T11:00:00.000Z');
        expect(decisionReadiness(first.profile, 'scheduled', '2026-08-30T10:30:00.000Z').ready).toBe(false);
        expect(() => store.recordDecision('forge-mind', first.profile.revision, {
            decisionId: 'decision.too-early', trigger: 'scheduled'
        }, '2026-08-30T10:30:00.000Z')).toThrow('not due');
        expect(store.listDecisions('forge-mind')).toHaveLength(1);

        const second = store.recordDecision('forge-mind', first.profile.revision, {
            decisionId: 'decision.event', trigger: 'event', llmCostMicros: 50, operationalBudgetGp: 600
        }, '2026-08-30T10:31:00.000Z');
        expect(() => store.recordDecision('forge-mind', second.profile.revision, {
            decisionId: 'decision.over-limit', trigger: 'event', llmCostMicros: 1
        }, '2026-08-30T12:00:00.000Z')).toThrow('decision limit');
        expect(store.listDecisions('forge-mind', '2026-08-30').map(item => item.decisionId))
            .toEqual(['decision.first', 'decision.event']);
        store.close();
    });
});
