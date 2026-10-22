import { createHash } from 'node:crypto';

import type {
    ProductionEntitlementRequirement,
    ProductionItemQuantity,
    ProductionKnowledgeRequirement,
    ProductionRecipe,
    ProductionRequirements,
    ProductionToolRequirement,
    ProductionWorkflow,
    ProductionWorkflowCatalog,
    VersionedReference
} from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ENTITLEMENT_KINDS = ['employment', 'lease', 'contract', 'explicit'] as const;
const KNOWLEDGE_KINDS = ['semantic-knowledge', 'organization-license', 'verified-procedure'] as const;

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error(`${field} fields are invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function version(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}
function list(value: unknown, field: string, minimum = 0, maximum = 100): unknown[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${field} is invalid`);
    return value;
}
function reference(value: unknown, field: string): VersionedReference {
    const input = record(value, field); exact(input, ['id', 'version'], field);
    return { id: id(input.id, `${field}.id`), version: version(input.version, `${field}.version`) };
}
function itemList(value: unknown, field: string): ProductionItemQuantity[] {
    const items = list(value, field, 1).map((entry, index) => {
        const name = `${field}[${index}]`, input = record(entry, name); exact(input, ['itemId', 'quantity'], name);
        return { itemId: integer(input.itemId, `${name}.itemId`, 0, 65_535),
            quantity: integer(input.quantity, `${name}.quantity`, 1, 2_147_483_647) };
    });
    if (new Set(items.map(item => item.itemId)).size !== items.length) throw new Error(`${field} item ids must be unique`);
    return items;
}
function requirements(value: unknown, field: string): ProductionRequirements {
    const input = record(value, field);
    exact(input, ['personalSkills', 'facilityCapabilities', 'tools', 'knowledge', 'entitlements'], field);
    const personalSkills = list(input.personalSkills, `${field}.personalSkills`).map((entry, index) => {
        const name = `${field}.personalSkills[${index}]`, skill = record(entry, name);
        exact(skill, ['skillName', 'minimumLevel'], name);
        if (typeof skill.skillName !== 'string' || !skill.skillName.trim() || skill.skillName.length > 80) {
            throw new Error(`${name}.skillName is invalid`);
        }
        return { skillName: skill.skillName.trim(), minimumLevel: integer(skill.minimumLevel, `${name}.minimumLevel`, 1, 99) };
    });
    const facilityCapabilities = list(input.facilityCapabilities, `${field}.facilityCapabilities`)
        .map((entry, index) => id(entry, `${field}.facilityCapabilities[${index}]`));
    const tools: ProductionToolRequirement[] = list(input.tools, `${field}.tools`).map((entry, index) => {
        const name = `${field}.tools[${index}]`, tool = record(entry, name); exact(tool, ['itemId', 'quantity', 'capabilityId'], name);
        return { itemId: integer(tool.itemId, `${name}.itemId`, 0, 65_535),
            quantity: integer(tool.quantity, `${name}.quantity`, 1, 2_147_483_647),
            capabilityId: tool.capabilityId === null ? null : id(tool.capabilityId, `${name}.capabilityId`) };
    });
    const knowledge: ProductionKnowledgeRequirement[] = list(input.knowledge, `${field}.knowledge`).map((entry, index) => {
        const name = `${field}.knowledge[${index}]`, requirement = record(entry, name);
        exact(requirement, ['kind', 'id', 'version'], name);
        if (!KNOWLEDGE_KINDS.includes(requirement.kind as typeof KNOWLEDGE_KINDS[number])) throw new Error(`${name}.kind is invalid`);
        return { kind: requirement.kind as ProductionKnowledgeRequirement['kind'], id: id(requirement.id, `${name}.id`),
            version: version(requirement.version, `${name}.version`) };
    });
    const entitlements: ProductionEntitlementRequirement[] = list(input.entitlements, `${field}.entitlements`).map((entry, index) => {
        const name = `${field}.entitlements[${index}]`, entitlement = record(entry, name);
        exact(entitlement, ['kind', 'scopeId'], name);
        if (!ENTITLEMENT_KINDS.includes(entitlement.kind as typeof ENTITLEMENT_KINDS[number])) throw new Error(`${name}.kind is invalid`);
        return { kind: entitlement.kind as ProductionEntitlementRequirement['kind'],
            scopeId: id(entitlement.scopeId, `${name}.scopeId`) };
    });
    const unique = (values: string[], name: string) => { if (new Set(values).size !== values.length) throw new Error(`${name} must be unique`); };
    unique(personalSkills.map(entry => entry.skillName.toLowerCase()), `${field}.personalSkills`);
    unique(facilityCapabilities, `${field}.facilityCapabilities`);
    unique(tools.map(entry => `${entry.itemId}:${entry.capabilityId ?? ''}`), `${field}.tools`);
    unique(knowledge.map(entry => `${entry.kind}:${entry.id}:${entry.version}`), `${field}.knowledge`);
    unique(entitlements.map(entry => `${entry.kind}:${entry.scopeId}`), `${field}.entitlements`);
    return { personalSkills, facilityCapabilities, tools, knowledge, entitlements };
}
function recipe(value: unknown, index: number): ProductionRecipe {
    const field = `recipes[${index}]`, input = record(value, field);
    exact(input, ['recipeId', 'version', 'name', 'inputs', 'outputs', 'durationSimulationMinutes', 'executionSkill', 'requirements'], field);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error(`${field}.name is invalid`);
    return { recipeId: id(input.recipeId, `${field}.recipeId`), version: version(input.version, `${field}.version`),
        name: input.name.trim(), inputs: itemList(input.inputs, `${field}.inputs`), outputs: itemList(input.outputs, `${field}.outputs`),
        durationSimulationMinutes: integer(input.durationSimulationMinutes, `${field}.durationSimulationMinutes`, 1, 525_600),
        executionSkill: reference(input.executionSkill, `${field}.executionSkill`), requirements: requirements(input.requirements, `${field}.requirements`) };
}
function workflow(value: unknown, index: number): ProductionWorkflow {
    const field = `workflows[${index}]`, input = record(value, field);
    exact(input, ['workflowId', 'version', 'name', 'steps'], field);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error(`${field}.name is invalid`);
    const steps = list(input.steps, `${field}.steps`, 1).map((entry, stepIndex) => {
        const name = `${field}.steps[${stepIndex}]`, step = record(entry, name);
        exact(step, ['stepId', 'recipe', 'batches', 'dependsOn'], name);
        return { stepId: id(step.stepId, `${name}.stepId`), recipe: reference(step.recipe, `${name}.recipe`),
            batches: integer(step.batches, `${name}.batches`, 1, 1_000_000),
            dependsOn: list(step.dependsOn, `${name}.dependsOn`).map((dependency, dependencyIndex) =>
                id(dependency, `${name}.dependsOn[${dependencyIndex}]`)) };
    });
    return { workflowId: id(input.workflowId, `${field}.workflowId`), version: version(input.version, `${field}.version`),
        name: input.name.trim(), steps };
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function productionWorkflowCatalogDigest(value: Omit<ProductionWorkflowCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateProductionWorkflowCatalog(value: unknown): ProductionWorkflowCatalog {
    const input = record(value, 'Production workflow catalog');
    exact(input, ['schemaVersion', 'recipes', 'workflows'], 'Production workflow catalog');
    if (input.schemaVersion !== 1) throw new Error('Production workflow catalog schema version is invalid');
    const recipes = list(input.recipes, 'recipes', 1, 1_000).map(recipe);
    const workflows = list(input.workflows, 'workflows', 1, 1_000).map(workflow);
    const recipeKeys = recipes.map(entry => `${entry.recipeId}@${entry.version}`);
    const workflowKeys = workflows.map(entry => `${entry.workflowId}@${entry.version}`);
    if (new Set(recipeKeys).size !== recipeKeys.length || new Set(workflowKeys).size !== workflowKeys.length) {
        throw new Error('Production recipe and workflow versions must be unique');
    }
    const knownRecipes = new Set(recipeKeys);
    for (const entry of workflows) {
        const stepIds = entry.steps.map(step => step.stepId), knownSteps = new Set(stepIds);
        if (knownSteps.size !== stepIds.length) throw new Error(`${entry.workflowId} step ids must be unique`);
        for (const step of entry.steps) {
            if (!knownRecipes.has(`${step.recipe.id}@${step.recipe.version}`)) throw new Error(`${step.stepId} references an unknown recipe version`);
            if (new Set(step.dependsOn).size !== step.dependsOn.length || step.dependsOn.includes(step.stepId)
                || step.dependsOn.some(dependency => !knownSteps.has(dependency))) throw new Error(`${step.stepId} dependencies are invalid`);
        }
        const visiting = new Set<string>(), visited = new Set<string>();
        const visit = (stepId: string): void => { if (visiting.has(stepId)) throw new Error(`${entry.workflowId} contains a dependency cycle`);
            if (visited.has(stepId)) return; visiting.add(stepId);
            entry.steps.find(step => step.stepId === stepId)!.dependsOn.forEach(visit); visiting.delete(stepId); visited.add(stepId); };
        stepIds.forEach(visit);
    }
    const definition = { schemaVersion: 1 as const, recipes, workflows };
    return { ...definition, digest: productionWorkflowCatalogDigest(definition) };
}
