import type { AutonomousParameterLimit, AutonomousSkillAuthorization } from '../../../llm-runtime/types.js';
import type { SkillArguments, SkillDefinition, SkillOperationName, SkillStep, SkillValue } from '../../../agent-skills/types.js';

export interface AuthorizationEnvelopeResult {
    allowed: boolean;
    reason: string;
    reservedGp: number;
}

const ROUTINE_OPERATIONS: SkillOperationName[] = ['walk-to', 'wait-for-area', 'talk-to-npc', 'navigate-dialog',
    'interact-loc', 'interact-npc', 'gather-loc', 'gather-npc', 'smith-at-anvil', 'open-shop', 'sell-to-shop',
    'close-shop', 'open-bank', 'deposit-item', 'withdraw-item', 'close-bank', 'wait-ticks'];
const NAMED_ITEM_OPERATIONS = new Set<SkillOperationName>(['buy-from-shop', 'sell-to-shop', 'deposit-item',
    'withdraw-item', 'trade-give-item', 'trade-receive-item']);

function operations(steps: readonly SkillStep[]): Array<{ operation: SkillOperationName; arguments: SkillArguments }> {
    return steps.flatMap(step => step.kind === 'operation' ? [{ operation: step.operation, arguments: step.arguments }]
        : step.kind === 'repeat' ? operations(step.steps) : []);
}

function resolve(value: SkillValue | undefined, parameters: Record<string, string | number | boolean>): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'parameter' in value
        && typeof value.parameter === 'string') return parameters[value.parameter];
    return value;
}

function within(value: string | number | boolean, limit: AutonomousParameterLimit): boolean {
    if (limit.exact !== undefined && !Object.is(value, limit.exact)) return false;
    if (limit.oneOf && !limit.oneOf.some(item => Object.is(item, value))) return false;
    if (typeof value === 'number' && limit.minimum !== undefined && value < limit.minimum) return false;
    if (typeof value === 'number' && limit.maximum !== undefined && value > limit.maximum) return false;
    return true;
}

/** Checks a resolved dispatch against its exact-version, human-authored envelope. */
export function evaluateAuthorizationEnvelope(authorization: AutonomousSkillAuthorization,
    definition: SkillDefinition, parameters: Record<string, string | number | boolean>): AuthorizationEnvelopeResult {
    const reference = `${definition.id}@${definition.version}`;
    if (authorization.id !== definition.id || authorization.version !== definition.version) {
        return { allowed: false, reason: `Authorization does not match ${reference}.`, reservedGp: 0 };
    }
    const parameterLimits = authorization.parameters ?? {};
    const allowedOperations = authorization.operations ?? ROUTINE_OPERATIONS;
    const itemNames = authorization.itemNames ?? [];
    const partners = authorization.partners ?? [];
    const maxQuantity = authorization.maxQuantity ?? 28;
    const maxUnitPriceGp = authorization.maxUnitPriceGp ?? 0;
    const maxGpPerRun = authorization.maxGpPerRun ?? 0;
    const maxGpPerDay = authorization.maxGpPerDay ?? 0;
    for (const [name, value] of Object.entries(parameters)) {
        const limit = parameterLimits[name];
        const defaultValue = definition.parameters[name]?.default;
        if (!limit && !Object.is(value, defaultValue)) {
            return { allowed: false, reason: `${name} differs from its reviewed default without an explicit limit.`, reservedGp: 0 };
        }
        if (limit && !within(value, limit)) {
            return { allowed: false, reason: `${name} exceeds its autonomous parameter limit.`, reservedGp: 0 };
        }
    }
    let maximumSpend = 0;
    for (const step of operations(definition.steps)) {
        if (!allowedOperations.includes(step.operation)) {
            return { allowed: false, reason: `Operation ${step.operation} is outside the authorization envelope.`, reservedGp: 0 };
        }
        const amountValue = resolve(step.arguments.amount, parameters);
        const quantity = amountValue === -1 ? Math.min(28, maxQuantity) : amountValue;
        if (typeof quantity === 'number' && (!Number.isSafeInteger(quantity) || quantity < 0
            || quantity > maxQuantity)) {
            return { allowed: false, reason: `Operation ${step.operation} exceeds the quantity limit.`, reservedGp: 0 };
        }
        const itemValue = resolve(step.arguments.item ?? (NAMED_ITEM_OPERATIONS.has(step.operation)
            ? step.arguments.name : undefined), parameters);
        const item = typeof itemValue === 'string' ? itemValue.trim().toLowerCase() : null;
        if (itemNames.length > 0 && item && !itemNames.includes(item)) {
            return { allowed: false, reason: `Item ${itemValue} is outside the authorization envelope.`, reservedGp: 0 };
        }
        if (step.operation === 'buy-from-shop') {
            if (authorization.risk !== 'shop-buy' || step.arguments.match !== 'exact'
                || !item || !itemNames.includes(item)) {
                return { allowed: false, reason: 'Shop buying requires a separate exact-item authorization.', reservedGp: 0 };
            }
            maximumSpend += (typeof quantity === 'number' ? quantity : maxQuantity) * maxUnitPriceGp;
        }
        if (step.operation === 'open-shop' && partners.length > 0) {
            const shopkeeperValue = resolve(step.arguments.name, parameters);
            const shopkeeper = typeof shopkeeperValue === 'string' ? shopkeeperValue.trim().toLowerCase() : '';
            if (step.arguments.match !== 'exact' || !shopkeeper || !partners.includes(shopkeeper)) {
                return { allowed: false, reason: 'Shop access requires an exact shopkeeper authorization.',
                    reservedGp: 0 };
            }
        }
        if (step.operation === 'trade-give-item' || step.operation === 'trade-receive-item') {
            const partnerValue = resolve(step.arguments.player, parameters);
            const partner = typeof partnerValue === 'string' ? partnerValue.trim().toLowerCase() : '';
            if (authorization.risk !== 'player-trade' || step.arguments.match !== 'exact'
                || step.arguments.itemMatch !== 'exact' || !partner || !partners.includes(partner)
                || !item || !itemNames.includes(item)) {
                return { allowed: false, reason: 'Player trade requires an exact partner and item authorization.', reservedGp: 0 };
            }
        }
    }
    if (maximumSpend > maxGpPerRun || maxGpPerRun > maxGpPerDay) {
        return { allowed: false, reason: 'Worst-case spend exceeds the run or daily GP limit.', reservedGp: 0 };
    }
    return { allowed: true, reason: `${reference} passed its exact authorization envelope.`,
        reservedGp: maximumSpend };
}
