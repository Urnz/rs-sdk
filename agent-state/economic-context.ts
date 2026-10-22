/** Observer-scoped read model. These observations never authorize transfers or become receipts. */
export const ECONOMIC_OBSERVER_POLICY = {
    version: 'si-b01.v1', maxAgeMs: 30_000, cooldownMs: 15 * 60_000,
    needEnter: 7000, needExit: 5000, runwayEnter: 1, runwayExit: 2
} as const;

export interface EconomicFact {
    key: string; value: number | string | null; source: string; cursor: string;
    observedAt: string | null; freshness: 'fresh' | 'stale' | 'unknown';
    trust: 'native' | 'observed';
}
export interface EconomicObservation {
    agentId: string; binding: string; observedAt: string; simulationTime: string | null;
    facts: EconomicFact[];
}
export interface EconomicObserverState {
    policy: string; binding: string; observedAt: string; sequence: number;
    cursors: Record<string, string>; values: Record<string, number | string>; active: Record<string, boolean>;
    pending: string[]; lastAdmissionAt: string | null;
}

export function freshEconomicFact(fact: EconomicFact, now: string): boolean {
    const age = Date.parse(now) - Date.parse(fact.observedAt ?? '');
    return fact.freshness === 'fresh' && fact.value !== null && Number.isFinite(age)
        && age >= 0 && age <= ECONOMIC_OBSERVER_POLICY.maxAgeMs;
}

/** Unknown does not clear a latch. Recovery requires an actual fresh source observation. */
export function advanceEconomicObserver(observation: EconomicObservation, previous: EconomicObserverState | null):
    { state: EconomicObserverState; reasons: string[] } {
    if (!Number.isFinite(Date.parse(observation.observedAt))) throw new Error('Invalid economic observation time');
    if (previous && (previous.policy !== ECONOMIC_OBSERVER_POLICY.version || previous.binding !== observation.binding))
        throw new Error('Economic observer policy/binding differs');
    if (previous && observation.observedAt < previous.observedAt) throw new Error('Economic observation regressed');
    const state: EconomicObserverState = previous ? structuredClone(previous) : {
        policy: ECONOMIC_OBSERVER_POLICY.version, binding: observation.binding, observedAt: observation.observedAt,
        sequence: 0, cursors: {}, values: {}, active: {}, pending: [], lastAdmissionAt: null
    };
    state.observedAt = observation.observedAt;
    for (const fact of observation.facts) {
        if (!freshEconomicFact(fact, observation.observedAt)) continue;
        const priorCursor = state.cursors[fact.key];
        if (priorCursor === fact.cursor && state.values[fact.key] !== fact.value)
            throw new Error('Economic source cursor reused with different content');
        if (priorCursor && /^\d+(?::\d+)*$/.test(priorCursor) && /^\d+(?::\d+)*$/.test(fact.cursor)) {
            const before = priorCursor.split(':').map(Number), after = fact.cursor.split(':').map(Number);
            if (before.length !== after.length || before.some((value, index) => after[index]! < value))
                throw new Error('Economic source cursor regressed');
        }
        const was = state.active[fact.key] ?? false;
        let active: boolean | undefined;
        if (fact.key.startsWith('income:') || fact.key.startsWith('partner:')) active = fact.value === 'ended' || fact.value === 'unavailable';
        if (fact.key === 'hunger' || fact.key === 'fatigue') active = typeof fact.value === 'number'
            ? fact.value >= (was ? ECONOMIC_OBSERVER_POLICY.needExit : ECONOMIC_OBSERVER_POLICY.needEnter) : undefined;
        if (fact.key === 'cash-runway-periods') active = typeof fact.value === 'number'
            ? fact.value <= (was ? ECONOMIC_OBSERVER_POLICY.runwayExit : ECONOMIC_OBSERVER_POLICY.runwayEnter) : undefined;
        if (fact.key.startsWith('stock:')) active = typeof fact.value === 'number' ? fact.value <= (was ? 1 : 0) : undefined;
        if (fact.key === 'rent-due') active = fact.value === 'due';
        // Offers and work terminals already have durable domain wakeups. They remain
        // context/cursor inputs here, without a second admission for the same change.
        state.cursors[fact.key] = fact.cursor;
        state.values[fact.key] = fact.value!;
        if (active === undefined) continue;
        state.active[fact.key] = active;
        if (active && !was && !state.pending.includes(fact.key)) state.pending.push(fact.key);
        if (!active) state.pending = state.pending.filter(key => key !== fact.key);
    }
    // A stale/gapped pending source cannot wake a model with an asserted economic fact.
    const reasons = state.pending.filter(key => observation.facts.some(fact => fact.key === key
        && freshEconomicFact(fact, observation.observedAt)));
    if (!reasons.length || (state.lastAdmissionAt && Date.parse(observation.observedAt)
        - Date.parse(state.lastAdmissionAt) < ECONOMIC_OBSERVER_POLICY.cooldownMs)) return { state, reasons: [] };
    state.sequence++;
    state.lastAdmissionAt = observation.observedAt;
    state.pending = state.pending.filter(key => !reasons.includes(key));
    return { state, reasons: reasons.sort() };
}

export function buildEconomicContext(observation: EconomicObservation, now: string): string {
    const priority = ['hunger', 'fatigue', 'rent-due', 'rent-next-simulation-time', 'cash-runway-periods',
        'own-liquid-inventory-gp', 'own-treasury-available-gp'];
    const facts = [...observation.facts].sort((a, b) => {
        const rank = (key: string) => priority.includes(key) ? priority.indexOf(key) : priority.length;
        return rank(a.key) - rank(b.key);
    }).slice(0, 24);
    return `Observer economic context (${ECONOMIC_OBSERVER_POLICY.version}; scoped to ${observation.agentId}; `
        + 'estimates/observations are not transfer evidence):\n- '
        + facts.map(fact => `${fact.key}: ${freshEconomicFact(fact, now) ? JSON.stringify(fact.value) : 'unknown'} `
            + `(${freshEconomicFact(fact, now) ? fact.trust : fact.freshness === 'fresh' ? 'stale' : fact.freshness}; `
            + `source ${fact.source}; cursor ${fact.cursor}; observed ${fact.observedAt ?? 'unknown'})`).join('\n- ')
        + (observation.facts.length > facts.length ? '\nEconomic context coverage: partial; additional facts omitted.' : '');
}
