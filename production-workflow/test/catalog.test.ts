import { describe, expect, test } from 'bun:test';

import {
    compileProductionWorkflow,
    loadDefaultProductionWorkflowCatalog,
    validateProductionWorkflowCatalog
} from '../index.js';

describe('versioned production recipes and workflows', () => {
    test('loads simple and multi-step production through one strict model', () => {
        const catalog = loadDefaultProductionWorkflowCatalog();
        expect(catalog.digest).toHaveLength(64);
        expect(catalog.workflows.find(entry => entry.workflowId === 'food.cooked-shrimp')?.steps).toHaveLength(1);
        expect(catalog.workflows.find(entry => entry.workflowId === 'tools.bronze-pickaxe')?.steps)
            .toEqual([expect.objectContaining({ stepId: 'smelt', batches: 3, dependsOn: [] }),
                expect.objectContaining({ stepId: 'forge', batches: 1, dependsOn: ['smelt'] })]);
    });

    test('captures time, personal skill, facility, tool, knowledge and entitlement requirements', () => {
        const recipe = loadDefaultProductionWorkflowCatalog().recipes
            .find(entry => entry.recipeId === 'smithing.forge-bronze-pickaxe')!;
        expect(recipe).toMatchObject({ durationSimulationMinutes: 3,
            inputs: [{ itemId: 2349, quantity: 3 }], outputs: [{ itemId: 1265, quantity: 1 }],
            executionSkill: { id: 'production.forge-bronze-pickaxe', version: '1.0.0' },
            requirements: { personalSkills: [{ skillName: 'Smithing', minimumLevel: 1 }],
                facilityCapabilities: ['smithing.basic-forging'],
                tools: [{ itemId: 2347, quantity: 1, capabilityId: 'tool.hammering' }],
                knowledge: [{ kind: 'organization-license', id: 'smithing.bronze-tools', version: '1.0.0' }],
                entitlements: [{ kind: 'employment', scopeId: 'smithing.basic-forging' }] } });
    });

    test('compiles one-step food and a longer ore-to-tool chain without treating intermediates as new inputs', () => {
        const catalog = loadDefaultProductionWorkflowCatalog();
        expect(compileProductionWorkflow(catalog, 'food.cooked-shrimp', '1.0.0')).toMatchObject({
            externalInputs: [{ itemId: 317, quantity: 1 }], finalOutputs: [{ itemId: 315, quantity: 1 }],
            totalDurationSimulationMinutes: 1
        });
        expect(compileProductionWorkflow(catalog, 'tools.bronze-pickaxe', '1.0.0')).toMatchObject({
            externalInputs: [{ itemId: 436, quantity: 3 }, { itemId: 438, quantity: 3 }],
            finalOutputs: [{ itemId: 1265, quantity: 1 }], totalDurationSimulationMinutes: 9
        });
    });

    test('uses existing RuneScape skills for the ore-to-tool-and-facility prototype', () => {
        const catalog = loadDefaultProductionWorkflowCatalog();
        expect(compileProductionWorkflow(catalog, 'facility.bronze-bellows-upgrade', '1.0.0')).toMatchObject({
            externalInputs: [{ itemId: 436, quantity: 6 }, { itemId: 438, quantity: 6 }, { itemId: 1741, quantity: 2 }],
            finalOutputs: [{ itemId: 1265, quantity: 1 }, { itemId: 65000, quantity: 1 }],
            totalDurationSimulationMinutes: 23
        });
        const skills = catalog.recipes.filter(recipe => ['metallurgy.smelt-bronze-bar', 'smithing.forge-bronze-pickaxe',
            'facility.assemble-bronze-bellows'].includes(recipe.recipeId))
            .flatMap(recipe => recipe.requirements.personalSkills.map(skill => skill.skillName));
        expect(new Set(skills)).toEqual(new Set(['Smithing', 'Crafting']));
        expect(skills).not.toContain('Engineering'); expect(skills).not.toContain('Machining');
    });

    test('rejects unknown recipe versions and cyclic workflow dependencies', () => {
        const catalog = loadDefaultProductionWorkflowCatalog();
        const raw = { schemaVersion: catalog.schemaVersion, recipes: catalog.recipes, workflows: catalog.workflows };
        const unknown = structuredClone(raw);
        unknown.workflows.find(row => row.workflowId === 'food.cooked-shrimp')!.steps[0]!.recipe.version = '2.0.0';
        expect(() => validateProductionWorkflowCatalog(unknown)).toThrow('unknown recipe version');
        const cyclic = structuredClone(raw), steps = cyclic.workflows.find(row => row.workflowId === 'tools.bronze-pickaxe')!.steps;
        steps[0]!.dependsOn = ['forge'];
        expect(() => validateProductionWorkflowCatalog(cyclic)).toThrow('dependency cycle');
    });

    test('rejects ambiguous inputs, unbounded requirements and arbitrary fields', () => {
        const catalog = loadDefaultProductionWorkflowCatalog();
        const raw = { schemaVersion: catalog.schemaVersion, recipes: catalog.recipes, workflows: catalog.workflows };
        const duplicateInput = structuredClone(raw);
        duplicateInput.recipes[0]!.inputs.push({ ...duplicateInput.recipes[0]!.inputs[0]! });
        expect(() => validateProductionWorkflowCatalog(duplicateInput)).toThrow('item ids must be unique');
        const unsafe = structuredClone(raw) as typeof raw & { command?: string };
        unsafe.command = 'spawn item';
        expect(() => validateProductionWorkflowCatalog(unsafe)).toThrow('fields are invalid');
    });
});
