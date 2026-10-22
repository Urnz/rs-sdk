/** Local/private society food commands. Outcomes are read from canonical native sources by the gateway. */
export type SocietyFoodOperation = 'food-gather' | 'food-cook' | 'food-consume';
export interface NativeFoodSkillCommand {
    operation: 'gather' | 'consume'; actionId: string; username: string;
    sourceId: string | null; slot: number;
}
export interface SocietyFoodContext {
    runId: string;
    skill: { id: string; version: string };
    stepId: string;
    parametersDigest: string;
}
export interface SocietyFoodRequest {
    operation: SocietyFoodOperation;
    args: Record<string, unknown>;
    context: SocietyFoodContext;
}
/** Historical test route and the actual packed Brimhaven range. The backend
 * additionally requires the exact reserved kitchen policy, worker and batch. */
export function isSocietyKitchenRoute(x: unknown, z: unknown): boolean {
    return x === 2926 && z === 3180 || x === 2814 && z === 3161;
}
export function validateSocietyFoodRequest(input: SocietyFoodRequest): SocietyFoodRequest {
    const { operation, args, context } = input ?? {};
    const fields = operation === 'food-gather' ? ['item', 'itemId', 'amount', 'sourceId', 'timeoutMs']
        : operation === 'food-cook' ? ['item', 'itemId', 'amount', 'kitchenRunId', 'batchId', 'heatX', 'heatZ', 'timeoutMs']
        : operation === 'food-consume' ? ['item', 'itemId', 'amount', 'slot', 'timeoutMs'] : [];
    if (Object.keys(input ?? {}).sort().join(',') !== 'args,context,operation' || !fields.length || !args || Array.isArray(args)
        || Object.keys(args).some(key => !fields.includes(key)) || fields.some(key => !(key in args))
        || args.amount !== 1 || args.itemId !== (operation === 'food-consume' ? 379 : 377)
        || args.item !== (operation === 'food-consume' ? 'Lobster' : 'Raw lobster')
        || !Number.isSafeInteger(args.timeoutMs) || Number(args.timeoutMs) < 100 || Number(args.timeoutMs) > 60_000
        || !context || Object.keys(context).sort().join(',') !== 'parametersDigest,runId,skill,stepId'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(context.runId)
        || !/^[a-f0-9]{64}$/.test(context.parametersDigest) || typeof context.stepId !== 'string'
        || !/^[a-zA-Z0-9._/-]{1,200}$/.test(context.stepId) || !context.skill
        || Object.keys(context.skill).sort().join(',') !== 'id,version'
        || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(context.skill.id) || !/^\d+\.\d+\.\d+$/.test(context.skill.version)
        || (operation === 'food-gather' && args.sourceId !== 'musa-point-lobster')
        || (operation === 'food-consume' && (!Number.isSafeInteger(args.slot) || Number(args.slot) < 0 || Number(args.slot) > 27))
        || (operation === 'food-cook' && (!isSocietyKitchenRoute(args.heatX, args.heatZ)
            || !/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(String(args.kitchenRunId))
            || typeof args.batchId !== 'string' || args.batchId.length < 1 || args.batchId.length > 200)))
        throw new Error('Invalid bounded society food request');
    return structuredClone(input);
}
