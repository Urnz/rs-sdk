import { expect, test } from 'bun:test';
import { evaluateSocietyObservations, societyEvaluationContract, type EvaluationScope, type SocietyObservations } from '../evaluation.js';
import { societyMinimumDigest } from '../../society-minimum/policy.js';

const scope: EvaluationScope = { fromSimulationTime: '2030-01-01T00:00:00.000Z', toSimulationTime: '2030-01-01T01:00:00.000Z',
    clockId: 'world', clockProfileDigest: 'a'.repeat(64), actorAgentIds: ['ada', 'bea', 'cora'] };
const evaluate = (facts: SocietyObservations = {}, query = scope) => evaluateSocietyObservations(query, facts);
const metric = (report: ReturnType<typeof evaluate>, id: string, index = 0) => report.objectives.find(row => row.id === id)!.metrics[index]!;

test('rational native unit prices retain exact fractions without integer-GP rounding', () => {
    expect(metric(evaluate({ prices: [{ itemId: 377, openingPriceGp: { gp: 5, units: 2 }, closingPriceGp: { gp: 15, units: 4 }, fixedWeight: 1 }] }),
        'price-stability')).toMatchObject({ numerator: '1', denominator: '2', basisPoints: '5000' });
    expect(() => evaluate({ prices: [{ itemId: 377, openingPriceGp: { gp: 5, units: 0 }, closingPriceGp: 3, fixedWeight: 1 }] })).toThrow('quantity');
});

test('all ten independent objectives survive missing evidence; no synthetic total or success verdict', () => {
    const report = evaluate(); expect(report.objectives).toHaveLength(10);
    expect(report.objectives.every(row => row.status === 'inconclusive')).toBeTrue();
    expect(report.objectives.every(row => row.metrics.every(value => value.numerator === null && value.basisPoints === null))).toBeTrue();
    expect(report.totalScore).toBeNull(); expect(report.societyMinimumVerdict).toBe('inconclusive');
    expect(report.evidenceAuthority).toBe('supplied-observations-not-native-attestation');
    const { digest, ...definition } = report; expect(societyMinimumDigest(definition)).toBe(digest);
    expect(societyEvaluationContract().objectives).toHaveLength(10);
});

test('survival and each internal final-use domain retain exact terms without averaging away deficits', () => {
    const report = evaluate({ survival: { openingMembers: 3, survivingOpeningMembers: 2 },
        selfSufficiency: { food: { internalFinalUse: 9, demand: 10 }, tools: { internalFinalUse: 0, demand: 2 },
            housing: { internalFinalUse: 4, demand: 4 }, inputs: { internalFinalUse: 0, demand: 0 } } });
    expect(metric(report, 'survival')).toMatchObject({ numerator: '2', denominator: '3', basisPoints: '6666', direction: 'maximize' });
    const metrics = report.objectives.find(row => row.id === 'self-sufficiency')!.metrics;
    expect(metrics.map(row => row.basisPoints)).toEqual(['9000', '0', '10000', null]);
    expect(metrics[3]!.status).toBe('inconclusive');
});

test('stage HHI distinguishes concentrated and diversified responsibility without mixing item quantities', () => {
    const facts: SocietyObservations = { specialization: [
        { actorAgentId: 'bea', stages: [{ stageId: 'cook', count: 1 }, { stageId: 'fish', count: 1 }] },
        { actorAgentId: 'ada', stages: [{ stageId: 'smith', count: 3 }] }] };
    const before = JSON.stringify(facts), report = evaluate(facts);
    expect(metric(report, 'specialization')).toMatchObject({ id: 'stage-hhi:ada', basisPoints: '10000', direction: 'describe' });
    expect(metric(report, 'specialization', 1).basisPoints).toBe('5000');
    expect(JSON.stringify(facts)).toBe(before); // calculation must not sort caller-owned arrays
});

test('mobility uses a fixed matched cohort, average ranks for ties and descriptive direction', () => {
    const facts = [
        { actorAgentId: 'ada', openingWealthGp: 0, closingWealthGp: 20 },
        { actorAgentId: 'bea', openingWealthGp: 10, closingWealthGp: 10 },
        { actorAgentId: 'cora', openingWealthGp: 20, closingWealthGp: 0 }];
    expect(metric(evaluate({ mobility: facts }), 'mobility')).toMatchObject({ basisPoints: '6666', direction: 'describe' });
    const tied = facts.map(row => ({ ...row, openingWealthGp: 5, closingWealthGp: 5 }));
    expect(metric(evaluate({ mobility: tied }), 'mobility').basisPoints).toBe('0');
    expect(() => evaluate({ mobility: facts.slice(1) })).toThrow('omits');
});

test('Gini retains wealth alongside inequality and does not call universal zero wealth equitable success', () => {
    const wealth = scope.actorAgentIds.map((actorAgentId, i) => ({ actorAgentId, wealthGp: i === 2 ? 30 : 0 }));
    const report = evaluate({ wealth });
    expect(metric(report, 'wealth-distribution')).toMatchObject({ basisPoints: '6666', unit: 'gini', direction: 'minimize' });
    expect(metric(report, 'wealth-distribution', 1)).toMatchObject({ numerator: '30', unit: 'gp', direction: 'describe', basisPoints: null });
    const zeros = evaluate({ wealth: wealth.map(row => ({ ...row, wealthGp: 0 })) });
    expect(metric(zeros, 'wealth-distribution').status).toBe('inconclusive');
    expect(() => evaluate({ wealth: wealth.map(row => ({ ...row, wealthGp: -1 })) })).toThrow();
});

test('price stability preserves fixed weights and relative per-item changes, not pooled nominal prices', () => {
    const report = evaluate({ prices: [{ itemId: 1, openingPriceGp: 10, closingPriceGp: 15, fixedWeight: 1 },
        { itemId: 2, openingPriceGp: 20, closingPriceGp: 15, fixedWeight: 3 }] });
    expect(metric(report, 'price-stability')).toMatchObject({ numerator: '5', denominator: '16', basisPoints: '3125' });
    expect(() => evaluate({ prices: [{ itemId: 1, openingPriceGp: 0, closingPriceGp: 1, fixedWeight: 1 }] })).toThrow('positive');
    expect(metric(evaluate({ prices: [] }), 'price-stability').status).toBe('inconclusive');
});

test('unemployment is exposure based, crime is per person-hour and investment keeps different units separate', () => {
    const report = evaluate({ unemployment: { unemployedPersonMilliseconds: 100, availableAndWillingPersonMilliseconds: 1000 },
        crime: { confirmedVictimizationIncidents: 2, coveredAtRiskPersonMilliseconds: 7200000 },
        innovation: { commissionedNewRecipeIds: ['forge', 'cook'], realizedProductiveCapitalExpenditureGp: 42 } });
    expect(metric(report, 'unemployment')).toMatchObject({ basisPoints: '1000', direction: 'minimize' });
    expect(metric(report, 'crime')).toMatchObject({ numerator: '7200000', denominator: '7200000', unit: 'confirmed-incidents-per-person-hour', basisPoints: null });
    expect(metric(report, 'innovation-investment')).toMatchObject({ numerator: '2', unit: 'count', direction: 'describe' });
    expect(metric(report, 'innovation-investment', 1)).toMatchObject({ numerator: '42', unit: 'gp' });
});

test('single target withdrawal uses the maximum rather than summing overlapping losses', () => {
    const report = evaluate({ systemicRisk: { recordedProductionEvents: 10,
        withdrawals: [{ targetId: 'agent:ada', lostProductionEvents: 4 }, { targetId: 'business:forge', lostProductionEvents: 3 }] } });
    expect(metric(report, 'systemic-risk')).toMatchObject({ numerator: '4', denominator: '10', basisPoints: '4000', direction: 'minimize' });
    expect(() => evaluate({ systemicRisk: { recordedProductionEvents: 2, withdrawals: [{ targetId: 'aa', lostProductionEvents: 3 }] } })).toThrow('exceeds');
});

test('unsafe numbers, duplicate identities, outside actors and malformed scopes fail instead of yielding flattering metrics', () => {
    expect(() => evaluate({ survival: { openingMembers: 2, survivingOpeningMembers: 3 } })).toThrow();
    expect(() => evaluate({ survival: { openingMembers: 4, survivingOpeningMembers: 3 } })).toThrow();
    expect(() => evaluate({ innovation: { commissionedNewRecipeIds: ['aa', 'aa'], realizedProductiveCapitalExpenditureGp: 0 } })).toThrow('Duplicate');
    expect(() => evaluate({ specialization: [{ actorAgentId: 'outsider', stages: [] }] })).toThrow('outside');
    expect(() => evaluate({ unemployment: { unemployedPersonMilliseconds: NaN, availableAndWillingPersonMilliseconds: 1 } })).toThrow();
    expect(() => evaluate({ crime: { confirmedVictimizationIncidents: Number.MAX_SAFE_INTEGER + 1, coveredAtRiskPersonMilliseconds: 1 } })).toThrow();
    expect(() => evaluate({}, { ...scope, toSimulationTime: scope.fromSimulationTime })).toThrow();
    expect(() => evaluate({}, { ...scope, actorAgentIds: ['ada', 'ada'] })).toThrow('Duplicate');
    expect(() => evaluate({}, { ...scope, clockProfileDigest: 'bad' })).toThrow();
    expect(() => evaluate({ invented: 1 } as SocietyObservations)).toThrow('Unknown');
});

test('integer arithmetic retains exact high-magnitude terms across HHI and Gini', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const report = evaluate({ specialization: [{ actorAgentId: 'ada', stages: [{ stageId: 'aa', count: maximum }, { stageId: 'bb', count: maximum }] }],
        wealth: scope.actorAgentIds.map(actorAgentId => ({ actorAgentId, wealthGp: maximum })) });
    expect(metric(report, 'specialization').basisPoints).toBe('5000');
    expect(metric(report, 'wealth-distribution').basisPoints).toBe('0');
    expect(metric(report, 'wealth-distribution', 1).numerator).toBe(String(3n * BigInt(maximum)));
});
