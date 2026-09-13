import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EconomyEvent } from './transaction-telemetry.js';
import { EconomicContractStore, type EconomicContract } from './economic-contracts.js';
import { FixtureBootstrapStore, type FixtureApplication } from './fixture-bootstrap-store.js';
import { validateProtoSocietyFixture, type ProtoSocietyFixture } from './proto-society-fixture.js';
import { economicContractsDbPath, fixtureBootstrapDbPath, repoRoot } from './paths.js';

export interface ExperimentInteractionMetric {
    contracts: number;
    fulfilledContracts: number;
    gpTransferred: number;
    evidencedItemUnits: number;
    serviceEvidence: number;
}

export interface ExperimentEconomyProvenanceMetrics {
    fixtureId: string | null;
    fixtureBaselineDigest: string | null;
    bootstrapWealth: {
        provenance: 'fixture-bootstrap';
        participantAgentIds: string[];
        participantCoinsGp: number;
        participantItemUnits: number;
        businessTreasuryGp: number;
    } | null;
    externalNpcShop: {
        dependencyIds: string[];
        buyTransactions: number;
        sellTransactions: number;
        spentGp: number;
        receivedGp: number;
        itemsBought: number;
        itemsSold: number;
    };
    agentToAgent: ExperimentInteractionMetric & { tradeEvents: number };
    agentToBusiness: ExperimentInteractionMetric;
}

export interface ExperimentProvenanceInput {
    participantAgentIds: readonly string[];
    participantUsernames: readonly string[];
    events: readonly EconomyEvent[];
    startedAt: string;
    finishedAt: string;
    fixture?: ProtoSocietyFixture | null;
    contracts?: readonly EconomicContract[];
}

function inWindow(value: string | null, start: number, finish: number): boolean {
    if (!value) return false;
    const time = Date.parse(value);
    return !Number.isNaN(time) && time >= start && time <= finish;
}

function itemUnits(items: readonly { count?: number; quantity?: number }[]): number {
    return items.reduce((sum, item) => sum + (item.count ?? item.quantity ?? 0), 0);
}

function contractTouched(contract: EconomicContract, start: number, finish: number): boolean {
    return inWindow(contract.acceptedAt, start, finish) || inWindow(contract.fulfilledAt, start, finish)
        || inWindow(contract.resolvedAt, start, finish)
        || contract.evidence.some(item => inWindow(item.recordedAt, start, finish))
        || contract.settlements.some(item => inWindow(item.committedAt, start, finish))
        || contract.playerEscrows.some(item => inWindow(item.committedAt, start, finish));
}

function interaction(contracts: readonly EconomicContract[], start: number, finish: number): ExperimentInteractionMetric {
    return {
        contracts: contracts.length,
        fulfilledContracts: contracts.filter(item => inWindow(item.fulfilledAt, start, finish)).length,
        gpTransferred: contracts.reduce((sum, contract) => sum
            + contract.settlements.filter(item => item.status === 'committed' && inWindow(item.committedAt, start, finish))
                .reduce((total, item) => total + item.amountGp, 0)
            + contract.playerEscrows.filter(item => item.status === 'committed' && inWindow(item.committedAt, start, finish))
                .reduce((total, item) => total + item.assets.gp, 0), 0),
        evidencedItemUnits: contracts.reduce((sum, contract) => sum + contract.evidence
            .filter(item => inWindow(item.recordedAt, start, finish))
            .reduce((total, item) => total + itemUnits(item.matchedItems), 0), 0),
        serviceEvidence: contracts.reduce((sum, contract) => sum + contract.evidence
            .filter(item => item.matchedService && inWindow(item.recordedAt, start, finish)).length, 0)
    };
}

export function measureExperimentEconomyProvenance(input: ExperimentProvenanceInput): ExperimentEconomyProvenanceMetrics {
    const start = Date.parse(input.startedAt), finish = Date.parse(input.finishedAt);
    if (Number.isNaN(start) || Number.isNaN(finish) || finish < start) {
        throw new Error('Experiment provenance window is invalid');
    }
    const agentIds = new Set(input.participantAgentIds.map(value => value.toLowerCase()));
    const usernames = new Set(input.participantUsernames.map(value => value.toLowerCase()));
    const fixturePlayers = input.fixture?.players.filter(player => agentIds.has(player.agentId)) ?? [];
    const exactFixtureCohort = input.fixture && fixturePlayers.length === agentIds.size;
    const fixture = exactFixtureCohort ? input.fixture! : null;
    const shopEvents = input.events.filter(event => event.kind === 'shop-buy' || event.kind === 'shop-sell');
    const contracts = (input.contracts ?? []).filter(item => contractTouched(item, start, finish));
    const agentContracts = contracts.filter(item => agentIds.has(item.partyAAgentId) && agentIds.has(item.partyBAgentId));
    const businessAgentId = fixture?.business.institutionAgentId ?? null;
    const businessContracts = businessAgentId ? contracts.filter(item =>
        (item.partyAAgentId === businessAgentId && agentIds.has(item.partyBAgentId))
        || (item.partyBAgentId === businessAgentId && agentIds.has(item.partyAAgentId))) : [];
    const dependencyIds = fixture ? fixture.externalDependencies.map(item => item.dependencyId).sort() : [];
    const bought = shopEvents.filter(event => event.kind === 'shop-buy');
    const sold = shopEvents.filter(event => event.kind === 'shop-sell');
    const agentInteraction = interaction(agentContracts, start, finish);
    return {
        fixtureId: fixture?.fixtureId ?? null,
        fixtureBaselineDigest: fixture?.baselineDigest ?? null,
        bootstrapWealth: fixture ? {
            provenance: 'fixture-bootstrap', participantAgentIds: fixturePlayers.map(item => item.agentId).sort(),
            participantCoinsGp: fixturePlayers.reduce((sum, item) => sum + item.coins, 0),
            participantItemUnits: fixturePlayers.reduce((sum, item) => sum
                + itemUnits(item.inventory) + itemUnits(item.equipment) + itemUnits(item.bank), 0),
            businessTreasuryGp: fixture.business.treasury.balanceGp
        } : null,
        externalNpcShop: { dependencyIds,
            buyTransactions: bought.length, sellTransactions: sold.length,
            spentGp: bought.reduce((sum, item) => sum + Math.max(0, -item.coinsDelta), 0),
            receivedGp: sold.reduce((sum, item) => sum + Math.max(0, item.coinsDelta), 0),
            itemsBought: bought.reduce((sum, item) => sum + itemUnits(item.itemsIn), 0),
            itemsSold: sold.reduce((sum, item) => sum + itemUnits(item.itemsOut), 0) },
        agentToAgent: { ...agentInteraction,
            tradeEvents: input.events.filter(event => event.kind === 'player-trade'
                && !!event.counterparty && usernames.has(event.counterparty.toLowerCase())).length },
        agentToBusiness: interaction(businessContracts, start, finish)
    };
}

export function readDefaultExperimentProvenanceSources(): {
    fixture: ProtoSocietyFixture | null; contracts: EconomicContract[];
} {
    const fixture = readDefaultAppliedFixture();
    if (!existsSync(economicContractsDbPath)) return { fixture, contracts: [] };
    const store = new EconomicContractStore(economicContractsDbPath);
    try { return { fixture, contracts: store.listContracts(500) }; } finally { store.close(); }
}

export function readDefaultAppliedFixture(): ProtoSocietyFixture | null {
    const fixturePath = join(repoRoot, 'config', 'fixtures', 'varrock-proto-v1.json');
    const manifest = existsSync(fixturePath)
        ? validateProtoSocietyFixture(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown) : null;
    let application: FixtureApplication | null = null;
    if (manifest && existsSync(fixtureBootstrapDbPath)) {
        const bootstrap = new FixtureBootstrapStore(fixtureBootstrapDbPath);
        try { application = bootstrap.get(manifest.fixtureId); } finally { bootstrap.close(); }
    }
    return verifiedAppliedFixture(manifest, application);
}

export function verifiedAppliedFixture(fixture: ProtoSocietyFixture | null,
    application: FixtureApplication | null): ProtoSocietyFixture | null {
    return fixture && application?.status === 'completed' && application.baselineDigest === fixture.baselineDigest
        ? fixture : null;
}
