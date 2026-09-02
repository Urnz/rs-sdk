import { createHash } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { AdminSkillRun } from './skill-history.js';
import { EconomicContractStore, type CreateEconomicContractSettlement,
    type CreateEconomicContractPlayerEscrow, type EconomicContract, type EconomicObligation } from './economic-contracts.js';
import { InstitutionTreasuryStore, type InstitutionKind,
    type InstitutionTreasuryTransfer } from './institution-treasury.js';
import { requestEnginePlayerEscrow, type EnginePlayerEscrowResult } from './player-escrow.js';
import { requestEnginePlayerReward, type EnginePlayerRewardResult } from './player-rewards.js';
import { agentStateDbPath, economicContractsDbPath, institutionTreasuryDbPath } from './paths.js';

export interface EconomicContractSettlementOptions {
    contractsPath?: string;
    agentPath?: string;
    treasuryPath?: string;
    now?: string;
    rewarder?: typeof requestEnginePlayerReward;
    escrower?: typeof requestEnginePlayerEscrow;
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
    if (payer.subjectKind !== 'business' && payer.subjectKind !== 'faction') {
        throw new Error('Institution settlement payer has no supported treasury');
    }
    let payeeUsername: string | null = null;
    let payeeKind: InstitutionKind | null = null;
    let payeeActorId: string | null = null;
    if (payee.role === 'player' && payee.subjectKind === 'player' && payee.avatarPlayerUsername) {
        payeeUsername = payee.avatarPlayerUsername.trim().toLowerCase();
        if (!/^[a-z0-9]{1,12}$/.test(payeeUsername)) {
            throw new Error('Contract settlement player avatar is not payable by the engine reward channel');
        }
    } else if (payee.role === 'institution'
        && (payee.subjectKind === 'business' || payee.subjectKind === 'faction')) {
        payeeKind = payee.subjectKind;
        payeeActorId = payee.subjectId;
        if (payer.subjectKind === payeeKind && payer.subjectId === payeeActorId) {
            throw new Error('Institution settlement payer and payee treasury must be different');
        }
    } else {
        throw new Error('Institution treasury GP requires an exact player or institution payee');
    }
    const contractId = stableUuid(`economic-contract:${offerId}`);
    return { party, payerAgentId, payerKind: payer.subjectKind as InstitutionKind,
        payerActorId: payer.subjectId, payeeAgentId, payeeUsername, payeeKind, payeeActorId,
        amountGp: obligation.gp, reservationId: `contract.${contractId}.${party}`,
        settlementId: stableUuid(`economic-contract-settlement:${contractId}:${party}`) };
}

function playerEscrowForParty(party: 'a' | 'b', offerId: string,
    payerAgentId: string, payeeAgentId: string, obligation: EconomicObligation,
    agents: AgentStateStore): CreateEconomicContractPlayerEscrow | null {
    if (obligation.gp === 0 && obligation.items.length === 0) return null;
    const payer = agents.getControlProfile(payerAgentId);
    const payee = agents.getControlProfile(payeeAgentId);
    if (!payer || !payee) throw new Error('Player escrow requires two persistent agent profiles');
    if (payer.role !== 'player' || payer.subjectKind !== 'player' || !payer.avatarPlayerUsername) {
        if (payer.role === 'institution') return null;
        throw new Error('Only an avatar-bound player or funded institution may provide contract assets');
    }
    if (payee.role !== 'player' || payee.subjectKind !== 'player' || !payee.avatarPlayerUsername) {
        throw new Error('Player inventory assets may be escrowed only to an exact avatar-bound player agent');
    }
    const payerUsername = payer.avatarPlayerUsername.trim().toLowerCase();
    const payeeUsername = payee.avatarPlayerUsername.trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(payerUsername) || !/^[a-z0-9]{1,12}$/.test(payeeUsername)
        || payerUsername === payeeUsername) {
        throw new Error('Contract player escrow requires two different valid player avatars');
    }
    const contractId = stableUuid(`economic-contract:${offerId}`);
    return { party, payerAgentId, payerUsername, payeeAgentId, payeeUsername,
        assets: { gp: obligation.gp, items: obligation.items.map(item => ({ id: item.id, count: item.count })) },
        escrowId: stableUuid(`economic-contract-player-escrow:${contractId}:${party}`) };
}

export async function acceptFundedEconomicOffer(offerId: string, actorAgentId: string,
    expectedRevision: number, options: EconomicContractSettlementOptions = {}) {
    const contracts = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
    const agents = new AgentStateStore(options.agentPath ?? agentStateDbPath);
    const treasury = new InstitutionTreasuryStore(options.treasuryPath ?? institutionTreasuryDbPath);
    const newlyReserved: string[] = [];
    const attemptedPlayerEscrows: CreateEconomicContractPlayerEscrow[] = [];
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
        const playerEscrows = [
            playerEscrowForParty('a', offer.offerId, offer.creatorAgentId, offer.counterpartyAgentId,
                offer.creatorProvides, agents),
            playerEscrowForParty('b', offer.offerId, offer.counterpartyAgentId, offer.creatorAgentId,
                offer.counterpartyProvides, agents)
        ].filter((item): item is CreateEconomicContractPlayerEscrow => item !== null);
        for (const payment of settlements) {
            const held = treasury.reserve(payment.payerKind, payment.payerActorId,
                payment.reservationId, payment.amountGp, options.now);
            if (held.created) newlyReserved.push(payment.reservationId);
            treasury.bindSettlement(payment.reservationId, payment.settlementId, options.now);
        }
        for (const held of playerEscrows) {
            attemptedPlayerEscrows.push(held);
            const receipt = await (options.escrower ?? requestEnginePlayerEscrow)({
                escrowId: held.escrowId, operation: 'hold', username: held.payerUsername, assets: held.assets
            });
            validatePlayerEscrowReceipt(receipt, held, 'hold');
        }
        return contracts.accept(offerId, actorAgentId, expectedRevision, options.now,
            stableUuid(`economic-contract:${offer.offerId}`), settlements, playerEscrows);
    } catch (error) {
        for (const reservationId of newlyReserved) treasury.release(reservationId, options.now);
        const rollbackErrors: string[] = [];
        for (const held of attemptedPlayerEscrows) {
            try {
                const receipt = await (options.escrower ?? requestEnginePlayerEscrow)({
                    escrowId: held.escrowId, operation: 'release', username: held.payerUsername
                });
                validatePlayerEscrowReceipt(receipt, held, 'release');
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
            }
        }
        if (rollbackErrors.length > 0) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${message}; player escrow rollback requires reconciliation: ${rollbackErrors.join('; ')}`);
        }
        throw error;
    } finally {
        treasury.close();
        agents.close();
        contracts.close();
    }
}

function validatePlayerEscrowReceipt(receipt: EnginePlayerEscrowResult,
    held: CreateEconomicContractPlayerEscrow, operation: 'hold' | 'release' | 'commit'): void {
    const expectedStatus = operation === 'hold' ? 'held' : operation === 'release' ? 'released' : 'committed';
    if (!receipt.ok || receipt.escrowId !== held.escrowId || receipt.operation !== operation
        || receipt.username.trim().toLowerCase() !== held.payerUsername
        || (operation === 'commit' && receipt.payeeUsername?.trim().toLowerCase() !== held.payeeUsername)
        || receipt.escrow?.status !== expectedStatus) {
        throw new Error('Engine returned a mismatched player escrow receipt');
    }
}

function validateReceipt(receipt: EnginePlayerRewardResult, payment: CreateEconomicContractSettlement): void {
    if (!payment.payeeUsername || !receipt.ok || receipt.settlementId !== payment.settlementId
        || receipt.username.trim().toLowerCase() !== payment.payeeUsername.trim().toLowerCase()
        || receipt.amount !== payment.amountGp) {
        throw new Error('Engine returned a mismatched contract settlement receipt');
    }
}

function validateTreasuryTransfer(receipt: InstitutionTreasuryTransfer,
    payment: CreateEconomicContractSettlement): void {
    if (!payment.payeeKind || !payment.payeeActorId || receipt.settlementId !== payment.settlementId
        || receipt.reservationId !== payment.reservationId || receipt.payerKind !== payment.payerKind
        || receipt.payerActorId !== payment.payerActorId || receipt.payeeKind !== payment.payeeKind
        || receipt.payeeActorId !== payment.payeeActorId || receipt.amountGp !== payment.amountGp) {
        throw new Error('Treasury returned a mismatched contract transfer receipt');
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
                if (payment.payeeKind && payment.payeeActorId) {
                    const receipt = treasury.transferReserved(payment.reservationId, payment.settlementId,
                        payment.payeeKind, payment.payeeActorId, options.now);
                    validateTreasuryTransfer(receipt, payment);
                } else {
                    if (!payment.payeeUsername) throw new Error('Contract settlement has no exact payee');
                    const receipt = await (options.rewarder ?? requestEnginePlayerReward)(payment.payeeUsername,
                        payment.amountGp, payment.settlementId);
                    validateReceipt(receipt, payment);
                    treasury.commit(payment.reservationId, payment.settlementId, options.now);
                }
                current = contracts.commitSettlement(payment.settlementId, options.now);
            } catch (error) {
                contracts.noteSettlementFailure(payment.settlementId,
                    error instanceof Error ? error.message : String(error), options.now);
                throw error;
            }
        }
        for (const pending of contracts.listReadyPlayerEscrows(contractId)) {
            const held = contracts.startPlayerEscrowSettlement(pending.escrowId, options.now);
            try {
                const receipt = await (options.escrower ?? requestEnginePlayerEscrow)({
                    escrowId: held.escrowId, operation: 'commit', username: held.payerUsername,
                    payeeUsername: held.payeeUsername
                });
                validatePlayerEscrowReceipt(receipt, held, 'commit');
                current = contracts.commitPlayerEscrow(held.escrowId, options.now);
            } catch (error) {
                contracts.notePlayerEscrowFailure(held.escrowId,
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

export async function resolveEconomicContract(contractId: string, resolution: 'cancelled' | 'defaulted',
    expectedRevision: number, note: string,
    options: EconomicContractSettlementOptions = {}): Promise<EconomicContract> {
    const contracts = new EconomicContractStore(options.contractsPath ?? economicContractsDbPath);
    const treasury = new InstitutionTreasuryStore(options.treasuryPath ?? institutionTreasuryDbPath);
    try {
        let current = contracts.startResolution(contractId, resolution, expectedRevision, note, options.now);
        for (const payment of current.settlements) {
            if (payment.status === 'committed' || payment.status === 'released') continue;
            const released = treasury.release(payment.reservationId, options.now);
            if (!released || released.reservationId !== payment.reservationId
                || released.kind !== payment.payerKind || released.actorId !== payment.payerActorId
                || released.amountGp !== payment.amountGp || released.status !== 'released') {
                throw new Error('Treasury returned a mismatched contract release receipt');
            }
            contracts.markSettlementReleased(payment.settlementId, options.now);
        }
        current = contracts.getContract(contractId)!;
        for (const held of current.playerEscrows) {
            if (held.status === 'committed' || held.status === 'released') continue;
            const receipt = await (options.escrower ?? requestEnginePlayerEscrow)({
                escrowId: held.escrowId, operation: 'release', username: held.payerUsername
            });
            validatePlayerEscrowReceipt(receipt, held, 'release');
            contracts.markPlayerEscrowReleased(held.escrowId, options.now);
        }
        return contracts.completeResolution(contractId, resolution, options.now);
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
