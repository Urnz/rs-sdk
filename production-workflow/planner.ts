import type {
    CompiledProductionWorkflow,
    ProductionItemQuantity,
    ProductionWorkflowCatalog,
    ProductionWorkflowStep
} from './types.js';

function quantities(values: Map<number, number>): ProductionItemQuantity[] {
    return [...values.entries()].filter(([, quantity]) => quantity > 0).sort(([left], [right]) => left - right)
        .map(([itemId, quantity]) => ({ itemId, quantity }));
}

export function compileProductionWorkflow(catalog: ProductionWorkflowCatalog, workflowId: string,
    version: string): CompiledProductionWorkflow {
    const workflow = catalog.workflows.find(entry => entry.workflowId === workflowId && entry.version === version);
    if (!workflow) throw new Error('Production workflow version is unknown');
    const remaining = new Map(workflow.steps.map(step => [step.stepId, step]));
    const ordered: ProductionWorkflowStep[] = [], completed = new Set<string>();
    while (remaining.size > 0) {
        const ready = workflow.steps.filter(step => remaining.has(step.stepId)
            && step.dependsOn.every(dependency => completed.has(dependency)));
        if (ready.length === 0) throw new Error('Production workflow cannot be ordered');
        for (const step of ready) { ordered.push(step); completed.add(step.stepId); remaining.delete(step.stepId); }
    }
    const ancestors = new Map<string, Set<string>>();
    for (const step of ordered) {
        const dependencies = new Set(step.dependsOn);
        step.dependsOn.forEach(dependency => ancestors.get(dependency)?.forEach(parent => dependencies.add(parent)));
        ancestors.set(step.stepId, dependencies);
    }
    const lots: Array<{ stepId: string; itemId: number; quantity: number }> = [];
    const externalInputs = new Map<number, number>();
    const steps = ordered.map(step => {
        const recipe = catalog.recipes.find(entry => entry.recipeId === step.recipe.id && entry.version === step.recipe.version)!;
        const inputs = recipe.inputs.map(item => ({ itemId: item.itemId, quantity: item.quantity * step.batches }));
        const outputs = recipe.outputs.map(item => ({ itemId: item.itemId, quantity: item.quantity * step.batches }));
        for (const input of inputs) {
            let outstanding = input.quantity;
            for (const lot of lots.filter(candidate => candidate.itemId === input.itemId
                && ancestors.get(step.stepId)!.has(candidate.stepId))) {
                const used = Math.min(outstanding, lot.quantity); lot.quantity -= used; outstanding -= used;
                if (outstanding === 0) break;
            }
            if (outstanding > 0) externalInputs.set(input.itemId, (externalInputs.get(input.itemId) ?? 0) + outstanding);
        }
        outputs.forEach(output => lots.push({ stepId: step.stepId, ...output }));
        return { stepId: step.stepId, recipe: step.recipe, batches: step.batches,
            durationSimulationMinutes: recipe.durationSimulationMinutes * step.batches,
            inputs, outputs, dependsOn: [...step.dependsOn] };
    });
    const finalOutputs = new Map<number, number>();
    lots.forEach(lot => finalOutputs.set(lot.itemId, (finalOutputs.get(lot.itemId) ?? 0) + lot.quantity));
    return { workflow: { id: workflow.workflowId, version: workflow.version }, catalogDigest: catalog.digest, steps,
        externalInputs: quantities(externalInputs), finalOutputs: quantities(finalOutputs),
        totalDurationSimulationMinutes: steps.reduce((sum, step) => sum + step.durationSimulationMinutes, 0) };
}
