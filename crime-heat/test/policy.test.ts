import { describe, expect, test } from 'bun:test';

import type { ItemProvenanceAsset, ItemProvenanceEvent } from '../../item-provenance/types.js';
import type { ThievingDiscoveryObservation, ThievingOutcomeReceipt } from '../../thieving-procedures/types.js';
import { loadDefaultCrimeHeatPolicy, projectCrimeHeat, validateCrimeHeatPolicy,
    type CrimeHeatAssessment, type CrimeHeatProjectionInput } from '../index.js';

const at = '2030-01-01T00:00:00.000Z', later = '2030-01-01T01:00:00.000Z';
const outcome: ThievingOutcomeReceipt = { receiptId: 'receipt-1', evidenceId: 'engine-1',
    procedureId: 'pickpocket.man', procedureVersion: '1.0.0', procedureKind: 'pickpocket', actorAgentId: 'thief',
    playerUsername: 'thief', target: { kind: 'npc', typeId: 1, instanceIndex: 1, name: 'Man', x: 3200, z: 3200,
        level: 0 }, result: 'succeeded', effect: 'item-transfer',
    transferredItems: [{ itemId: 1265, itemName: 'Bronze pickaxe', quantity: 1 }], thievingXpDelta: 8,
    startedAtEngineTick: 10, endedAtEngineTick: 11, sourceEventId: 'engine-1',
    sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at, receiptDigest: 'b'.repeat(64), recordedAt: at };
const theft: ItemProvenanceEvent = { eventId: 'theft-1', evidenceId: 'theft-proof-1', kind: 'stolen',
    assetId: 'pickaxe-1', itemId: 1265, quantity: 1, titleBefore: { kind: 'agent', id: 'victim' },
    titleAfter: { kind: 'agent', id: 'victim' }, holderBefore: { kind: 'agent', id: 'victim' },
    holderAfter: { kind: 'agent', id: 'thief' }, sourceDomain: 'thieving-procedures', sourceRecordId: 'receipt-1',
    sourceStateVersion: 1, sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at,
    eventDigest: 'c'.repeat(64), recordedAt: at };
const asset: ItemProvenanceAsset = { assetId: 'pickaxe-1', tier: 'identified-asset', stateMode: 'instance',
    itemId: 1265, quantity: 1, titleOwner: { kind: 'agent', id: 'victim' }, holder: { kind: 'agent', id: 'thief' },
    provenanceRootDigest: 'd'.repeat(64), theftHistoryCount: 1, lifecycleStatus: 'active',
    consumedByTransformationId: null, createdAt: at, updatedAt: at, revision: 2 };
const discovery = (id: string, source: ThievingDiscoveryObservation['source'], observerAgentId: string | null):
    ThievingDiscoveryObservation => ({ observationId: id, evidenceId: `evidence-${id}`, outcomeReceiptId: 'receipt-1',
        source, observerAgentId, actorIdentification: 'none', suspectAgentId: null, facts: ['Observed loss'],
        sourceEvidenceDigest: 'e'.repeat(64), occurredAt: later, observationDigest: 'f'.repeat(64), recordedAt: later });
const assessment: CrimeHeatAssessment = { assessmentId: 'assessment-1', outcomeReceiptId: 'receipt-1',
    crimeJurisdictionId: 'varrock', currentJurisdictionId: 'varrock', locationId: 'varrock.market', valueCoins: 5000,
    uniquenessBasisPoints: 8000, victimImportanceBasisPoints: 3000, publicityBasisPoints: 1000,
    locationExposureBasisPoints: 5000, sourceEvidenceDigest: '1'.repeat(64),
    crimeAtSimulationTime: at, assessedAtSimulationTime: later, assessedAtWallTime: later };
const input = (): CrimeHeatProjectionInput => ({ outcome, theftEvent: theft, asset, discoveries: [], assessment });
const trusted = () => true;

describe('scoped crime traceability projection', () => {
    test('binds risk to one asset and responds to witnesses, reports, location, jurisdiction and elapsed time', () => {
        const policy = loadDefaultCrimeHeatPolicy(), original = projectCrimeHeat(policy, input(), trusted, trusted,
            trusted, trusted, trusted);
        expect(original.subject).toEqual({ kind: 'identified-asset', id: 'pickaxe-1' });
        expect(JSON.stringify(original)).not.toContain('thief');
        const observed = projectCrimeHeat(policy, { ...input(), discoveries: [discovery('witness-1', 'direct-witness', 'guard'),
            discovery('witness-2', 'guard-line-of-sight', 'guard'), discovery('report-1', 'owner-loss-report', 'victim')] },
        trusted, trusted, trusted, trusted, trusted);
        expect(observed.factors.witnesses).toBe(5000);
        expect(observed.factors.reports).toBe(10_000);
        expect(observed.traceabilityBasisPoints).toBeGreaterThan(original.traceabilityBasisPoints);
        const foreign = projectCrimeHeat(policy, { ...input(), assessment: { ...assessment,
            currentJurisdictionId: 'falador', locationId: 'falador.market', locationExposureBasisPoints: 1000 } },
        trusted, trusted, trusted, trusted, trusted);
        expect(foreign.traceabilityBasisPoints).toBeLessThan(original.traceabilityBasisPoints);
        const aged = projectCrimeHeat(policy, { ...input(), assessment: { ...assessment,
            assessedAtSimulationTime: '2030-01-03T01:00:00.000Z' } }, trusted, trusted, trusted, trusted, trusted);
        expect(aged.traceabilityBasisPoints).toBeLessThan(original.traceabilityBasisPoints);
    });
    test('keeps a property crime scoped to its receipt without inventing an item', () => {
        const burglary = { ...outcome, procedureKind: 'property-burglary' as const, effect: 'entry-completed' as const,
            transferredItems: [] };
        const result = projectCrimeHeat(loadDefaultCrimeHeatPolicy(), { outcome: burglary, theftEvent: null, asset: null,
            discoveries: [], assessment }, trusted, trusted);
        expect(result.subject).toEqual({ kind: 'crime', id: 'receipt-1' });
    });
    test('rejects untrusted context, mismatched theft and foreign discovery', () => {
        const policy = loadDefaultCrimeHeatPolicy();
        expect(() => projectCrimeHeat(policy, input(), trusted, () => false)).toThrow('not trusted');
        expect(() => projectCrimeHeat(policy, { ...input(), theftEvent: { ...theft, sourceRecordId: 'other-receipt' } },
            trusted, trusted, trusted, trusted, trusted)).toThrow('does not match');
        expect(() => projectCrimeHeat(policy, { ...input(), discoveries: [{ ...discovery('witness-1', 'direct-witness', 'guard'),
            outcomeReceiptId: 'other-receipt' }] }, trusted, trusted, trusted, trusted, trusted)).toThrow('not trusted');
    });
    test('fails closed on modified or incomplete policy', () => {
        const policy = loadDefaultCrimeHeatPolicy();
        expect(() => projectCrimeHeat({ ...policy, weights: { ...policy.weights, witness: 9999 } }, input(),
            trusted, trusted)).toThrow('digest mismatch');
        expect(() => validateCrimeHeatPolicy({ schemaVersion: 1, policyId: 'bad', version: '1.0.0',
            valueScaleCoins: 100, decayPerSimulationHourBasisPoints: 100, weights: policy.weights,
            jurisdictions: [] })).toThrow('jurisdictions');
    });
});
