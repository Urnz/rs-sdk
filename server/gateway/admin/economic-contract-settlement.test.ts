import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { SkillEvent } from '../../../agent-skills/types.js';
import { EconomicContractStore, type CreateEconomicOffer } from './economic-contracts.js';
import { acceptFundedEconomicOffer, recordAndSettleEconomicContractEvidence,
    settleReadyEconomicContract } from './economic-contract-settlement.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import type { EnginePlayerEscrowRequest, EnginePlayerEscrowResult } from './player-escrow.js';
import type { AdminSkillRun } from './skill-history.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function fixture(balanceGp = 10_000) {
    const root = mkdtempSync(join(tmpdir(), 'rs-contract-settlement-'));
    directories.push(root);
    const options = { contractsPath: join(root, 'contracts.sqlite'), agentPath: join(root, 'agents.sqlite'),
        treasuryPath: join(root, 'treasury.sqlite'), now: '2026-09-02T10:00:00.000Z' };
    const agents = new AgentStateStore(options.agentPath);
    agents.createIdentity({ agentId: 'forge-mind', displayName: 'Forge Mind', background: 'Workshop manager.',
        personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'business',
            subjectId: 'varrock-forge', decisionIntervalMs: 60_000, maxDecisionsPerDay: 20,
            dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 10_000 } });
    agents.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye14',
        background: 'Miner.', personalityTraits: ['reliable'] });
    agents.createIdentity({ agentId: 'worker2', playerUsername: 'Worker2', displayName: 'Worker2',
        background: 'Courier.', personalityTraits: ['careful'] });
    agents.close();
    const treasury = new InstitutionTreasuryStore(options.treasuryPath);
    treasury.ensure('business', 'varrock-forge', options.now);
    treasury.setBalance('business', 'varrock-forge', 1, balanceGp, options.now);
    treasury.close();
    return options;
}

function offer(overrides: Partial<CreateEconomicOffer> = {}): CreateEconomicOffer {
    return { creatorAgentId: 'forge-mind', counterpartyAgentId: 'ferrye14', kind: 'work',
        title: 'Copper shift', summary: 'Complete one verified copper mining shift.',
        creatorProvides: { gp: 2_000, items: [], service: null },
        counterpartyProvides: { gp: 0, items: [], service: 'Mine copper.',
            skill: { id: 'mining.varrock.copper', version: '1.0.0' } },
        expiresAt: '2026-09-05T10:00:00.000Z', ...overrides };
}

function completedRun(username = 'ferrye14'): AdminSkillRun {
    const runId = '33333333-3333-4333-8333-333333333333';
    const skill = { id: 'mining.varrock.copper', version: '1.0.0' };
    const events: SkillEvent[] = [
        { runId, type: 'skill.started', timestamp: '2026-09-02T10:01:00.000Z', skill },
        { runId, type: 'skill.completed', timestamp: '2026-09-02T10:02:00.000Z', skill }
    ];
    return { runId, username, skill, status: 'completed', reason: 'Completed.', message: '',
        operations: 1, durationMs: 60_000, startedAt: '2026-09-02T10:01:00.000Z',
        finishedAt: '2026-09-02T10:02:00.000Z', events };
}

function escrowHarness() {
    const calls: EnginePlayerEscrowRequest[] = [];
    const assets = new Map<string, NonNullable<EnginePlayerEscrowRequest['assets']>>();
    const escrower = async (request: EnginePlayerEscrowRequest): Promise<EnginePlayerEscrowResult> => {
        calls.push(request);
        if (request.assets) assets.set(request.escrowId, request.assets);
        const status = request.operation === 'hold' ? 'held'
            : request.operation === 'release' ? 'released' : 'committed';
        return { ok: true, commandId: '88888888-8888-4888-8888-888888888888', ...request,
            escrow: { escrowId: request.escrowId, username: request.username,
                assets: assets.get(request.escrowId)!, status,
                payeeUsername: request.payeeUsername ?? null,
                committedAt: status === 'committed' ? '2026-09-02T10:03:00.000Z' : null } };
    };
    return { calls, escrower };
}

describe('funded economic contract settlement', () => {
    test('reserves institution funds at acceptance and pays the exact player once after performance', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer(), options.now,
            '11111111-1111-4111-8111-111111111111');
        contracts.close();
        const accepted = await acceptFundedEconomicOffer(created.offerId, 'ferrye14', created.revision, options);
        expect(await acceptFundedEconomicOffer(created.offerId, 'ferrye14', created.revision, options))
            .toEqual(accepted);
        await expect(acceptFundedEconomicOffer(created.offerId, 'other-agent', created.revision, options))
            .rejects.toThrow('Only the named counterparty');
        expect(accepted.contract.settlements).toEqual([expect.objectContaining({ party: 'a', amountGp: 2_000,
            payerActorId: 'varrock-forge', payeeUsername: 'ferrye14', status: 'funded' })]);
        const treasury = new InstitutionTreasuryStore(options.treasuryPath);
        expect(treasury.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 10_000,
            reservedGp: 2_000, availableGp: 8_000 });
        treasury.close();

        let rewardCalls = 0;
        const rewarder = async (username: string, amount: number, settlementId: string) => {
            rewardCalls++;
            return { ok: true, commandId: '44444444-4444-4444-8444-444444444444', username, amount,
                settlementId, reward: { status: 'committed' as const, coinsBefore: 100, coinsAfter: 2_100 } };
        };
        const avatars = new Map<string, string | null>([['forge-mind', null], ['ferrye14', 'ferrye14']]);
        const fulfilled = await recordAndSettleEconomicContractEvidence(accepted.contract.contractId,
            'ferrye14', completedRun(), avatars, { ...options, now: '2026-09-02T10:03:00.000Z', rewarder });
        expect(fulfilled).toMatchObject({ settlementError: null, contract: { status: 'fulfilled',
            partyASatisfied: true, partyBSatisfied: true,
            settlements: [expect.objectContaining({ status: 'committed', error: '' })] } });
        expect(rewardCalls).toBe(1);
        expect(await recordAndSettleEconomicContractEvidence(accepted.contract.contractId,
            'ferrye14', completedRun(), avatars, { ...options, now: '2026-09-02T10:04:00.000Z', rewarder }))
            .toEqual(fulfilled);
        expect(rewardCalls).toBe(1);
        const settledTreasury = new InstitutionTreasuryStore(options.treasuryPath);
        expect(settledTreasury.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 8_000,
            reservedGp: 0, availableGp: 8_000 });
        settledTreasury.close();
    });

    test('keeps funds reserved across an engine failure and retries the same settlement id', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer(), options.now);
        contracts.close();
        const accepted = await acceptFundedEconomicOffer(created.offerId, 'ferrye14', created.revision, options);
        const avatars = new Map<string, string | null>([['forge-mind', null], ['ferrye14', 'ferrye14']]);
        const attemptedIds: string[] = [];
        const failed = await recordAndSettleEconomicContractEvidence(accepted.contract.contractId, 'ferrye14',
            completedRun(), avatars, { ...options, rewarder: async (_username, _amount, settlementId) => {
                attemptedIds.push(settlementId); throw new Error('Engine offline');
            } });
        expect(failed).toMatchObject({ settlementError: 'Engine offline',
            contract: { settlements: [expect.objectContaining({ status: 'settling', error: 'Engine offline' })] } });
        const afterFailure = new EconomicContractStore(options.contractsPath);
        expect(afterFailure.getContract(accepted.contract.contractId)?.settlements[0])
            .toMatchObject({ status: 'settling', error: 'Engine offline' });
        afterFailure.close();
        const treasury = new InstitutionTreasuryStore(options.treasuryPath);
        expect(treasury.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 10_000, reservedGp: 2_000 });
        treasury.close();

        const completed = await settleReadyEconomicContract(accepted.contract.contractId, { ...options,
            now: '2026-09-02T10:05:00.000Z', rewarder: async (username, amount, settlementId) => {
                attemptedIds.push(settlementId);
                return { ok: true, commandId: '55555555-5555-4555-8555-555555555555', username, amount,
                    settlementId, reward: { status: 'committed' as const, coinsBefore: 0, coinsAfter: amount } };
            } });
        expect(completed.status).toBe('fulfilled');
        expect(attemptedIds).toHaveLength(2);
        expect(new Set(attemptedIds).size).toBe(1);
    });

    test('fails acceptance before contract creation when institution funding is unavailable or physical', async () => {
        const options = fixture(1_000);
        const contracts = new EconomicContractStore(options.contractsPath);
        const unfunded = contracts.create(offer(), options.now);
        contracts.close();
        await expect(acceptFundedEconomicOffer(unfunded.offerId, 'ferrye14', unfunded.revision, options))
            .rejects.toThrow('Insufficient institution treasury funds');
        const unchanged = new EconomicContractStore(options.contractsPath);
        expect(unchanged.getOffer(unfunded.offerId)).toMatchObject({ status: 'open', contractId: null });
        unchanged.close();

        const funded = new InstitutionTreasuryStore(options.treasuryPath);
        funded.setBalance('business', 'varrock-forge', 2, 10_000, options.now);
        funded.close();
        const physicalStore = new EconomicContractStore(options.contractsPath);
        const physical = physicalStore.create(offer({ title: 'Impossible institution delivery',
            creatorProvides: { gp: 2_000, items: [{ id: 436, name: 'Copper ore', count: 1 }], service: null } }),
        options.now);
        physicalStore.close();
        await expect(acceptFundedEconomicOffer(physical.offerId, 'ferrye14', physical.revision, options))
            .rejects.toThrow('avatarless institution');
    });

    test('holds player assets at acceptance and commits them only after exact counterparty performance', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer({ creatorAgentId: 'ferrye14', counterpartyAgentId: 'worker2',
            creatorProvides: { gp: 400, items: [{ id: 436, name: 'Copper ore', count: 5 }], service: null },
            counterpartyProvides: { gp: 0, items: [], service: 'Mine copper.',
                skill: { id: 'mining.varrock.copper', version: '1.0.0' } } }), options.now);
        contracts.close();
        const harness = escrowHarness();
        const accepted = await acceptFundedEconomicOffer(created.offerId, 'worker2', created.revision,
            { ...options, escrower: harness.escrower });
        const escrowId = harness.calls[0]!.escrowId;
        expect(accepted.contract.playerEscrows[0]?.escrowId).toBe(escrowId);
        expect(accepted.contract).toMatchObject({ status: 'active', partyASatisfied: false,
            partyBSatisfied: false, settlements: [], playerEscrows: [expect.objectContaining({
                party: 'a', payerUsername: 'ferrye14', payeeUsername: 'worker2', status: 'funded',
                assets: { gp: 400, items: [{ id: 436, count: 5 }] }
            })] });
        expect(harness.calls).toEqual([expect.objectContaining({ operation: 'hold', username: 'ferrye14',
            assets: { gp: 400, items: [{ id: 436, count: 5 }] } })]);

        const avatars = new Map<string, string | null>([['ferrye14', 'ferrye14'], ['worker2', 'worker2']]);
        const outcome = await recordAndSettleEconomicContractEvidence(accepted.contract.contractId, 'worker2',
            completedRun('worker2'), avatars,
            { ...options, now: '2026-09-02T10:03:00.000Z', escrower: harness.escrower });
        expect(outcome).toMatchObject({ settlementError: null, contract: { status: 'fulfilled',
            partyASatisfied: true, partyBSatisfied: true,
            playerEscrows: [expect.objectContaining({ status: 'committed', error: '' })] } });
        expect(harness.calls[1]).toMatchObject({ operation: 'commit', username: 'ferrye14',
            payeeUsername: 'worker2', escrowId });
        await settleReadyEconomicContract(accepted.contract.contractId,
            { ...options, now: '2026-09-02T10:04:00.000Z', escrower: harness.escrower });
        expect(harness.calls).toHaveLength(2);
    });

    test('settles a bilateral player asset swap from two secured escrows without evidence deadlock', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer({ creatorAgentId: 'ferrye14', counterpartyAgentId: 'worker2',
            kind: 'trade', creatorProvides: { gp: 0,
                items: [{ id: 436, name: 'Copper ore', count: 5 }], service: null },
            counterpartyProvides: { gp: 300, items: [], service: null } }), options.now);
        contracts.close();
        const harness = escrowHarness();
        const accepted = await acceptFundedEconomicOffer(created.offerId, 'worker2', created.revision,
            { ...options, escrower: harness.escrower });
        expect(accepted.contract.playerEscrows).toHaveLength(2);
        const fulfilled = await settleReadyEconomicContract(accepted.contract.contractId,
            { ...options, now: '2026-09-02T10:01:00.000Z', escrower: harness.escrower });
        expect(fulfilled).toMatchObject({ status: 'fulfilled', partyASatisfied: true, partyBSatisfied: true });
        expect(harness.calls.map(call => call.operation)).toEqual(['hold', 'hold', 'commit', 'commit']);
        expect(new Set(harness.calls.filter(call => call.operation === 'commit').map(call => call.escrowId)).size).toBe(2);
    });

    test('keeps a player escrow funded across an engine failure and retries the exact escrow id', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer({ creatorAgentId: 'ferrye14', counterpartyAgentId: 'worker2',
            kind: 'trade', creatorProvides: { gp: 250, items: [], service: null },
            counterpartyProvides: { gp: 0,
                items: [{ id: 436, name: 'Copper ore', count: 2 }], service: null } }), options.now);
        contracts.close();
        const harness = escrowHarness();
        const accepted = await acceptFundedEconomicOffer(created.offerId, 'worker2', created.revision,
            { ...options, escrower: harness.escrower });
        const firstEscrowId = accepted.contract.playerEscrows[0]!.escrowId;
        let failed = false;
        await expect(settleReadyEconomicContract(accepted.contract.contractId, { ...options,
            now: '2026-09-02T10:01:00.000Z', escrower: async request => {
                if (request.operation === 'commit' && !failed) { failed = true; throw new Error('Engine offline'); }
                return harness.escrower(request);
            } })).rejects.toThrow('Engine offline');
        const pending = new EconomicContractStore(options.contractsPath);
        expect(pending.getPlayerEscrow(firstEscrowId)).toMatchObject({ status: 'settling', error: 'Engine offline' });
        pending.close();
        const fulfilled = await settleReadyEconomicContract(accepted.contract.contractId,
            { ...options, now: '2026-09-02T10:02:00.000Z', escrower: harness.escrower });
        expect(fulfilled.status).toBe('fulfilled');
        expect(harness.calls.filter(call => call.operation === 'commit').map(call => call.escrowId))
            .toEqual([firstEscrowId, accepted.contract.playerEscrows[1]!.escrowId]);
    });

    test('releases a held player escrow when funded acceptance cannot be confirmed', async () => {
        const options = fixture();
        const contracts = new EconomicContractStore(options.contractsPath);
        const created = contracts.create(offer({ creatorAgentId: 'ferrye14', counterpartyAgentId: 'worker2',
            creatorProvides: { gp: 100, items: [], service: null } }), options.now);
        contracts.close();
        const harness = escrowHarness();
        let first = true;
        await expect(acceptFundedEconomicOffer(created.offerId, 'worker2', created.revision, {
            ...options, escrower: async request => {
                const receipt = await harness.escrower(request);
                if (first) { first = false; return { ...receipt, escrowId: '99999999-9999-4999-8999-999999999999' }; }
                return receipt;
            }
        })).rejects.toThrow('mismatched player escrow receipt');
        expect(harness.calls.map(call => call.operation)).toEqual(['hold', 'release']);
        const unchanged = new EconomicContractStore(options.contractsPath);
        expect(unchanged.getOffer(created.offerId)).toMatchObject({ status: 'open', contractId: null });
        unchanged.close();
    });
});
