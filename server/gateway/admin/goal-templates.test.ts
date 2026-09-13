import { describe, expect, test } from 'bun:test';
import type { AgentAutonomyEnrollment, AgentGoal } from '../../../agent-state/types.js';
import { selectAllowedGoalTemplate } from './goal-templates.js';

const enrollment = { policyId: 'private-local-default', policyVersion: '1.0.0' } as AgentAutonomyEnrollment;
const current = { goalId: 'vrcopper2.stock', horizon: 'current', status: 'active' } as AgentGoal;

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
});
