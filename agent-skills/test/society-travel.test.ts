import { expect, test } from 'bun:test';
import type { BotActions } from '../../sdk/actions.js';
import type { BotSDK } from '../../sdk/index.js';
import { RsSdkSkillRuntime } from '../rs-sdk-runtime.js';
import { draftTrialAuthorization } from '../food-trials.js';
import { validateSkillDefinition } from '../validation.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fixture(x = 2924, z = 3179) {
    const p = { worldX: x, worldZ: z, level: 0, hp: 10, isDead: false, lifeId: 0 };
    const state = { player: p, inventory: [{ id: 995, count: 100 }], nearbyLocs: [] as unknown[],
        dialog: { isOpen: false, isWaiting: false, options: [] as { index: number; text: string }[] } };
    const calls: string[] = [];
    let age = 0, ferryApplies = true, choice = 'Yes please.';
    const bot = {
        walkTo: async (a: number, b: number) => { calls.push('walk'); p.worldX = a; p.worldZ = b; return { success: true }; },
        talkTo: async () => { calls.push('talk'); state.dialog = { isOpen: true, isWaiting: false, options: [{ index: 1, text: choice }] }; return { success: true }; },
        interactLoc: async () => { calls.push('plank'); p.level = 0; return { success: true }; }
    };
    const sdk = {
        getState: () => state, getStateAge: () => age, getInventory: () => state.inventory,
        waitForTicks: async () => undefined,
        waitForCondition: async (predicate: (s: typeof state) => boolean) => { if (!predicate(state)) throw Error('timeout'); },
        sendClickDialog: async () => {
            calls.push('dialog'); state.dialog.isOpen = false;
            if (ferryApplies) {
                const toIsland = p.worldX >= 3000;
                p.worldX = toIsland ? 2956 : 3032; p.worldZ = toIsland ? 3143 : 3217; p.level = 1;
                state.inventory[0]!.count -= 30;
                state.nearbyLocs = [{ name: 'Gangplank', x: p.worldX, z: p.worldZ, distance: 1 }];
            }
            return { success: true };
        }
    };
    const runtime = (gp: number, operations = ['travel-to-site']) => new RsSdkSkillRuntime(bot as unknown as BotActions, sdk as unknown as BotSDK,
        { operations: operations as ['travel-to-site'], itemNames: [], partners: [], maxQuantity: 0, maxUnitPriceGp: 0, maxGpPerRun: gp });
    return { state, p, calls, bot, sdk, runtime, stale: () => { age = 6000; }, noFerry: () => { ferryApplies = false; },
        choice: (text: string) => { choice = text; } };
}
const signal = () => new AbortController().signal;

test('native travel uses fresh position, reaches the exact site and spends nothing on same-island movement', async () => {
    const f = fixture(); const result = await f.runtime(0).execute('travel-to-site', { site: 'kitchen' }, signal());
    expect(result.success).toBe(true); expect(f.p.worldX).toBe(2815); expect(f.p.worldZ).toBe(3161);
    expect(result.data?.observedFeeGp).toBe(0); expect(f.calls).not.toContain('talk');
    expect(result.data?.receiptEligible).toBe(false);
});
test('missing operation grant, unknown destination, stale state and insufficient funds prevent physical dispatch', async () => {
    const f = fixture(3222, 3218);
    expect((await f.runtime(30, []).execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('authorization-operation');
    expect((await f.runtime(30).execute('travel-to-site', { site: 'arbitrary' }, signal())).code).toBe('travel-site-rejected');
    f.state.inventory[0]!.count = 29;
    expect((await f.runtime(30).execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('travel-funds-required');
    f.stale();
    expect((await f.runtime(30).execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('travel-state-unavailable');
    expect(f.calls).toEqual([]);
});
test('paid crossing needs an explicit budget, confirms the fee and disembarks before reaching the pier', async () => {
    const f = fixture(3222, 3218);
    expect((await f.runtime(0).execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('travel-budget-required');
    expect(f.calls).toEqual([]);
    const runtime = f.runtime(30), result = await runtime.execute('travel-to-site', { site: 'pier' }, signal());
    expect(result.success).toBe(true); expect(result.data?.observedFeeGp).toBe(30); expect(f.calls).toContain('plank');
    const count = f.calls.length;
    expect((await runtime.execute('travel-to-site', { site: 'housing' }, signal())).code).toBe('travel-budget-required');
    expect(f.calls.length).toBe(count);
});
test('a transport ACK without a ferry effect never establishes arrival and cannot repeat payment in the same run', async () => {
    const f = fixture(3222, 3218), runtime = f.runtime(30); f.noFerry();
    const result = await runtime.execute('travel-to-site', { site: 'pier' }, signal());
    expect(result.code).toBe('travel-ferry-unconfirmed'); expect(result.retryable).toBe(false);
    expect(f.calls.filter(c => c === 'dialog')).toHaveLength(1);
    expect((await runtime.execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('travel-budget-required');
});
test('an unknown dialog option is refused before any selection', async () => {
    const f = fixture(3222, 3218); f.choice('Pay 300 coins');
    expect((await f.runtime(30).execute('travel-to-site', { site: 'pier' }, signal())).code).toBe('travel-dialog-rejected');
    expect(f.calls).not.toContain('dialog');
});
test('arrival observed after a negative walk response counts, but an ACK without arrival does not', async () => {
    const f = fixture(2972, 3333);
    let pending = { x: f.p.worldX, z: f.p.worldZ };
    f.bot.walkTo = async (x: number, z: number) => { pending = { x, z }; return { success: false }; };
    f.sdk.waitForCondition = async () => { f.p.worldX = pending.x; f.p.worldZ = pending.z; };
    expect((await f.runtime(0).execute('travel-to-site', { site: 'housing' }, signal())).success).toBe(true);
    const blocked = fixture(); blocked.bot.walkTo = async () => ({ success: true });
    expect((await blocked.runtime(0).execute('travel-to-site', { site: 'kitchen' }, signal())).code).toBe('travel-route-blocked');
});

test('housing enters the northern doorway before approaching the beds from the clear side', async () => {
    const f = fixture(2974, 3333), positions: number[][] = [], walk = f.bot.walkTo;
    f.bot.walkTo = async (x: number, z: number) => {
        positions.push([x, z]);
        if (x === 2972 && z === 3331 && f.p.worldZ !== 3335) return { success: false };
        return walk(x, z);
    };
    expect((await f.runtime(0).execute('travel-to-site', { site: 'housing' }, signal())).success).toBeTrue();
    expect(positions).toEqual([[2971, 3337], [2972, 3335], [2972, 3331]]);
    expect(f.calls).not.toContain('talk');
});
test('a reconnected actor already aboard disembarks without buying another crossing', async () => {
    const f = fixture(2956, 3143); f.p.level = 1;
    f.state.nearbyLocs = [{ name: 'Gangplank', x: 2956, z: 3144, distance: 1 }];
    expect((await f.runtime(0).execute('travel-to-site', { site: 'pier' }, signal())).success).toBe(true);
    expect(f.calls).toContain('plank'); expect(f.calls).not.toContain('talk');
});
test('a west-island actor takes the observed road before the ferry rather than approaching through the blocked building', async () => {
    const f = fixture(2804, 3177), visits: number[] = [];
    const original = f.bot.walkTo;
    f.bot.walkTo = async (x: number, z: number) => {
        visits.push(x);
        if (x === 2954 && f.p.worldX < 2820) return { success: false };
        return original(x, z);
    };
    f.choice('Ok.');
    expect((await f.runtime(30).execute('travel-to-site', { site: 'housing' }, signal())).success).toBe(true);
    expect(visits.slice(0, 2)).toEqual([2820, 2954]);
});
test('draft travel is valid but cannot retry or continue after an uncertain economic step', () => {
    const draft = JSON.parse(readFileSync(resolve(import.meta.dir, '../catalog/procedure.travel.native-sites@0.1.0.skill.json'), 'utf8'));
    expect(validateSkillDefinition(draft).status).toBe('draft');
    expect(draftTrialAuthorization(draft)).toMatchObject({ operations: ['travel-to-site'], maxGpPerRun: 30 });
    expect(() => draftTrialAuthorization({ ...draft, steps: [...draft.steps, ...draft.steps] })).toThrow('single bounded');
    draft.steps[0].maxAttempts = 2; expect(() => validateSkillDefinition(draft)).toThrow('one attempt');
});
