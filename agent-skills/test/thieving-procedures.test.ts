import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SkillOperationName } from '../types.js';
import { SkillExecutor } from '../executor.js';
import { SkillValidationError, validateSkillDefinition } from '../validation.js';
import { verifyAndPromoteSkill } from '../verifier.js';

const procedures = [
    ['procedure.thieving.pickpocket', 'procedure.thieving.pickpocket@0.1.0.skill.json',
        'procedure.thieving.pickpocket@1.0.0.skill.json', 'thieve-pickpocket'],
    ['procedure.thieving.lockpick-door', 'procedure.thieving.lockpick-door@0.1.0.skill.json',
        'procedure.thieving.lockpick-door@1.0.0.skill.json', 'thieve-lockpick'],
    ['procedure.thieving.container-theft', 'procedure.thieving.container-theft@0.1.0.skill.json',
        'procedure.thieving.container-theft@1.0.0.skill.json', 'thieve-container'],
    ['procedure.thieving.property-burglary', 'procedure.thieving.property-burglary@0.1.0.skill.json',
        'procedure.thieving.property-burglary@1.0.0.skill.json',
        'thieve-property-entry']
] as const;

function load(file: string) {
    return validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir, '..', 'catalog', file), 'utf8')));
}

describe('Phase 22 typed Thieving procedures', () => {
    test('keeps every procedure bounded, draft-only and on the existing Thieving skill', () => {
        for (const [id, draftFile, , operation] of procedures) {
            const definition = load(draftFile);
            expect(definition).toMatchObject({ id, version: '0.1.0', status: 'draft',
                sharing: { visibility: 'shared' }, limits: { maxOperations: 1 } });
            expect(definition.preconditions).toEqual([expect.objectContaining({
                condition: 'skill-level-at-least', arguments: expect.objectContaining({ skill: 'Thieving' })
            })]);
            expect(definition.steps).toEqual([expect.objectContaining({ kind: 'operation', operation,
                arguments: expect.objectContaining({ match: 'exact' }) })]);
        }
    });

    test('publishes every accepted procedure as a normally executable verified version', async () => {
        const calls: SkillOperationName[] = [];
        const runtime = {
            test: async () => true,
            execute: async (operation: SkillOperationName) => {
                calls.push(operation);
                return { success: true, message: 'verified procedure executed' };
            }
        };
        for (const [id, , verifiedFile, operation] of procedures) {
            const definition = load(verifiedFile);
            expect(definition).toMatchObject({ id, version: '1.0.0', status: 'verified',
                provenance: { derivedFrom: { id, version: '0.1.0' } } });
            const parameters = Object.fromEntries(Object.entries(definition.parameters).map(([name, parameter]) =>
                [name, parameter.type === 'number' ? 1 : 'Target']));
            expect((await new SkillExecutor(runtime).execute(definition, { parameters })).status).toBe('completed');
            expect(calls.pop()).toBe(operation);
        }
    });

    test('binds loc procedures to exact coordinates and never promotes without live evidence', () => {
        for (const [, draftFile, , operation] of procedures.slice(1)) {
            const definition = load(draftFile);
            const step = definition.steps[0];
            expect(step).toMatchObject({ kind: 'operation', operation: operation as SkillOperationName,
                arguments: { x: { parameter: 'target-x' }, z: { parameter: 'target-z' } } });
            const report = verifyAndPromoteSkill(definition, [], { targetVersion: '1.0.0' });
            expect(report.passed).toBeFalse();
            expect(report.promoted).toBeUndefined();
        }
    });

    test('rejects a broad-name Thieving target', () => {
        const definition = structuredClone(load(procedures[0][1]));
        const step = definition.steps[0];
        if (step?.kind === 'operation') step.arguments.match = 'contains';
        expect(() => validateSkillDefinition(definition)).toThrow(SkillValidationError);
    });
});
