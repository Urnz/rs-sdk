import { createHash } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { AdminSkillRun } from './skill-history.js';
import { EconomicContractStore, type CreateEconomicContractSettlement,
    type EconomicContract, type EconomicObligation } from './economic-contracts.js';
import { InstitutionTreasuryStore, type InstitutionKind } from './institution-treasury.js';
import { requestEnginePlayerReward, type EnginePlayerRewardResult } from './player-rewards.js';
import { agentStateDbPath, economicContractsDbPath, institutionTreasuryDbPath } from './paths.js';

export interface EconomicContractSettlementOptions {
    contractsPath?: string;
    agentPath?: string;
    treasuryPath?: string;
    now?: string;
    rewarder?: typeof requestEnginePlayerReward;
}

export interface EconomicContractEvidenceOutcome {
    contract: EconomicContract;
    settlementError: string | null;
}

function stableUuid(key: string): string {
    const bytes = Buffer.from(createHash('sha256').update(key).digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function physicalInstitutionObligation(value: EconomicObligation): boolean {
    return value.items.length > 0 || value.service !== null;
}

function settlementForParty(party: 'a' | 'b', offerId: string,
    payerAgentId: string, payeeAgentId: string, obligation: EconomicObligation,
    agents: AgentStateStore): CreateEconomicContractSettlement | null {
    const payer = agents.getControlProfile(payerAgentId);
    const payee = agents.getControlProfile(payeeAgentId);
    if (!payer || !payee) throw new Error('Contract settlement requires two persistent agent profiles');
    if (payer.role !== 'institution') return null;
    if (physicalInstitutionObligation(obligation)) {
        throw new Error('An avatarless institution may provide only treasury GP in an executable contract');
    }
    if (obligation.gp === 0) return null;
    if ((payer.subjectKind !== 'business' && payer.subjectKind !== 'faction')
        || payee.role !== 'player' || payee.subjectKind !== 'player' || !payee.avatarPlayerUsername) {
        throw new Error('Institution treasury GP may be settled only to an exact avatar-bound player agent');
    }
    const payeeUsername = payee.avatarPlayerUsername.trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(payeeUsername)) {
        throw new Error('Contract settlement player avatar is not payable by the engine reward channel');
    }
    const contractId = stableUuid(`economic-contract:${offerId}`);
    return { party, payerAgentId, payerKind: payer.subjectKind as InstitutionKind,
        payerActorId: payer.subjectId, payeeAgentId, payeeUsername,
        amountGp: obligation.gp, reservationId: `contract.${contractId}.${party}`,
        settlementId: stableUuid(`economic-contract-settlement:${contractId}:${party}`) };
}

export async function acceptFundedEconomicOffer(offerId: string, actorAgentId: string,
    expectedRevision: number, options: EconomicContractSettlementOptions = {}) {
    const contracts = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
    const agents = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    const treasury = new InstitutionTreasuryStore(options.treasuryPath ?? institutionTreasuryDbPath);
    const newlyReserved: string[] = [];
    try {
        const offer = contracts.getOffer(offerId);
        if (!offer) throw new Error('Economic offer does not exist');
        if (offer.counterpartyAgentId !== actorAgentId.trim().toLowerCase()) {
            throw new Error('Only the named counterparty may accept this funded offer');
        }
        if (offer.status === 'accepted' && offer.contractId) {
            return { offer, contract: contracts.getContract(offer.contractId)! };
        }
        if (offer.status !== 'open' || Date.parse(offer.expiresAt) <= Date.parse(options.now ?? new Date().toISOString())) {
            throw new Error('Funded economic offer is no longer open');
        }
        if (offer.revision !== expectedRevision) throw new Error('Offer changed before funded acceptance');
        const settlements = [
            settlementForParty('a', offer.offerId, offer.creatorAgentId, offer.counterpartyAgentId,
                offer.creatorProvides, agents),
            settlementForParty('b', offer.offerId, offer.counterpartyAgentId, offer.creatorAgentId,
                offer.counterpartyProvides, agents)
        ].filter((item): item is CreateEconomicContractSettlement => item !== null);
        for (const payment of settlements) {
            const held = treasury.reserve(payment.payerKind, payment.payerActorId,
                payment.reservationId, payment.amountGp, options.now);
            if (held.created) newlyReserved.push(payment.reservationId);
            treasury.bindSettlement(payment.reservationId, payment.settlementId, options.now);
        }
        return contracts.accept(offerId, actorAgentId, expectedRevision, options.now,
            stableUuid(`economic-contract:${offer.offerId}`), settlements);
    } catch (error) {
        for (const reservationId of newlyReserved) treasury.release(reservationId, options.now);
        throw error;
    } finally {
        treasury.close();
        agents.close();
        contracts.close();
    }
}

function validateReceipt(receipt: EnginePlayerRewardResult, payment: CreateEconomicContractSettlement): void {
    if (!receipt.ok || receipt.settlementId !== payment.settlementId
        || receipt.username.trim().toLowerCase() !== payment.payeeUsername.trim().toLowerCase()
        || receipt.amount !== payment.amountGp) {
        throw new Error('Engine returned a mismatched contract settlement receipt');
    }
}

export async function settleReadyEconomicContract(contractId: string,
    options: EconomicContractSettlementOptions = {}): Promise<EconomicContract> {
    const contracts = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
    const treasury = new InstitutionTreasuryStore(options.treasuryPath ?? institutionTreasuryDbPath);
    try {
        let current = contracts.getContract(contractId);
        if (!current) throw new Error('Economic contract does not exist');
        for (const pending of contracts.listReadySettlements(contractId)) {
            const payment = contracts.startSettlement(pending.settlementId, options.now);
            try {
                treasury.bindSettlement(payment.reservationId, payment.settlementId, options.now);
                const receipt = await (options.rewarder ?? requestEnginePlayerReward)(payment.payeeUsername,
                    payment.amountGp, payment.settlementId);
                validateReceipt(receipt, payment);
                treasury.commit(payment.reservationId, payment.settlementId, options.now);
                current = contracts.commitSettlement(payment.settlementId, options.now);
            } catch (error) {
                contracts.noteSettlementFailure(payment.settlementId,
                    error instanceof Error ? error.message : String(error), options.now);
                throw error;
            }
        }
        return current;
    } finally {
        treasury.close();
        contracts.close();
    }
}

export async function recordAndSettleEconomicContractEvidence(contractId: string, actorAgentId: string,
    run: AdminSkillRun, avatarByAgentId: ReadonlyMap<string, string | null>,
    options: EconomicContractSettlementOptions = {}): Promise<EconomicContractEvidenceOutcome> {
    const contracts = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
    try {
        contracts.recordRunEvidence(contractId, actorAgentId, run, avatarByAgentId, options.now);
    } finally { contracts.close(); }
    try {
        return { contract: await settleReadyEconomicContract(contractId, options), settlementError: null };
    } catch (error) {
        const reopened = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
        try {
            const contract = reopened.getContract(contractId);
            if (!contract) throw new Error('Economic contract disappeared after evidence recording');
            return { contract, settlementError: error instanceof Error ? error.message : String(error) };
        } finally { reopened.close(); }
    }
}
