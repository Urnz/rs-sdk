import type { BotActions } from '../sdk/actions.js';
import type { BotSDK } from '../sdk/index.js';
import type { SkillOperationResult } from './types.js';

/** Fixed local/private native sites; callers cannot post arbitrary ferry targets or dialog text. */
export const SOCIETY_TRAVEL_SITES = {
    kitchen: { x: 2815, z: 3161, level: 0, region: 'island' },
    pier: { x: 2924, z: 3179, level: 0, region: 'island' },
    housing: { x: 2972, z: 3331, level: 0, region: 'mainland' }
} as const;

/** SDK evidence is diagnostic, never a canonical coin-sink or economic settlement receipt. */
export async function travelToSocietySite(bot: BotActions, sdk: BotSDK, site: unknown, signal: AbortSignal,
    reserveFerryBudget: () => boolean): Promise<SkillOperationResult> {
    if (typeof site !== 'string' || !Object.hasOwn(SOCIETY_TRAVEL_SITES, site))
        return { success: false, code: 'travel-site-rejected', message: 'Unknown native travel site', retryable: false };
    const target = SOCIETY_TRAVEL_SITES[site as keyof typeof SOCIETY_TRAVEL_SITES];
    const before = sdk.getState(), lifeId = before?.player?.lifeId;
    const coins = () => sdk.getInventory().filter(i => i.id === 995).reduce((n, i) => n + i.count, 0);
    const position = () => {
        const s = sdk.getState(), p = s?.player;
        if (signal.aborted || sdk.getStateAge() > 5000 || !p || p.isDead || p.hp <= 0 || p.lifeId !== lifeId)
            throw Error('travel-state-unavailable');
        return { x: p.worldX, z: p.worldZ, level: p.level };
    };
    const region = (p: ReturnType<typeof position>) => p.x >= 2700 && p.x < 3000 && p.z >= 2900 && p.z < 3200
        ? 'island' : p.x >= 2900 && p.x <= 3400 && p.z >= 3200 && p.z <= 3500 ? 'mainland' : null;
    const trace: unknown[] = [], initialCoins = coins();
    let feeReserved = false, ferry = false;
    const walk = async (x: number, z: number, tolerance: number) => {
        position(); const result = await bot.walkTo(x, z, tolerance);
        const arrived = () => { const p = position(); return p.level === 0
            && Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= tolerance; };
        if (!arrived()) {
            try { await sdk.waitForCondition(() => arrived(), 3000); } catch { /* Keep the actual failed position below. */ }
        }
        const p = position(); trace.push({ stage: 'walk', x, z, result, position: p });
        if (!arrived()) throw Error('travel-route-blocked');
    };
    const disembark = async () => {
        const p = position(); if (p.level === 0) return;
        const dock = region(p) === 'island' ? { x: 2956, z: 3144 } : { x: 3032, z: 3217 };
        if (p.level !== 1 || Math.max(Math.abs(p.x - dock.x), Math.abs(p.z - dock.z)) > 4)
            throw Error('travel-floor-rejected');
        const plank = sdk.getState()?.nearbyLocs.filter(l => /^gangplank$/i.test(l.name)
            && Math.max(Math.abs(l.x - dock.x), Math.abs(l.z - dock.z)) <= 4).sort((a, b) => a.distance - b.distance)[0];
        if (!plank) throw Error('travel-gangplank-unavailable');
        position(); const result = await bot.interactLoc(plank, 'Cross');
        trace.push({ stage: 'disembark', result });
        await sdk.waitForCondition(s => s.player?.level === 0, 10000);
        if (position().level !== 0 || region(position()) !== region(p)) throw Error('travel-disembarkation-unconfirmed');
    };
    const islandRoad = async () => {
        const p = position();
        if (region(p) === 'island' && p.x < 2820) await walk(2820, 3185, 2);
    };
    try {
        let current = position();
        if (!region(current)) throw Error('travel-region-rejected');
        await disembark(); current = position();
        if (region(current) !== target.region) {
            ferry = true;
            if (sdk.getInventory().some(i => i.id === 431 || /rum/i.test(i.name))) throw Error('travel-customs-cargo-rejected');
            if (coins() < 30) throw Error('travel-funds-required');
            if (!reserveFerryBudget()) throw Error('travel-budget-required');
            feeReserved = true;
            const toIsland = target.region === 'island';
            await islandRoad();
            await walk(toIsland ? 3027 : 2954, toIsland ? 3218 : 3147, 2);
            const beforeFee = coins(); position();
            const talked = await bot.talkTo(toIsland ? /^Captain Tobias$/i : /^Customs officer$/i);
            trace.push({ stage: 'talk', result: talked });
            if (!talked.success) throw Error('travel-ferry-unavailable');
            const allowed = toIsland ? /^(Click here to continue|Yes please\.)$/i
                : /^(Click here to continue|Can I journey on this ship\?|Search away, I have nothing to hide\.|Ok\.)$/i;
            for (let page = 0; page < 80 && region(position()) !== target.region; page++) {
                const dialog = sdk.getState()?.dialog;
                if (dialog?.isOpen && !dialog.isWaiting) {
                    const selected = dialog.options.find(o => allowed.test(o.text));
                    if (dialog.options.length && !selected) throw Error('travel-dialog-rejected');
                    position(); await sdk.sendClickDialog(selected?.index ?? 0);
                    trace.push({ stage: 'dialog', selected: selected?.text ?? 'continue' });
                }
                await sdk.waitForTicks(1);
            }
            if (region(position()) !== target.region || beforeFee - coins() !== 30) throw Error('travel-ferry-unconfirmed');
            await sdk.waitForCondition(s => s.nearbyLocs.some(l => /^gangplank$/i.test(l.name)), 10000);
            await disembark();
        }
        // The intermediate road avoids the Brimhaven building approach from the north-west.
        if (site === 'kitchen' && position().x > 2820) await walk(2820, 3185, 2);
        if (site === 'pier') await islandRoad();
        // Enter the bed room through its northern doorway. The east-side direct
        // approach runs into the continuous bed/drawer row at x=2973.
        if (site === 'housing') {
            await walk(2971, 3337, 0);
            await walk(2972, 3335, 0);
        }
        await walk(target.x, target.z, 0);
        return { success: true, code: 'travel-arrived', message: `Arrived at ${site}`, retryable: false,
            data: { site, target, positionBefore: before?.player && { x: before.player.worldX, z: before.player.worldZ, level: before.player.level },
                positionAfter: position(), ferry, observedFeeGp: initialCoins - coins(), source: 'sdk-observation', trusted: false, receiptEligible: false, trace } };
    } catch (error) {
        return { success: false, code: error instanceof Error ? error.message : 'travel-interrupted',
            message: 'Travel stopped; inspect the current position and inventory before another route', retryable: false,
            data: { site, ferry, feeReserved, observedCoinDelta: coins() - initialCoins, source: 'sdk-observation', trusted: false, receiptEligible: false, trace } };
    }
}
