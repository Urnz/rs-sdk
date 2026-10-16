export interface VersionedReference { id: string; version: string }
export interface ProductionItemQuantity { itemId: number; quantity: number }
export interface PersonalSkillRequirement { skillName: string; minimumLevel: number }
export interface ProductionToolRequirement { itemId: number; quantity: number; capabilityId: string | null }
export interface ProductionKnowledgeRequirement extends VersionedReference {
    kind: 'semantic-knowledge' | 'organization-license' | 'verified-procedure';
}
export interface ProductionEntitlementRequirement {
    kind: 'employment' | 'lease' | 'contract' | 'explicit';
    scopeId: string;
}
export interface ProductionRequirements {
    personalSkills: PersonalSkillRequirement[];
    facilityCapabilities: string[];
    tools: ProductionToolRequirement[];
    knowledge: ProductionKnowledgeRequirement[];
    entitlements: ProductionEntitlementRequirement[];
}
export interface ProductionRecipe {
    recipeId: string;
    version: string;
    name: string;
    inputs: ProductionItemQuantity[];
    outputs: ProductionItemQuantity[];
    durationSimulationMinutes: number;
    executionSkill: VersionedReference;
    requirements: ProductionRequirements;
}
export interface ProductionWorkflowStep {
    stepId: string;
    recipe: VersionedReference;
    batches: number;
    dependsOn: string[];
}
export interface ProductionWorkflow {
    workflowId: string;
    version: string;
    name: string;
    steps: ProductionWorkflowStep[];
}
export interface ProductionWorkflowCatalog {
    schemaVersion: 1;
    recipes: ProductionRecipe[];
    workflows: ProductionWorkflow[];
    digest: string;
}
export interface CompiledProductionStep {
    stepId: string;
    recipe: VersionedReference;
    batches: number;
    durationSimulationMinutes: number;
    inputs: ProductionItemQuantity[];
    outputs: ProductionItemQuantity[];
    dependsOn: string[];
}
export interface CompiledProductionWorkflow {
    workflow: VersionedReference;
    catalogDigest: string;
    steps: CompiledProductionStep[];
    externalInputs: ProductionItemQuantity[];
    finalOutputs: ProductionItemQuantity[];
    totalDurationSimulationMinutes: number;
}
