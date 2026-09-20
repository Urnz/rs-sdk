import { describe, expect, test } from 'bun:test';
import { measureProductionCapitalValue, type ProductionCapitalOutcomeEvidence } from '../index.js';

function outcome(overrides: Partial<ProductionCapitalOutcomeEvidence> = {}): ProductionCapitalOutcomeEvidence { return {
    evidenceId: 'outcome-1', capitalAssetTypeId: 'workshop.bronze-bellows', itemInstanceId: 'bellows-1',
    workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0', baselineGoodUnits: 10, actualGoodUnits: 12,
    baselineDurationSimulationMinutes: 100, actualDurationSimulationMinutes: 80, observedUnitPriceGp: 100,
    maintenanceCostGp: 20, marketEvidenceId: 'market-sale-1', marketEvidenceDigest: 'a'.repeat(64),
    occurredAtSimulationTime: '2030-01-01T01:00:00.000Z', ...overrides }; }

describe('utility and market-derived capital value telemetry', () => {
    test('measures realized utility, market benefit and cost recovery without setting a gameplay price', () => {
        const report = measureProductionCapitalValue([outcome(), outcome({ evidenceId: 'outcome-2', actualGoodUnits: 11,
            actualDurationSimulationMinutes: 90, maintenanceCostGp: 10, marketEvidenceId: 'market-sale-2',
            occurredAtSimulationTime: '2030-01-02T01:00:00.000Z' })], 1_000, () => true);
        expect(report).toMatchObject({ observationCount: 2, incrementalGoodUnits: 3, avoidedSimulationMinutes: 30,
            grossIncrementalMarketValueGp: 300, maintenanceCostGp: 30, realizedNetBenefitGp: 270,
            observedAcquisitionCostGp: 1_000, recoveredCostBasisPoints: 2_700, telemetryOnly: true });
        expect(report.evidenceDigest).toHaveLength(64);
        expect('gameplayPriceGp' in report).toBeFalse(); expect('suggestedPriceGp' in report).toBeFalse();
    });
    test('retains negative observed performance instead of manufacturing capital value', () => {
        expect(measureProductionCapitalValue([outcome({ actualGoodUnits: 9, actualDurationSimulationMinutes: 110 })],
            1_000, () => true)).toMatchObject({ incrementalGoodUnits: -1, avoidedSimulationMinutes: -10,
            grossIncrementalMarketValueGp: -100, realizedNetBenefitGp: -120, recoveredCostBasisPoints: -1_200 });
    });
    test('rejects unverified, duplicate, foreign and unpriced market outcomes', () => {
        expect(() => measureProductionCapitalValue([outcome()], 1_000, () => false)).toThrow('not trusted');
        expect(() => measureProductionCapitalValue([outcome(), outcome()], 1_000, () => true)).toThrow('not trusted');
        expect(() => measureProductionCapitalValue([outcome(), outcome({ evidenceId: 'outcome-2',
            itemInstanceId: 'bellows-2' })], 1_000, () => true)).toThrow('not trusted');
        expect(() => measureProductionCapitalValue([outcome({ observedUnitPriceGp: 0 })], 1_000, () => true)).toThrow('not trusted');
    });
});
