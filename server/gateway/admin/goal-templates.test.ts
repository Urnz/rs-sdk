import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAutonomyEnrollment, AgentGoal } from '../../../agent-state/types.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { materializeLivelihoodGoal, selectAllowedGoalTemplate } from './goal-templates.js';
import type { LivelihoodJournalEntry, LivelihoodAction } from '../../../agent-state/livelihood.js';

const enrollment = { policyId: 'private-local-default', policyVersion: '1.0.0' } as AgentAutonomyEnrollment;
const current = { goalId: 'vrcopper2.stock', horizon: 'current', status: 'active' } as AgentGoal;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('versioned autonomous goal templates', () => {
    test('selects only an exact policy-version template when no immediate goal exists', () => {
        expect(selectAllowedGoalTemplate([current], enrollment)).toMatchObject({
            templateId: 'proto.vrcopper2.run', version: '1.0.0', goal: { goalId: 'vrcopper2.run',
                execution: { policy: 'recurring', cooldownMs: 60_000 } }
        });
        expect(selectAllowedGoalTemplate([current], { ...enrollment, policyVersion: '2.0.0' })).toBeNull();
    });

    test('does not replace an active immediate goal or repeat a consumed one-shot/template identity', () => {
        const immediate = { goalId: 'other.run', horizon: 'immediate', status: 'active' } as AgentGoal;
        expect(selectAllowedGoalTemplate([current, immediate], enrollment)).toBeNull();
        expect(selectAllowedGoalTemplate([current,
            { ...immediate, goalId: 'vrcopper2.run', status: 'completed' }], enrollment)).toBeNull();
    });

    test('bounded travel reuses an existing life root and preserves its explicit recurring supply branch', () => {
        const root = mkdtempSync(join(tmpdir(), 'livelihood-goals-')); roots.push(root);
        const store = new AgentStateStore(join(root, 'agents.sqlite'));
        try {
            store.createIdentity({ agentId: 'supplier', playerUsername: 'supplier', displayName: 'Supplier', background: 'A local supplier.', personalityTraits: ['steady'] });
            const life = store.createGoal('supplier', { goalId: 'supplied-life', horizon: 'life', title: 'Keep living', description: 'Existing approved root.' });
            const long = store.createGoal('supplier', { goalId: 'supplied-long', parentGoalId: life.goalId, horizon: 'long-term', title: 'Supply', description: 'Finite supply.' });
            const parent = store.createGoal('supplier', { goalId: 'supplied-current', parentGoalId: long.goalId, horizon: 'current', title: 'Gather', description: 'Finite supply.' });
            const supply = store.createGoal('supplier', { goalId: 'supply', parentGoalId: parent.goalId, horizon: 'immediate', title: 'Gather one', description: 'Existing supply.',
                skill: { id: 'procedure.food.gather-lobster', version: '1.0.0' }, execution: { policy: 'recurring', cooldownMs: 60000,
                    binding: { sourceKind: 'approved-policy', sourceId: 'society-livelihood:1.0.0', parameters: {} } } });
            const execution = store.getGoalExecution(supply.goalId);
            const entry = { actionId: 'routine.route', agentId: 'supplier', eventId: 'event', lifecycle: 'life', policy: 'society-livelihood@1.0.0',
                action: { kind: 'skill', skill: { id: 'procedure.travel.native-sites', version: '1.0.0' },
                    binding: { sourceKind: 'approved-policy', sourceId: 'society-livelihood:1.0.0:travel:commerce', parameters: { site: 'kitchen' } } },
                phase: 'submitted', reason: 'approved-supply', receipt: null, revision: 1, createdAt: '2026-10-22T09:00:00.000Z', updatedAt: '2026-10-22T09:00:00.000Z'
            } as LivelihoodJournalEntry & { action: Extract<LivelihoodAction, { kind: 'skill' }> };
            const route = materializeLivelihoodGoal(store, entry);
            expect(materializeLivelihoodGoal(store, entry)).toBe(route);
            const goals = store.listGoals('supplier');
            expect(goals.filter(g => g.horizon === 'life' && g.status === 'active')).toEqual([life]);
            expect(goals.find(g => g.goalId === supply.goalId)).toEqual(supply);
            expect(store.getGoalExecution(supply.goalId)).toEqual(execution);
            expect(goals.find(g => g.goalId === route)?.skill).toEqual(entry.action.skill);
        } finally { store.close(); }
    });
});
