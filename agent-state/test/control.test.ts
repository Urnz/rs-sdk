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
    test('creates and reloads botless institutional, service and world identities', () => {
        const directory = mkdtempSync(join(tmpdir(), 'rs-agent-control-botless-'));
        directories.push(directory);
        const path = join(directory, 'agents.sqlite');
        let store = new AgentStateStore(path);
        const institution = store.createIdentity({ agentId: 'varrock-forge', playerUsername: null,
            displayName: 'Varrock Forge', background: 'Autonomous workshop.', personalityTraits: ['prudent'],
            controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'Varrock Forge',
                decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 12,
                dailyLlmBudgetMicros: 250_000, dailyOperationalBudgetGp: 100_000 } });
        store.createIdentity({ agentId: 'skill-builder', displayName: 'Skill Builder',
            background: 'Shared capability service.', personalityTraits: ['methodical'],
            controlProfile: { role: 'service', subjectKind: 'service', subjectId: 'Skill Builder',
                decisionIntervalMs: 60_000, maxDecisionsPerDay: 96,
                dailyLlmBudgetMicros: 500_000, dailyOperationalBudgetGp: 0 } });
        store.createIdentity({ agentId: 'world-director', displayName: 'World Director',
            background: 'Bounded simulation director.', personalityTraits: ['impartial'],
            controlProfile: { role: 'world-director', subjectKind: 'world', subjectId: 'Gielinor',
                decisionIntervalMs: 86_400_000, maxDecisionsPerDay: 1,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 0 } });
        expect(institution.playerUsername).toBeNull();
        expect(store.listEconomicActorLinks('varrock-forge')).toEqual([expect.objectContaining({
            actorKind: 'business', actorId: 'varrock_forge', role: 'self', source: 'identity'
        })]);
        expect(store.listEconomicActorLinks('skill-builder')).toEqual([]);
        store.close();

        store = new AgentStateStore(path);
        expect(store.getIdentity('varrock-forge')?.playerUsername).toBeNull();
        expect(store.getControlProfile('varrock-forge')).toMatchObject({ role: 'institution',
            subjectKind: 'business', subjectId: 'varrock_forge', avatarPlayerUsername: null });
        expect(store.getControlProfile('world-director')).toMatchObject({ role: 'world-director',
            subjectKind: 'world', subjectId: 'gielinor', avatarPlayerUsername: null });
        store.close();
    });

    test('rejects ambiguous player bindings during identity creation', () => {
        const store = createStore();
        expect(() => store.createIdentity({ agentId: 'missing-avatar', displayName: 'Missing',
            background: 'Invalid player.', personalityTraits: ['careful'] })).toThrow('playerUsername is required');
        expect(() => store.createIdentity({ agentId: 'fake-institution', playerUsername: 'Ferrye15',
            displayName: 'Fake institution', background: 'Invalid binding.', personalityTraits: ['careful'],
            controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'forge',
                decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
                dailyLlmBudgetMicros: 1, dailyOperationalBudgetGp: 1 } })).toThrow('cannot have a playerUsername');
        store.close();
    });

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

describe('institution to player action queue', () => {
    function createActionStore(): AgentStateStore {
        const directory = mkdtempSync(join(tmpdir(), 'rs-player-action-'));
        directories.push(directory);
        const store = new AgentStateStore(join(directory, 'agents.sqlite'));
        store.createIdentity({ agentId: 'varrock-forge', displayName: 'Varrock Forge',
            background: 'Workshop institution.', personalityTraits: ['prudent'],
            controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'Varrock Forge',
                decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 12,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 5_000 } });
        store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Player worker.', personalityTraits: ['reliable'] });
        store.createIdentity({ agentId: 'outsider', playerUsername: 'Outsider', displayName: 'Outsider',
            background: 'Unrelated player.', personalityTraits: ['curious'] });
        store.setSkillKnowledge('ferrye14', { id: 'mine-and-bank', version: '1.0.0' }, 'known', null);
        return store;
    }

    test('persists an exact bounded request through acceptance and completion', () => {
        const store = createActionStore();
        const request = store.createPlayerActionRequest('varrock-forge', {
            requestId: 'work.iron-001', assigneeAgentId: 'ferrye14',
            skill: { id: 'mine-and-bank', version: '1.0.0' },
            parameters: { ore: 'iron', trips: 2 }, objective: 'Bank two loads of iron ore.', rewardGp: 1200
        }, '2026-08-30T10:00:00.000Z');
        expect(request).toMatchObject({ status: 'pending', requesterAgentId: 'varrock-forge',
            assigneeAgentId: 'ferrye14', parameters: { ore: 'iron', trips: 2 }, revision: 1 });
        expect(store.listPlayerActionRequests('ferrye14', 'incoming')).toHaveLength(1);
        expect(store.listPlayerActionRequests('varrock-forge', 'outgoing')).toHaveLength(1);

        const accepted = store.setPlayerActionRequestStatus(request.requestId, 'ferrye14', request.revision,
            'accepted', 'I can do this.', '2026-08-30T10:01:00.000Z');
        expect(accepted).toMatchObject({ status: 'accepted', acceptedAt: '2026-08-30T10:01:00.000Z', revision: 2 });
        const completed = store.setPlayerActionRequestStatus(request.requestId, 'ferrye14', accepted.revision,
            'completed', 'Ore is in the bank.', '2026-08-30T10:20:00.000Z');
        expect(completed).toMatchObject({ status: 'completed', resolvedAt: '2026-08-30T10:20:00.000Z', revision: 3 });
        expect(() => store.setPlayerActionRequestStatus(request.requestId, 'ferrye14', completed.revision,
            'failed', 'Too late.')).toThrow('Invalid player action transition');
        store.close();
    });

    test('fails closed for unknown skills, excess rewards and unauthorized transitions', () => {
        const store = createActionStore();
        expect(() => store.createPlayerActionRequest('varrock-forge', {
            requestId: 'work.unknown', assigneeAgentId: 'outsider',
            skill: { id: 'mine-and-bank', version: '1.0.0' }, objective: 'Mine ore.'
        })).toThrow('already know');
        expect(() => store.createPlayerActionRequest('varrock-forge', {
            requestId: 'work.expensive', assigneeAgentId: 'ferrye14',
            skill: { id: 'mine-and-bank', version: '1.0.0' }, objective: 'Mine ore.', rewardGp: 5001
        })).toThrow('daily operational budget');
        store.createPlayerActionRequest('varrock-forge', { requestId: 'work.reserved',
            assigneeAgentId: 'ferrye14', skill: { id: 'mine-and-bank', version: '1.0.0' },
            objective: 'Mine the first batch.', rewardGp: 4000 });
        expect(() => store.createPlayerActionRequest('varrock-forge', {
            requestId: 'work.over-aggregate', assigneeAgentId: 'ferrye14',
            skill: { id: 'mine-and-bank', version: '1.0.0' }, objective: 'Mine another batch.', rewardGp: 1001
        })).toThrow('daily operational budget');
        const request = store.createPlayerActionRequest('varrock-forge', {
            requestId: 'work.secure', assigneeAgentId: 'ferrye14',
            skill: { id: 'mine-and-bank', version: '1.0.0' }, objective: 'Mine ore.'
        });
        expect(() => store.setPlayerActionRequestStatus(request.requestId, 'outsider', request.revision,
            'accepted')).toThrow('not a party');
        expect(() => store.setPlayerActionRequestStatus(request.requestId, 'varrock-forge', request.revision,
            'accepted')).toThrow('Invalid player action transition');
        expect(() => store.setPlayerActionRequestStatus(request.requestId, 'ferrye14', request.revision,
            'rejected')).toThrow('require a response note');
        expect(store.setPlayerActionRequestStatus(request.requestId, 'varrock-forge', request.revision,
            'cancelled').status).toBe('cancelled');
        store.close();
    });
});
