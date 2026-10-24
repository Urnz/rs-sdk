import type { SkillDefinition, SkillRuntimeAuthorization } from './types.js';
import { resolveSkillParameters } from './validation.js';
import { toolTrialAuthorization } from './tool-trials.js';

/** The acknowledged isolated travel trial permits one fixed route and at most one 30 GP ferry. */
export function draftTrialAuthorization(draft: SkillDefinition): SkillRuntimeAuthorization | undefined {
    if (!draft.steps.some(step => step.kind === 'operation' && step.operation === 'travel-to-site')) return toolTrialAuthorization(draft) ?? foodTrialAuthorization(draft);
    if (draft.steps.length !== 1 || draft.steps[0]?.kind !== 'operation' || draft.steps[0].operation !== 'travel-to-site'
        || draft.limits.maxOperations !== 1 || draft.limits.timeoutMs > 360000)
        throw new Error('Travel trial requires a single bounded native route');
    return { operations: ['travel-to-site'], itemNames: [], partners: [], maxQuantity: 0, maxUnitPriceGp: 0, maxGpPerRun: 30 };
}

/** The existing acknowledged draft-trial action grants only the exact bounded food primitives in that draft. */
export function foodTrialAuthorization(draft: SkillDefinition): SkillRuntimeAuthorization | undefined {
    if (!draft.steps.some(step => step.kind === 'operation' && step.operation.startsWith('food-'))) return undefined;
    if (draft.steps.some(step => step.kind !== 'operation' || !['walk-to', 'food-gather', 'food-cook', 'food-consume'].includes(step.operation)))
        throw new Error('Food trial requires a narrow food-only draft');
    return { operations: draft.steps.flatMap(step => step.kind === 'operation' ? [step.operation] : []),
        itemNames: draft.steps.some(step => step.kind === 'operation' && step.operation === 'food-consume')
            ? ['lobster'] : ['raw lobster', 'lobster'], partners: [], maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0 };
}
export function foodTrialParameters(draft: SkillDefinition, original: Record<string, string | number | boolean>, input: unknown) {
    if (input === undefined) return original;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid native trial bindings');
    for (const key of Object.keys(input)) if (draft.parameters[key]?.verification !== 'native-invocation')
        throw new Error('Only exact native invocation bindings may change between trials');
    return resolveSkillParameters(draft, { ...original, ...input });
}
export function matchesFoodTrialParameters(draft: SkillDefinition, actual: unknown, expected: Record<string, string | number | boolean>): boolean {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    try {
        const resolved = resolveSkillParameters(draft, actual as Record<string, unknown>);
        const sorted = (values: object) => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
        if (sorted(resolved) !== sorted(actual)) return false;
        const functional = (values: object) => Object.fromEntries(Object.entries(values)
            .filter(([key]) => draft.parameters[key]?.verification !== 'native-invocation'));
        return sorted(functional(actual)) === sorted(functional(expected));
    } catch { return false; }
}
