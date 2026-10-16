import type { ItemProvenanceAsset, ItemProvenanceEvent } from '../item-provenance/types.js';
import type { ThievingDiscoveryObservation, ThievingOutcomeReceipt } from '../thieving-procedures/types.js';

export interface CrimeHeatPolicy {
    schemaVersion: 1;
    policyId: string;
    version: string;
    valueScaleCoins: number;
    decayPerSimulationHourBasisPoints: number;
    weights: {
        value: number;
        uniqueness: number;
        victimImportance: number;
        witness: number;
        report: number;
        publicity: number;
        locationExposure: number;
    };
    jurisdictions: Array<{ jurisdictionId: string; localMultiplierBasisPoints: number;
        foreignMultiplierBasisPoints: number }>;
    digest: string;
}

/** A trusted, time-specific appraisal. It is not information available to every observer. */
export interface CrimeHeatAssessment {
    assessmentId: string;
    outcomeReceiptId: string;
    crimeJurisdictionId: string;
    currentJurisdictionId: string;
    locationId: string;
    valueCoins: number;
    uniquenessBasisPoints: number;
    victimImportanceBasisPoints: number;
    publicityBasisPoints: number;
    locationExposureBasisPoints: number;
    sourceEvidenceDigest: string;
    crimeAtSimulationTime: string;
    assessedAtSimulationTime: string;
    assessedAtWallTime: string;
}

export interface CrimeHeatProjectionInput {
    outcome: ThievingOutcomeReceipt;
    theftEvent: ItemProvenanceEvent | null;
    asset: ItemProvenanceAsset | null;
    discoveries: ThievingDiscoveryObservation[];
    assessment: CrimeHeatAssessment;
}

export interface CrimeHeatProjection {
    subject: { kind: 'crime' | 'identified-asset' | 'provenance-lot'; id: string };
    outcomeReceiptId: string;
    jurisdictionId: string;
    locationId: string;
    assessedAtSimulationTime: string;
    traceabilityBasisPoints: number;
    factors: {
        value: number;
        uniqueness: number;
        victimImportance: number;
        witnesses: number;
        reports: number;
        publicity: number;
        locationExposure: number;
        jurisdictionMultiplierBasisPoints: number;
        elapsedSimulationHours: number;
    };
    sourceIds: { theftEventId: string | null; discoveryObservationIds: string[]; assessmentId: string };
    policyDigest: string;
    projectionDigest: string;
}

export type CrimeHeatAssessmentVerifier = (assessment: Readonly<CrimeHeatAssessment>,
    outcome: Readonly<ThievingOutcomeReceipt>) => boolean;
export type CrimeHeatOutcomeVerifier = (outcome: Readonly<ThievingOutcomeReceipt>) => boolean;
export type CrimeHeatDiscoveryVerifier = (discovery: Readonly<ThievingDiscoveryObservation>,
    outcome: Readonly<ThievingOutcomeReceipt>) => boolean;
export type CrimeHeatTheftVerifier = (event: Readonly<ItemProvenanceEvent>,
    outcome: Readonly<ThievingOutcomeReceipt>) => boolean;
export type CrimeHeatAssetVerifier = (asset: Readonly<ItemProvenanceAsset>,
    theft: Readonly<ItemProvenanceEvent>) => boolean;
