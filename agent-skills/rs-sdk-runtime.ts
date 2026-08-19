import type { BotActions } from '../sdk/actions';
import type { BotSDK } from '../sdk';
import type { SkillConditionName, SkillOperationName, SkillOperationResult, SkillRuntime } from './types';

function numberArg(args: Record<string, unknown>, key: string, fallback?: number, minimum = -Infinity, maximum = Infinity): number {
    const value = args[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${key} must be a finite number from ${minimum} to ${maximum}`);
    }
    return value;
}

function stringArg(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`);
    return value;
}

function selector(name: string, match: unknown): string | RegExp {
    if (match === 'exact') return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (match === undefined || match === 'contains') return name;
    throw new Error('match must be exact or contains');
}

function normalized(result: { success: boolean; message: string; reason?: string }): SkillOperationResult {
    return { success: result.success, message: result.message, code: result.reason };
}

function itemCount(items: Array<{ name: string; count: number }>, pattern: string | RegExp): number {
    return items.filter(item => typeof pattern === 'string'
        ? item.name.toLowerCase().includes(pattern.toLowerCase())
        : pattern.test(item.name))
        .reduce((total, item) => total + item.count, 0);
}

export class RsSdkSkillRuntime implements SkillRuntime {
    constructor(
        private readonly bot: BotActions,
        private readonly sdk: BotSDK
    ) {}

    async execute(operation: SkillOperationName, args: Record<string, unknown>, signal: AbortSignal): Promise<SkillOperationResult> {
        if (signal.aborted) return { success: false, message: 'Skill cancelled', code: 'cancelled' };
        switch (operation) {
            case 'walk-to':
                return normalized(await this.bot.walkTo(
                    numberArg(args, 'x', undefined, 0, 16_383),
                    numberArg(args, 'z', undefined, 0, 16_383),
                    numberArg(args, 'tolerance', 3, 0, 50)
                ));
            case 'interact-loc':
                return normalized(await this.bot.interactLoc(
                    selector(stringArg(args, 'name'), args.match),
                    (args.option as string | number | undefined) ?? 1
                ));
            case 'interact-npc':
                return normalized(await this.bot.interactNpc(
                    selector(stringArg(args, 'name'), args.match),
                    (args.option as string | number | undefined) ?? 1
                ));
            case 'gather-loc':
            case 'gather-npc': {
                const target = selector(stringArg(args, 'name'), args.match);
                const itemName = stringArg(args, 'item');
                const item = selector(itemName, 'contains');
                const option = (args.option as string | number | undefined) ?? 1;
                const skill = typeof args.skill === 'string' ? args.skill : null;
                const beforeItems = itemCount(this.sdk.getInventory(), item);
                const beforeXp = skill ? (this.sdk.getSkillXp(skill) ?? 0) : 0;
                const interaction = operation === 'gather-loc'
                    ? await this.bot.interactLoc(target, option)
                    : await this.bot.interactNpc(target, option);
                if (!interaction.success) return normalized(interaction);
                try {
                    const evidence = this.sdk.waitForCondition(() => {
                        if (itemCount(this.sdk.getInventory(), item) > beforeItems) return true;
                        return skill !== null && (this.sdk.getSkillXp(skill) ?? 0) > beforeXp;
                    }, numberArg(args, 'timeoutMs', 15_000, 100, 60_000));
                    let rejectAbort: (error: Error) => void = () => undefined;
                    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
                    const onAbort = () => rejectAbort(new Error('Skill cancelled'));
                    signal.addEventListener('abort', onAbort, { once: true });
                    try {
                        await Promise.race([evidence, aborted]);
                    } finally {
                        signal.removeEventListener('abort', onAbort);
                    }
                    return { success: true, message: `Gathered ${itemName}`, code: 'gathered' };
                } catch {
                    return { success: false, message: `No ${itemName} or ${skill ?? 'skill'} progress observed`, code: 'gather-timeout' };
                }
            }
            case 'open-bank':
                return normalized(await this.bot.openBank(numberArg(args, 'timeoutMs', 10_000, 100, 60_000)));
            case 'deposit-item':
                return normalized(await this.bot.depositItem(
                    selector(stringArg(args, 'name'), args.match),
                    numberArg(args, 'amount', -1, -1, 2_147_483_647)
                ));
            case 'withdraw-item':
                return normalized(await this.bot.withdrawItem(
                    selector(stringArg(args, 'name'), args.match),
                    numberArg(args, 'amount', 1, 1, 2_147_483_647),
                    { asNote: args.asNote === true }
                ));
            case 'close-bank':
                return normalized(await this.bot.closeBank());
            case 'wait-ticks':
                await this.sdk.waitForTicks(numberArg(args, 'ticks', undefined, 1, 100));
                return { success: true, message: 'Wait complete' };
        }
    }

    async test(condition: SkillConditionName, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
        if (signal.aborted) return false;
        const inventory = this.sdk.getInventory();
        switch (condition) {
            case 'inventory-full':
                return inventory.length >= 28;
            case 'inventory-free-slots-at-most':
                return 28 - inventory.length <= numberArg(args, 'slots', undefined, 0, 28);
            case 'inventory-contains': {
                const pattern = selector(stringArg(args, 'name'), args.match);
                const amount = numberArg(args, 'amount', 1, 1, 2_147_483_647);
                const matches = inventory.filter(item => typeof pattern === 'string'
                    ? item.name.toLowerCase().includes(pattern.toLowerCase())
                    : pattern.test(item.name));
                return matches.reduce((total, item) => total + item.count, 0) >= amount;
            }
            case 'skill-level-at-least':
                return (this.sdk.getSkill(stringArg(args, 'skill'))?.baseLevel ?? 0) >= numberArg(args, 'level', undefined, 1, 126);
        }
    }
}
