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

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
    const value = args[key];
    if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string' || entry.length === 0)) {
        throw new Error(`${key} must be a non-empty string array`);
    }
    return value as string[];
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

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('Skill cancelled');
    let rejectAbort: (error: Error) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(new Error('Skill cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        return await Promise.race([promise, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
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
            case 'wait-for-area': {
                const x = numberArg(args, 'x', undefined, 0, 16_383);
                const z = numberArg(args, 'z', undefined, 0, 16_383);
                const tolerance = numberArg(args, 'tolerance', 3, 0, 50);
                try {
                    await withAbort(this.sdk.waitForCondition(state => {
                        const playerX = state.player?.worldX;
                        const playerZ = state.player?.worldZ;
                        return playerX !== undefined && playerZ !== undefined
                            && Math.abs(playerX - x) <= tolerance
                            && Math.abs(playerZ - z) <= tolerance;
                    }, numberArg(args, 'timeoutMs', 30_000, 100, 60_000)), signal);
                    return { success: true, message: `Arrived near (${x}, ${z})`, code: 'area-reached' };
                } catch {
                    return { success: false, message: `Did not arrive near (${x}, ${z})`, code: 'area-timeout' };
                }
            }
            case 'talk-to-npc':
                return normalized(await this.bot.talkTo(selector(stringArg(args, 'name'), args.match)));
            case 'navigate-dialog': {
                const allowedChoices = stringArrayArg(args, 'choices');
                const maxSteps = numberArg(args, 'maxSteps', 20, 1, 50);
                const timeoutMs = numberArg(args, 'timeoutMs', 15_000, 100, 60_000);
                try {
                    await withAbort(this.sdk.waitForCondition(state => state.dialog.isOpen, timeoutMs), signal);
                } catch {
                    return { success: false, message: 'Dialog did not open', code: 'dialog-not-open' };
                }
                for (let step = 1; step <= maxSteps; step++) {
                    const dialog = this.sdk.getState()?.dialog;
                    if (!dialog?.isOpen) {
                        return { success: true, message: `Dialog completed after ${step - 1} clicks`, code: 'dialog-completed' };
                    }
                    const options = dialog.options;
                    const selected = allowedChoices.find(choice => options.some(option =>
                        option.text.toLowerCase().includes(choice.toLowerCase())
                    ));
                    const continueOption = options.find(option => /^click here to continue$/i.test(option.text));
                    if (!selected && !continueOption && options.length > 0) {
                        const available = options.map(option => option.text).join(', ');
                        return { success: false, message: `No allowed dialog choice; available: ${available}`, code: 'dialog-choice-not-allowed' };
                    }
                    if (selected) await this.sdk.clickDialogByText(selected);
                    else await this.sdk.sendClickDialog(continueOption?.index ?? 0);
                    await withAbort(this.sdk.waitForTicks(1), signal);
                }
                if (!this.sdk.getState()?.dialog.isOpen) {
                    return { success: true, message: `Dialog completed after ${maxSteps} clicks`, code: 'dialog-completed' };
                }
                return { success: false, message: `Dialog exceeded ${maxSteps} clicks`, code: 'dialog-step-limit' };
            }
            case 'interact-loc': {
                const name = stringArg(args, 'name');
                const nameSelector = selector(name, args.match);
                let target: Parameters<BotActions['interactLoc']>[0] = nameSelector;
                if (args.x !== undefined || args.z !== undefined) {
                    await this.bot.dismissBlockingUI();
                    const x = numberArg(args, 'x', undefined, 0, 16_383);
                    const z = numberArg(args, 'z', undefined, 0, 16_383);
                    const option = args.option as string | number | undefined;
                    const findLoc = () => this.sdk.getNearbyLocs().find(entry => {
                        const nameMatches = typeof nameSelector === 'string'
                            ? entry.name.toLowerCase().includes(nameSelector.toLowerCase())
                            : nameSelector.test(entry.name);
                        const optionMatches = typeof option !== 'string' || entry.optionsWithIndex.some(candidate => {
                            try {
                                return new RegExp(option, 'i').test(candidate.text);
                            } catch {
                                return candidate.text.toLowerCase().includes(option.toLowerCase());
                            }
                        });
                        return entry.x === x && entry.z === z && nameMatches && optionMatches;
                    });
                    let loc = findLoc();
                    if (!loc) {
                        try {
                            await withAbort(this.sdk.waitForCondition(() => {
                                loc = findLoc();
                                return loc !== undefined;
                            }, numberArg(args, 'timeoutMs', 5_000, 100, 60_000)), signal);
                        } catch {
                            if (signal.aborted) return { success: false, message: 'Skill cancelled', code: 'cancelled' };
                        }
                    }
                    if (!loc) return {
                        success: false,
                        message: `Location not found: ${name} at (${x}, ${z})`,
                        code: 'loc-not-found-at-coordinate'
                    };
                    target = loc;
                }
                return normalized(await this.bot.interactLoc(
                    target,
                    (args.option as string | number | undefined) ?? 1
                ));
            }
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
                const timeoutMs = numberArg(args, 'timeoutMs', 15_000, 100, 300_000);
                const maxRetargets = numberArg(args, 'maxRetargets', 20, 1, 100);
                const deadline = Date.now() + timeoutMs;
                let interactions = 0;
                let lastInteraction: SkillOperationResult | null = null;
                while (Date.now() < deadline && interactions < maxRetargets) {
                    if (signal.aborted) return { success: false, message: 'Skill cancelled', code: 'cancelled' };
                    const interaction = operation === 'gather-loc'
                        ? await this.bot.interactLoc(target, option)
                        : await this.bot.interactNpc(target, option);
                    lastInteraction = normalized(interaction);
                    interactions++;

                    const remaining = deadline - Date.now();
                    if (remaining <= 0) break;
                    const targetMayStillBeActive = interaction.success || interaction.reason === 'rejected';
                    const evidenceWindow = Math.max(100, Math.min(targetMayStillBeActive ? 15_000 : 3_000, remaining));
                    try {
                        await withAbort(this.sdk.waitForCondition(() => {
                            if (itemCount(this.sdk.getInventory(), item) > beforeItems) return true;
                            return skill !== null && (this.sdk.getSkillXp(skill) ?? 0) > beforeXp;
                        }, evidenceWindow), signal);
                        return {
                            success: true,
                            message: `Gathered ${itemName} after ${interactions} target interaction${interactions === 1 ? '' : 's'}`,
                            code: 'gathered',
                            data: { interactions }
                        };
                    } catch {
                        if (signal.aborted) return { success: false, message: 'Skill cancelled', code: 'cancelled' };
                    }
                }
                return {
                    success: false,
                    message: `No ${itemName} or ${skill ?? 'skill'} progress observed; retargeted ${interactions} times`,
                    code: 'gather-timeout',
                    data: { interactions, lastInteraction }
                };
            }
            case 'smith-at-anvil': {
                const bar = typeof args.bar === 'string'
                    ? new RegExp(args.bar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
                    : undefined;
                return normalized(await this.bot.smithAtAnvil(stringArg(args, 'product'), {
                    barPattern: bar,
                    timeout: numberArg(args, 'timeoutMs', 10_000, 100, 60_000)
                }));
            }
            case 'open-shop':
                return normalized(await this.bot.openShop(args.name === undefined
                    ? undefined
                    : selector(stringArg(args, 'name'), args.match)));
            case 'buy-from-shop':
                return normalized(await this.bot.buyFromShop(
                    selector(stringArg(args, 'name'), args.match),
                    numberArg(args, 'amount', undefined, 1, 10_000)
                ));
            case 'sell-to-shop':
                return normalized(await this.bot.sellToShop(
                    selector(stringArg(args, 'name'), args.match),
                    numberArg(args, 'amount', undefined, -1, 10_000)
                ));
            case 'close-shop':
                return normalized(await this.bot.closeShop(numberArg(args, 'timeoutMs', 5_000, 100, 60_000)));
            case 'trade-give-item':
                return normalized(await this.bot.trade(
                    selector(stringArg(args, 'player'), args.match),
                    {
                        give: [{
                            item: selector(stringArg(args, 'item'), args.itemMatch),
                            amount: numberArg(args, 'amount', undefined, 1, 2_147_483_647)
                        }],
                        want: [],
                        requestTimeout: numberArg(args, 'requestTimeoutMs', 30_000, 1_000, 120_000),
                        timeout: numberArg(args, 'timeoutMs', 60_000, 1_000, 180_000),
                        retryOnBusy: true
                    }
                ));
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
            case 'inventory-free-slots-at-least':
                return 28 - inventory.length >= numberArg(args, 'slots', undefined, 0, 28);
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
