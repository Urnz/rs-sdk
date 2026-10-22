import type { LivelihoodAction } from '../../../agent-state/livelihood.js';

export const LIVELIHOOD_POLICY = { id: 'society-livelihood', version: '1.0.0' } as const;
export const LIVELIHOOD_POLICY_KEY = `${LIVELIHOOD_POLICY.id}@${LIVELIHOOD_POLICY.version}`;
export const LIVELIHOOD_BINDING_SOURCE = `${LIVELIHOOD_POLICY.id}:${LIVELIHOOD_POLICY.version}`;
export function isLivelihoodPolicy(value: { policyId: string; policyVersion: string } | null): boolean {
    return value?.policyId === LIVELIHOOD_POLICY.id && value.policyVersion === LIVELIHOOD_POLICY.version;
}
// Source-controlled, identical for every enrolled avatar; no actor names or model parameters.
export const LIVELIHOOD_THRESHOLDS = { hunger: 6000, fatigue: 7000, wakeFatigue: 2500 } as const;
export interface LivelihoodSnapshot {
    lifecycle: string; alive: boolean; role: 'player' | 'business'; clockRunning: boolean;
    physicalAllowed: boolean; needs: { hunger: number; fatigue: number; sleeping: boolean } | null;
    food?: LivelihoodAction; rest?: LivelihoodAction; wake?: LivelihoodAction;
    work?: LivelihoodAction; supply?: LivelihoodAction; rent?: LivelihoodAction; stock?: LivelihoodAction;
    foodBlocked?: 'commerce-meeting-route-required';
    supplyBlocked?: 'commerce-meeting-route-required';
    stockWaiting?: 'stock-satisfied' | 'stock-work-in-progress' | 'stock-input-required';
    /** Trusted world-policy source only, never a model/posted action parameter. */
    hungerThreshold?: number;
}
export interface LivelihoodChoice { action: LivelihoodAction | null; reason: string }
/** Urgent self-care preempts a *new* shift. A submitted action is reconciled before selecting here. */
export function selectLivelihoodAction(s: LivelihoodSnapshot): LivelihoodChoice {
    const hungerThreshold = s.hungerThreshold ?? LIVELIHOOD_THRESHOLDS.hunger;
    if (!Number.isSafeInteger(hungerThreshold) || hungerThreshold < 1) throw new Error('Invalid world hunger threshold');
    const choose = (action: LivelihoodAction | undefined, yes: string, missing: string): LivelihoodChoice =>
        ({ action: action ?? null, reason: action ? yes : missing });
    if (!s.alive) return { action: null, reason: 'lifecycle-terminal' };
    if (!s.clockRunning) return { action: null, reason: 'clock-paused' };
    if (s.role === 'business') return s.stockWaiting ? { action: null, reason: s.stockWaiting }
        : choose(s.stock, 'stock-order', 'stock-input-or-authority-required');
    if (!s.needs) return { action: null, reason: 'needs-source-unavailable' };
    if (s.needs.sleeping) {
        if (s.needs.fatigue <= LIVELIHOOD_THRESHOLDS.wakeFatigue || s.needs.hunger >= hungerThreshold)
            return choose(s.wake, 'wake-for-self-care', 'wake-entitlement-required');
        return { action: null, reason: 'rest-in-progress' };
    }
    if (!s.physicalAllowed) return { action: null, reason: 'physical-execution-blocked' };
    if (s.needs.hunger >= hungerThreshold) return choose(s.food, 'hunger-relief', s.foodBlocked ?? 'food-input-or-authority-required');
    if (s.needs.fatigue >= LIVELIHOOD_THRESHOLDS.fatigue) return choose(s.rest ?? s.rent, 'fatigue-relief', 'paid-bed-or-route-required');
    if (s.work) return { action: s.work, reason: 'due-work' };
    if (s.supplyBlocked) return { action: null, reason: s.supplyBlocked };
    if (s.supply) return { action: s.supply, reason: 'approved-supply' };
    return choose(s.rent, 'rent-maintenance', 'no-due-routine');
}
