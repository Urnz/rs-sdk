import { describe, expect, test } from 'bun:test';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { bindAutonomousSkillParameters, classifyAutonomousExecutionFailure,
    classifySkillFailure } from './autonomous-skill-binding.js';

const definition = {
    id: 'mining.varrock', version: '1.0.0', parameters: {
        oreId: { type: 'number', required: true, minimum: 1 },
        trips: { type: 'number', default: 1, minimum: 1, maximum: 5 }
    }
} as unknown as SkillDefinition;

describe('autonomous skill parameter binding', () => {
    test('schema-validates the first exact authority source before hashing resolved parameters', () => {
        const binding = bindAutonomousSkillParameters(definition, [
            { sourceKind: 'work-order', sourceId: 'request.1',
                skill: { id: 'other', version: '1.0.0' }, parameters: { unsafe: true } },
            { sourceKind: 'contract-obligation', sourceId: 'contract.1',
                skill: { id: 'mining.varrock', version: '1.0.0' }, parameters: { oreId: 436 } }
        ]);
        expect(binding).toMatchObject({ sourceKind: 'contract-obligation', sourceId: 'contract.1',
            parameters: { oreId: 436, trips: 1 } });
        expect(binding.digest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('rejects missing, unknown and invalid parameter sources instead of treating empty input as generic', () => {
        expect(() => bindAutonomousSkillParameters(definition, [])).toThrow('no exact persisted parameter source');
        expect(() => bindAutonomousSkillParameters(definition, [{ sourceKind: 'goal', sourceId: 'goal.1',
            skill: { id: 'mining.varrock', version: '1.0.0' }, parameters: {} }])).toThrow('Hiányzó kötelező');
        expect(() => bindAutonomousSkillParameters(definition, [{ sourceKind: 'llm-suggestion', sourceId: 'plan.1',
            skill: { id: 'mining.varrock', version: '1.0.0' }, parameters: { oreId: 436, admin: true } }]))
            .toThrow('Ismeretlen skill paraméter');
    });

    test('classifies preconditions into bounded fail-closed dispositions', () => {
        expect(classifySkillFailure('precondition-failed', 'Missing item: pickaxe')).toBe('acquire-input');
        expect(classifySkillFailure('procedure-not-found', 'No route capability')).toBe('capability-gap');
        expect(classifySkillFailure('forbidden', 'Policy approval required')).toBe('authorization');
        expect(classifySkillFailure('timeout', 'The local emulator did not answer')).toBe('retry');
    });

    test('routes only genuine procedure gaps into the Skill Builder pipeline', () => {
        expect(classifyAutonomousExecutionFailure('procedure-not-found', 'No travel capability')).toEqual({
            gapKind: 'procedure', disposition: 'capability-gap' });
        expect(classifyAutonomousExecutionFailure('invalid-input', 'Missing required parameter: bank-x')).toEqual({
            gapKind: 'parameter-binding', disposition: 'authorization' });
        expect(classifyAutonomousExecutionFailure('forbidden', 'Policy allowlist rejected shop-buy')).toEqual({
            gapKind: 'policy', disposition: 'authorization' });
        expect(classifyAutonomousExecutionFailure('precondition-failed', 'Contract expired')).toEqual({
            gapKind: 'lifecycle', disposition: 'authorization' });
        expect(classifyAutonomousExecutionFailure('stale-state', 'Authoritative context snapshot is stale')).toEqual({
            gapKind: 'context', disposition: 'retry' });
        expect(classifyAutonomousExecutionFailure('precondition-failed', 'Resource shortage: bronze bars')).toEqual({
            gapKind: 'input-shortage', disposition: 'acquire-input' });
    });
});
