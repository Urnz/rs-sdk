import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EconomicContract } from './economic-contracts.js';
import { measureExperimentEconomyProvenance, verifiedAppliedFixture } from './experiment-economy-provenance.js';
import { validateProtoSocietyFixture } from './proto-society-fixture.js';
import { repoRoot } from './paths.js';

const fixture = validateProtoSocietyFixture(JSON.parse(readFileSync(
    join(repoRoot, 'config', 'fixtures', 'varrock-proto-v1.json'), 'utf8')) as unknown);

function contract(): EconomicContract {
    return { contractId: 'contract.fixture', sourceOfferId: 'offer.fixture', kind: 'work',
        partyAAgentId: 'varrock-forge-mind', partyBAgentId: 'vrsmith1', title: 'Fixture work',
        summary: 'Measured fixture business work.', partyAProvides: { gp: 400, items: [], service: null },
        partyBProvides: { gp: 0, items: [{ id: 1205, name: 'Bronze dagger', count: 2 }],
            service: 'Smith daggers.', skill: { id: 'production.varrock.bronze-daggers', version: '1.0.0' } },
        termsDigest: 'a'.repeat(64), status: 'fulfilled', partyASatisfied: true, partyBSatisfied: true,
        evidence: [{ evidenceId: 'evidence.fixture', contractId: 'contract.fixture', party: 'b',
            actorAgentId: 'vrsmith1', runId: 'run.fixture', journalDigest: 'b'.repeat(64), matchedGp: 0,
            matchedItems: [{ id: 1205, name: 'Bronze dagger', count: 2 }], matchedService: true,
            economyEventIds: [], recordedAt: '2026-09-01T10:02:00.000Z' }],
        settlements: [{ settlementId: 'settlement.fixture', contractId: 'contract.fixture', party: 'a',
            payerAgentId: 'varrock-forge-mind', payerKind: 'business', payerActorId: 'varrock-forge',
            payeeAgentId: 'vrsmith1', payeeUsername: 'VRSmith1', payeeKind: null, payeeActorId: null,
            amountGp: 400, reservationId: 'reservation.fixture', status: 'committed', error: '',
            createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:03:00.000Z',
            committedAt: '2026-09-01T10:03:00.000Z', releasedAt: null }], playerEscrows: [],
        acceptedAt: '2026-09-01T10:00:00.000Z', fulfilledAt: '2026-09-01T10:03:00.000Z',
        resolvedAt: '2026-09-01T10:03:00.000Z', resolutionNote: 'Completed.', revision: 4 };
}

describe('experiment economy provenance metrics', () => {
    test('keeps NPC dependence, bootstrap wealth and endogenous interactions separate', () => {
        const metrics = measureExperimentEconomyProvenance({
            participantAgentIds: ['vrcopper1', 'vrsmith1'], participantUsernames: ['VRCopper1', 'VRSmith1'],
            fixture, contracts: [contract()], startedAt: '2026-09-01T10:00:00.000Z',
            finishedAt: '2026-09-01T10:05:00.000Z', events: [
                { id: 'shop', timestamp: '2026-09-01T10:01:00.000Z', runId: 'run.shop', username: 'VRCopper1',
                    skillId: 'mining.varrock-east.copper-to-general-store', stepId: 'sell', kind: 'shop-sell',
                    itemsIn: [], itemsOut: [{ id: 436, name: 'Copper ore', quantity: 3 }], coinsDelta: 9,
                    counterparty: null, partial: false },
                { id: 'trade', timestamp: '2026-09-01T10:02:00.000Z', runId: 'run.trade', username: 'VRSmith1',
                    skillId: 'trade.fixture', stepId: 'trade', kind: 'player-trade', itemsIn: [],
                    itemsOut: [{ id: 1205, name: 'Bronze dagger', quantity: 1 }], coinsDelta: 4,
                    counterparty: 'VRCopper1', partial: false }
            ] });
        expect(metrics).toMatchObject({ fixtureId: 'varrock-proto-v1', bootstrapWealth: {
            participantAgentIds: ['vrcopper1', 'vrsmith1'], participantCoinsGp: 450,
            participantItemUnits: 10, businessTreasuryGp: 10_000 }, externalNpcShop: {
            dependencyIds: ['lumbridge-general-store-purchases', 'varrock-general-store-sales'],
            sellTransactions: 1, receivedGp: 9, itemsSold: 3 },
        agentToAgent: { tradeEvents: 1 }, agentToBusiness: { contracts: 1, fulfilledContracts: 1,
            gpTransferred: 400, evidencedItemUnits: 2, serviceEvidence: 1 } });
    });

    test('does not attribute bootstrap or Business provenance to an unrelated cohort', () => {
        expect(measureExperimentEconomyProvenance({ participantAgentIds: ['other'], participantUsernames: ['Other'],
            fixture, contracts: [contract()], events: [], startedAt: '2026-09-01T10:00:00.000Z',
            finishedAt: '2026-09-01T10:05:00.000Z' })).toMatchObject({ fixtureId: null,
            bootstrapWealth: null, agentToBusiness: { contracts: 0 } });
    });

    test('requires a completed durable application with the exact baseline digest', () => {
        const application = { fixtureId: fixture.fixtureId, baselineDigest: fixture.baselineDigest,
            applyId: 'apply.fixture', status: 'completed' as const, rollbackPlan: {}, error: null,
            startedAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:01:00.000Z',
            completedAt: '2026-09-01T09:01:00.000Z', revision: 2 };
        expect(verifiedAppliedFixture(fixture, application)).toBe(fixture);
        expect(verifiedAppliedFixture(fixture, { ...application, status: 'rollback-required' })).toBeNull();
        expect(verifiedAppliedFixture(fixture, { ...application, baselineDigest: '0'.repeat(64) })).toBeNull();
    });
});
