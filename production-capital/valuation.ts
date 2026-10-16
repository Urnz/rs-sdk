import { createHash } from 'node:crypto';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/, DIGEST = /^[0-9a-f]{64}$/;
export interface ProductionCapitalOutcomeEvidence {
    evidenceId: string; capitalAssetTypeId: string; itemInstanceId: string; workflowId: string; workflowVersion: string;
    baselineGoodUnits: number; actualGoodUnits: number; baselineDurationSimulationMinutes: number;
    actualDurationSimulationMinutes: number; observedUnitPriceGp: number; maintenanceCostGp: number;
    marketEvidenceId: string; marketEvidenceDigest: string; occurredAtSimulationTime: string;
}
export interface ProductionCapitalValueTelemetry {
    capitalAssetTypeId: string; itemInstanceId: string; observationCount: number; incrementalGoodUnits: number;
    avoidedSimulationMinutes: number; grossIncrementalMarketValueGp: number; maintenanceCostGp: number;
    realizedNetBenefitGp: number; observedAcquisitionCostGp: number; recoveredCostBasisPoints: number | null;
    evidenceDigest: string; telemetryOnly: true;
}
export type CapitalOutcomeVerifier = (evidence: ProductionCapitalOutcomeEvidence) => boolean;
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function integer(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0
    || Number(value) > 2_147_483_647) throw new Error(`${field} is invalid`); return Number(value); }
function add(left: number, right: number, field: string): number { const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`${field} exceeds safe bounds`); return result; }
export function measureProductionCapitalValue(evidence: readonly ProductionCapitalOutcomeEvidence[],
    observedAcquisitionCostGp: number, verify?: CapitalOutcomeVerifier): ProductionCapitalValueTelemetry {
    if (evidence.length < 1 || evidence.length > 10_000) throw new Error('Production capital outcomes are invalid');
    const acquisitionCost = integer(observedAcquisitionCostGp, 'Observed acquisition cost'), first = evidence[0]!;
    if (!ID.test(first.capitalAssetTypeId) || !ID.test(first.itemInstanceId)) throw new Error('Production capital identity is invalid');
    const ids = new Set<string>(); let incrementalGoodUnits = 0, avoidedSimulationMinutes = 0;
    let grossIncrementalMarketValueGp = 0, maintenanceCostGp = 0;
    for (const outcome of evidence) {
        const values = [outcome.baselineGoodUnits, outcome.actualGoodUnits, outcome.baselineDurationSimulationMinutes,
            outcome.actualDurationSimulationMinutes, outcome.observedUnitPriceGp, outcome.maintenanceCostGp];
        if (!ID.test(outcome.evidenceId) || !ID.test(outcome.workflowId) || !/^\d+\.\d+\.\d+$/.test(outcome.workflowVersion)
            || outcome.capitalAssetTypeId !== first.capitalAssetTypeId || outcome.itemInstanceId !== first.itemInstanceId
            || !ID.test(outcome.marketEvidenceId) || !DIGEST.test(outcome.marketEvidenceDigest)
            || values.some(value => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
            || outcome.baselineDurationSimulationMinutes < 1 || outcome.actualDurationSimulationMinutes < 1
            || outcome.observedUnitPriceGp < 1 || !Number.isFinite(Date.parse(outcome.occurredAtSimulationTime))
            || ids.has(outcome.evidenceId) || !verify?.(outcome)) throw new Error('Production capital outcome is not trusted');
        ids.add(outcome.evidenceId); const units = outcome.actualGoodUnits - outcome.baselineGoodUnits;
        incrementalGoodUnits = add(incrementalGoodUnits, units, 'Production capital unit total');
        avoidedSimulationMinutes = add(avoidedSimulationMinutes,
            outcome.baselineDurationSimulationMinutes - outcome.actualDurationSimulationMinutes, 'Production capital time total');
        const marketValue = units * outcome.observedUnitPriceGp;
        if (!Number.isSafeInteger(marketValue) || !Number.isSafeInteger(grossIncrementalMarketValueGp + marketValue)) {
            throw new Error('Production capital market value exceeds safe bounds');
        }
        grossIncrementalMarketValueGp = add(grossIncrementalMarketValueGp, marketValue, 'Production capital market value');
        maintenanceCostGp = add(maintenanceCostGp, outcome.maintenanceCostGp, 'Production capital maintenance cost');
    }
    const realizedNetBenefitGp = add(grossIncrementalMarketValueGp, -maintenanceCostGp, 'Production capital net benefit');
    const recoveredCostBasisPoints = acquisitionCost === 0 ? null : Math.trunc(realizedNetBenefitGp / acquisitionCost * 10_000);
    if (recoveredCostBasisPoints !== null && !Number.isSafeInteger(recoveredCostBasisPoints)) {
        throw new Error('Production capital recovery metric exceeds safe bounds');
    }
    const report = { capitalAssetTypeId: first.capitalAssetTypeId, itemInstanceId: first.itemInstanceId,
        observationCount: evidence.length, incrementalGoodUnits, avoidedSimulationMinutes, grossIncrementalMarketValueGp,
        maintenanceCostGp, realizedNetBenefitGp, observedAcquisitionCostGp: acquisitionCost,
        recoveredCostBasisPoints,
        telemetryOnly: true as const };
    return { ...report, evidenceDigest: digest({ evidence, report }) };
}
