import { societyMinimumDigest } from '../society-minimum/policy.js';
import { integer, timestamp } from './policy.js';

export const SOCIETY_OBJECTIVES = [
    { id: 'survival', direction: 'maximize', unit: 'share', formula: 'surviving opening members / opening members' },
    { id: 'self-sufficiency', direction: 'maximize', unit: 'share-per-domain', formula: 'verified internal final use / total demand, separately for food, tools, housing and inputs' },
    { id: 'specialization', direction: 'describe', unit: 'hhi-per-actor', formula: 'sum of squared recorded stage counts / squared total stage count, per actor' },
    { id: 'mobility', direction: 'describe', unit: 'normalized-rank-movement', formula: 'sum of absolute opening/closing average wealth rank differences / (n * (n - 1)); ties have average ranks' },
    { id: 'wealth-distribution', direction: 'minimize', unit: 'gini', formula: 'sum((2*i-n-1)*sorted wealth[i]) / (n * sum(wealth)), i starts at 1; nonnegative GP only' },
    { id: 'price-stability', direction: 'minimize', unit: 'basket-relative-change', formula: 'sum(fixed weight * abs(closing-opening)/opening) / sum(fixed weight), per-item prices in GP' },
    { id: 'unemployment', direction: 'minimize', unit: 'share', formula: 'unemployed available-and-willing person-time / available-and-willing person-time' },
    { id: 'innovation-investment', direction: 'describe', unit: 'recipes-and-gp', formula: 'distinct commissioned new recipes and realized productive capital expenditure in GP, separately' },
    { id: 'crime', direction: 'minimize', unit: 'confirmed-incidents-per-person-hour', formula: 'confirmed victimization incidents * 3600000 / covered at-risk person-milliseconds' },
    { id: 'systemic-risk', direction: 'minimize', unit: 'withdrawal-loss-share', formula: 'maximum lost recorded production event count under one actor/Business withdrawal / recorded production event count' }
] as const;
export type SocietyObjectiveId = typeof SOCIETY_OBJECTIVES[number]['id'];
export interface EvaluationScope {
    fromSimulationTime: string; toSimulationTime: string; clockId: string; clockProfileDigest: string; actorAgentIds: string[];
}
export interface WealthPair { actorAgentId: string; openingWealthGp: number; closingWealthGp: number }
export type UnitPriceGp = number | { gp: number; units: number };
export interface SocietyObservations {
    survival?: { openingMembers: number; survivingOpeningMembers: number };
    selfSufficiency?: Record<'food' | 'tools' | 'housing' | 'inputs', { internalFinalUse: number; demand: number }>;
    specialization?: Array<{ actorAgentId: string; stages: Array<{ stageId: string; count: number }> }>;
    mobility?: WealthPair[];
    wealth?: Array<{ actorAgentId: string; wealthGp: number }>;
    prices?: Array<{ itemId: number; openingPriceGp: UnitPriceGp; closingPriceGp: UnitPriceGp; fixedWeight: number }>;
    unemployment?: { unemployedPersonMilliseconds: number; availableAndWillingPersonMilliseconds: number };
    innovation?: { commissionedNewRecipeIds: string[]; realizedProductiveCapitalExpenditureGp: number };
    crime?: { confirmedVictimizationIncidents: number; coveredAtRiskPersonMilliseconds: number };
    systemicRisk?: { recordedProductionEvents: number; withdrawals: Array<{ targetId: string; lostProductionEvents: number }> };
}
export interface Indicator {
    id: string; status: 'observed' | 'inconclusive'; numerator: string | null; denominator: string | null;
    unit: string; direction: 'maximize' | 'minimize' | 'describe'; basisPoints: string | null; reason: string | null;
}
const KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function identifier(value: unknown): asserts value is string { check(typeof value === 'string' && KEY.test(value), 'Invalid observation identifier'); }
function list<T>(values: T[], key: (item: T) => string | number, maximum = 1000): T[] {
    check(Array.isArray(values) && values.length <= maximum, 'Observation list exceeds limits');
    const ids = values.map(key); check(new Set(ids).size === ids.length, 'Duplicate observation identity'); return [...values];
}
function count(value: unknown): bigint { return BigInt(integer(value)); }
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
function fraction(id: string, numerator: bigint, denominator: bigint, unit = 'share', direction: Indicator['direction'] = 'describe'): Indicator {
    check(numerator >= 0n && denominator >= 0n, 'Negative metric term');
    if (denominator === 0n) return { id, unit, direction, status: 'inconclusive', numerator: String(numerator), denominator: '0', basisPoints: null, reason: 'No measured denominator; zero demand/population is not success.' };
    return { id, unit, direction, status: 'observed', numerator: String(numerator), denominator: String(denominator),
        basisPoints: ['count', 'gp', 'confirmed-incidents-per-person-hour'].includes(unit) ? null : String(numerator * 10000n / denominator), reason: null };
}
function share(id: string, numerator: unknown, denominator: unknown, direction: Indicator['direction'] = 'maximize'): Indicator {
    const n = count(numerator), d = count(denominator); check(n <= d, 'Share numerator exceeds denominator'); return fraction(id, n, d, 'share', direction);
}
function unavailable(id: string): Indicator { return { id, unit: 'unavailable', direction: 'describe', status: 'inconclusive', numerator: null, denominator: null, basisPoints: null, reason: 'Required scoped observations unavailable.' }; }
export function validateEvaluationScope(query: EvaluationScope): EvaluationScope {
    check(query && timestamp(query.fromSimulationTime) < timestamp(query.toSimulationTime), 'Invalid evaluation window');
    check(Number.isSafeInteger(timestamp(query.toSimulationTime) - timestamp(query.fromSimulationTime)), 'Evaluation window exceeds safe range');
    identifier(query.clockId); check(typeof query.clockProfileDigest === 'string' && /^[0-9a-f]{64}$/.test(query.clockProfileDigest), 'Invalid clock profile digest');
    const actors = list(query.actorAgentIds, actor => { identifier(actor); return actor; });
    check(actors.length > 0, 'Evaluation requires an explicit actor selection');
    return { fromSimulationTime: query.fromSimulationTime, toSimulationTime: query.toSimulationTime,
        clockId: query.clockId, clockProfileDigest: query.clockProfileDigest, actorAgentIds: [...actors].sort() };
}
export function societyEvaluationContract() {
    const definition = { schemaVersion: 1, artifactKind: 'society-multi-objective-contract', objectives: SOCIETY_OBJECTIVES.map(objective => ({ ...objective })),
        aggregation: 'vector-without-weighted-total', missingEvidence: 'inconclusive-not-zero',
        tradeoffs: 'retain-all-dimensions; descriptive-dimensions-have-no-universal-optimum',
        priceBasket: 'caller-fixed-items-and-weights; no-substitution-or-cross-item-price-pooling',
        evidence: 'formulas-do-not-certify-input-authority-completeness-or-society-minimum',
        bounds: { events: '(start,end]', exposures: '[start,end)', maximumActors: 1000, maximumPriceItems: 128 } };
    return { ...definition, digest: societyMinimumDigest(definition) };
}

/** Pure calculation over explicitly supplied observations. This is never native attestation. */
export function evaluateSocietyObservations(query: EvaluationScope, observations: SocietyObservations) {
    const scope = validateEvaluationScope(query), actors = new Set(scope.actorAgentIds), contract = societyEvaluationContract();
    check(observations && typeof observations === 'object' && !Array.isArray(observations), 'Invalid society observations');
    check(Object.keys(observations).every(key => ['survival', 'selfSufficiency', 'specialization', 'mobility', 'wealth', 'prices', 'unemployment', 'innovation', 'crime', 'systemicRisk'].includes(key)), 'Unknown observation channel');
    const scoped = (id: string) => { identifier(id); check(actors.has(id), 'Observation actor outside evaluation selection'); return id; };
    const completeActors = <T>(rows: T[], key: (row: T) => string) => {
        list(rows, row => scoped(key(row))); check(rows.length === actors.size, 'Boundary observation omits selected actors'); return rows;
    };
    const values = new Map<SocietyObjectiveId, Indicator[]>();
    if (observations.survival) {
        check(observations.survival.openingMembers <= actors.size, 'Opening cohort exceeds selected population');
        values.set('survival', [share('opening-cohort-survival', observations.survival.survivingOpeningMembers, observations.survival.openingMembers)]);
    }
    if (observations.selfSufficiency) {
        check(Object.keys(observations.selfSufficiency).sort().join(',') === 'food,housing,inputs,tools', 'Self-sufficiency requires all four domains');
        values.set('self-sufficiency', (['food', 'tools', 'housing', 'inputs'] as const).map(domain => {
            const row = observations.selfSufficiency![domain]; return share(`${domain}-internal-final-use`, row.internalFinalUse, row.demand);
        }));
    }
    if (observations.specialization) {
        const rows = list(observations.specialization, row => scoped(row.actorAgentId));
        values.set('specialization', rows.sort((a, b) => a.actorAgentId.localeCompare(b.actorAgentId)).map(row => {
            const counts = list(row.stages, stage => { identifier(stage.stageId); return stage.stageId; }, 128).map(stage => count(stage.count));
            const total = counts.reduce((a, b) => a + b, 0n);
            return fraction(`stage-hhi:${row.actorAgentId}`, counts.reduce((a, b) => a + b * b, 0n), total * total, 'hhi');
        }));
    }
    if (observations.mobility) {
        const rows = completeActors(observations.mobility, row => row.actorAgentId);
        rows.forEach(row => { count(row.openingWealthGp); count(row.closingWealthGp); });
        const rank2 = (value: number, field: 'openingWealthGp' | 'closingWealthGp') => BigInt(2 * rows.filter(row => row[field] < value).length + rows.filter(row => row[field] === value).length + 1);
        const movement = rows.reduce((total, row) => {
            const change = rank2(row.closingWealthGp, 'closingWealthGp') - rank2(row.openingWealthGp, 'openingWealthGp'); return total + (change < 0n ? -change : change);
        }, 0n);
        values.set('mobility', [fraction('absolute-average-rank-movement', movement, 2n * BigInt(rows.length) * BigInt(Math.max(0, rows.length - 1)), 'normalized-rank-movement')]);
    }
    if (observations.wealth) {
        const rows = completeActors(observations.wealth, row => row.actorAgentId).map(row => count(row.wealthGp)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const total = rows.reduce((a, b) => a + b, 0n), n = BigInt(rows.length);
        values.set('wealth-distribution', [fraction('nonnegative-gp-gini', rows.reduce((sum, value, i) => sum + (2n * BigInt(i + 1) - n - 1n) * value, 0n), n * total, 'gini', 'minimize'), fraction('recorded-total-wealth-gp', total, 1n, 'gp')]);
    }
    if (observations.prices) {
        const rows = list(observations.prices, row => { integer(row.itemId); check(row.itemId <= 65535, 'Invalid basket item'); return row.itemId; }, 128);
        let numerator = 0n, denominator = 1n, weights = 0n;
        for (const row of rows) {
            const price = (value: UnitPriceGp) => typeof value === 'number' ? { gp: count(value), units: 1n }
                : { gp: count(value.gp), units: count(value.units) };
            const start = price(row.openingPriceGp), end = price(row.closingPriceGp), weight = count(row.fixedWeight);
            check(start.units > 0n && end.units > 0n, 'Unit price quantity must be positive');
            const opening = start.gp * end.units, closing = end.gp * start.units;
            check(opening > 0n && closing > 0n && weight > 0n, 'Prices and fixed weights must be positive');
            const difference = closing >= opening ? closing - opening : opening - closing;
            numerator = numerator * opening + weight * difference * denominator; denominator *= opening;
            const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor; weights += weight;
        }
        values.set('price-stability', [fraction('fixed-basket-absolute-relative-change', numerator, denominator * weights, 'basket-relative-change', 'minimize')]);
    }
    if (observations.unemployment) values.set('unemployment', [share('available-willing-unemployed-person-time', observations.unemployment.unemployedPersonMilliseconds, observations.unemployment.availableAndWillingPersonMilliseconds, 'minimize')]);
    if (observations.innovation) {
        const rows = list(observations.innovation.commissionedNewRecipeIds, id => { identifier(id); return id; });
        values.set('innovation-investment', [fraction('commissioned-new-recipes', BigInt(rows.length), 1n, 'count'), fraction('realized-productive-capex-gp', count(observations.innovation.realizedProductiveCapitalExpenditureGp), 1n, 'gp')]);
    }
    if (observations.crime) values.set('crime', [fraction('confirmed-victimizations-per-person-hour', count(observations.crime.confirmedVictimizationIncidents) * 3600000n, count(observations.crime.coveredAtRiskPersonMilliseconds), 'confirmed-incidents-per-person-hour', 'minimize')]);
    if (observations.systemicRisk) {
        const total = count(observations.systemicRisk.recordedProductionEvents);
        const losses = list(observations.systemicRisk.withdrawals, row => { identifier(row.targetId); return row.targetId; }, 2048).map(row => count(row.lostProductionEvents));
        check(losses.every(loss => loss <= total), 'Withdrawal loss exceeds observed production');
        values.set('systemic-risk', losses.length ? [fraction('maximum-single-target-production-loss', losses.reduce((a, b) => a > b ? a : b, 0n), total, 'withdrawal-loss-share', 'minimize')] : [unavailable('maximum-single-target-production-loss')]);
    }
    const objectives = SOCIETY_OBJECTIVES.map(objective => {
        const metrics = values.get(objective.id);
        return { ...objective, status: metrics?.some(metric => metric.status === 'observed') ? 'observed' as const : 'inconclusive' as const,
            metrics: metrics?.length ? metrics : [unavailable(objective.id)] };
    });
    const definition = { schemaVersion: 1, artifactKind: 'society-multi-objective-evaluation', scope, contractDigest: contract.digest,
        evidenceAuthority: 'supplied-observations-not-native-attestation', observationsDigest: societyMinimumDigest(observations),
        objectives, totalScore: null, societyMinimumVerdict: 'inconclusive',
        limitations: ['A measured value is not a population-wide or complete-history claim.',
            'No weighted total, universal optimum, causal treatment effect or society-minimum verdict is inferred.',
            'GP wealth excludes unvalued assets and debt; rank mobility is descriptive, not proof of opportunity.',
            'Observed confirmed crime is not true incidence without complete detection/coverage.',
            'Source scope, authority and coverage must be established by the caller; a digest only binds content.'] };
    return { ...definition, digest: societyMinimumDigest(definition) };
}
