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

function completedRun(): AdminSkillRun {
    const runId = '33333333-3333-4333-8333-333333333333';
    const skill = { id: 'mining.varrock.copper', version: '1.0.0' };
    const events: SkillEvent[] = [
        { runId, type: 'skill.started', timestamp: '2026-09-02T10:01:00.000Z', skill },
        { runId, type: 'skill.completed', timestamp: '2026-09-02T10:02:00.000Z', skill }
    ];
    return { runId, username: 'ferrye14', skill, status: 'completed', reason: 'Completed.', message: '',
        operations: 1, durationMs: 60_000, startedAt: '2026-09-02T10:01:00.000Z',
        finishedAt: '2026-09-02T10:02:00.000Z', events };
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
});
