import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomicContractStore, validateEconomicOffer, type CreateEconomicOffer } from './economic-contracts.js';
import { adminPublicDir } from './paths.js';
import type { AdminSkillRun } from './skill-history.js';
import type { SkillEvent } from '../../../agent-skills/types.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function store(): EconomicContractStore {
    const directory = mkdtempSync(join(tmpdir(), 'rs-contracts-'));
    directories.push(directory);
    return new EconomicContractStore(join(directory, 'contracts.sqlite'));
}

function workOffer(overrides: Partial<CreateEconomicOffer> = {}): CreateEconomicOffer {
    return { creatorAgentId: 'varrock-forge', counterpartyAgentId: 'ferrye14', kind: 'work',
        title: 'Copper delivery', summary: 'Mine and deliver one hundred copper ore to the forge.',
        creatorProvides: { gp: 2_000, items: [], service: null },
        counterpartyProvides: { gp: 0, items: [{ id: 436, name: 'Copper ore', count: 100 }],
            service: 'Mine the contracted copper ore.',
            skill: { id: 'mining.varrock.copper', version: '1.0.0' } },
        expiresAt: '2026-09-05T12:00:00.000Z', ...overrides };
}

describe('economic offer validation', () => {
    test('normalizes item order into a stable immutable terms digest', () => {
        const first = validateEconomicOffer(workOffer({ counterpartyProvides: { gp: 0, service: 'Delivery',
            skill: { id: 'mining.varrock.copper', version: '1.0.0' }, items: [
            { id: 438, name: 'Tin ore', count: 50 }, { id: 436, name: 'Copper ore', count: 50 }] } }),
        '2026-09-01T12:00:00.000Z');
        const second = validateEconomicOffer(workOffer({ counterpartyProvides: { gp: 0, service: 'Delivery',
            skill: { id: 'mining.varrock.copper', version: '1.0.0' }, items: [
            { id: 436, name: 'Copper ore', count: 50 }, { id: 438, name: 'Tin ore', count: 50 }] } }),
        '2026-09-01T12:00:00.000Z');
        expect(first.termsDigest).toBe(second.termsDigest);
        expect(first.counterpartyProvides.items.map(item => item.id)).toEqual([436, 438]);
    });

    test('requires two bounded reciprocal obligations and a future expiry', () => {
        expect(() => validateEconomicOffer(workOffer({ creatorAgentId: 'ferrye14' }),
            '2026-09-01T12:00:00.000Z')).toThrow('two different agents');
        expect(() => validateEconomicOffer(workOffer({ creatorProvides: { gp: 0, items: [], service: null } }),
            '2026-09-01T12:00:00.000Z')).toThrow('must contain an obligation');
        expect(() => validateEconomicOffer(workOffer({ expiresAt: '2026-08-01T00:00:00.000Z' }),
            '2026-09-01T12:00:00.000Z')).toThrow('next 365 days');
    });
});

test('admin UI exposes authenticated economic offer creation and lifecycle actions', () => {
    const html = readFileSync(join(adminPublicDir, 'index.html'), 'utf8');
    const script = readFileSync(join(adminPublicDir, 'admin.js'), 'utf8');
    expect(html).toContain('id="economic-offer-form"');
    expect(html).toContain('id="economic-contract-list"');
    expect(script).toContain("api('/api/admin/economic-contracts?limit=100', { mutation: true })");
    expect(script).toContain('data-action="economic-offer-update"');
    expect(script).toContain('data-action="economic-contract-evidence"');
    expect(script).toContain('data-action="economic-contract-settle"');
    expect(script).toContain('/settle`');
    expect(script).toContain("api('/api/admin/economic-offers'");
    const transformed = new Bun.Transpiler({ loader: 'js', target: 'browser' }).transformSync(script);
    expect(transformed.length).toBeGreaterThan(1_000);
});

describe('persistent economic offers and contracts', () => {
    test('atomically accepts an offer and snapshots immutable bilateral terms', () => {
        const contracts = store();
        const created = contracts.create(workOffer(), '2026-09-01T12:00:00.000Z',
            '11111111-1111-4111-8111-111111111111');
        const result = contracts.accept(created.offerId, 'ferrye14', created.revision,
            '2026-09-01T13:00:00.000Z', '22222222-2222-4222-8222-222222222222');
        expect(result.offer).toMatchObject({ status: 'accepted', revision: 2,
            contractId: '22222222-2222-4222-8222-222222222222' });
        expect(result.contract).toMatchObject({ status: 'active', partyAAgentId: 'varrock-forge',
            partyBAgentId: 'ferrye14', termsDigest: created.termsDigest,
            partyAProvides: { gp: 2_000 }, partyBProvides: { service: 'Mine the contracted copper ore.' } });
        expect(contracts.accept(created.offerId, 'ferrye14', created.revision,
            '2026-09-01T14:00:00.000Z').contract).toEqual(result.contract);
        contracts.close();

        const reopened = new EconomicContractStore(join(directories[0]!, 'contracts.sqlite'));
        expect(reopened.listContracts()).toEqual([result.contract]);
        reopened.close();
    });

    test('enforces exact counterparties, optimistic revisions, expiry, decline and withdrawal', () => {
        const contracts = store();
        const first = contracts.create(workOffer(), '2026-09-01T12:00:00.000Z');
        expect(() => contracts.accept(first.offerId, 'outsider', first.revision,
            '2026-09-01T13:00:00.000Z')).toThrow('named counterparty');
        expect(() => contracts.accept(first.offerId, 'ferrye14', 99,
            '2026-09-01T13:00:00.000Z')).toThrow('changed before acceptance');
        const declined = contracts.decline(first.offerId, 'ferrye14', first.revision, 'Not enough capacity.',
            '2026-09-01T13:00:00.000Z');
        expect(declined).toMatchObject({ status: 'declined', responseNote: 'Not enough capacity.' });

        const second = contracts.create(workOffer({ title: 'Second delivery' }), '2026-09-01T12:00:00.000Z');
        expect(() => contracts.withdraw(second.offerId, 'ferrye14', second.revision, 'No.',
            '2026-09-01T13:00:00.000Z')).toThrow('creator');
        expect(contracts.withdraw(second.offerId, 'varrock-forge', second.revision, 'Requirements changed.',
            '2026-09-01T13:00:00.000Z').status).toBe('withdrawn');

        contracts.create(workOffer({ title: 'Expiring delivery', expiresAt: '2026-09-01T12:01:00.000Z' }),
            '2026-09-01T12:00:00.000Z');
        expect(contracts.listOffers(100, '2026-09-01T12:02:00.000Z').some(item => item.status === 'expired')).toBeTrue();
        contracts.close();
    });
});

function completedRun(runId: string, username: string, skillId: string, events: SkillEvent[]): AdminSkillRun {
    const journalEvents = events.length ? events : [
        { runId, type: 'skill.started' as const, timestamp: '2026-09-01T13:00:00.000Z',
            skill: { id: skillId, version: '1.0.0' } },
        { runId, type: 'skill.completed' as const, timestamp: '2026-09-01T13:01:00.000Z',
            skill: { id: skillId, version: '1.0.0' } }
    ];
    return { runId, username, skill: { id: skillId, version: '1.0.0' }, status: 'completed', reason: 'Completed.',
        message: '', operations: Math.max(1, events.length), durationMs: 1_000,
        startedAt: '2026-09-01T13:00:00.000Z', finishedAt: '2026-09-01T13:01:00.000Z', events: journalEvents };
}

function tradeEvent(runId: string, skillId: string, partner: string,
    data: Record<string, unknown>): SkillEvent {
    return { runId, type: 'step.succeeded', timestamp: '2026-09-01T13:00:30.000Z',
        skill: { id: skillId, version: '1.0.0' }, stepId: 'trade', operation: 'trade-give-item', data };
}

describe('contract performance evidence', () => {
    test('requires independent exact-avatar journals and fulfills only after every obligation is evidenced', () => {
        const contracts = store();
        const offer = contracts.create(workOffer(), '2026-09-01T12:00:00.000Z');
        const active = contracts.accept(offer.offerId, 'ferrye14', offer.revision,
            '2026-09-01T12:30:00.000Z').contract;
        const avatars = new Map<string, string | null>([
            ['varrock-forge', 'forgepay'], ['ferrye14', 'ferrye14']
        ]);
        const serviceRunId = '33333333-3333-4333-8333-333333333333';
        const mined = contracts.recordRunEvidence(active.contractId, 'ferrye14',
            completedRun(serviceRunId, 'ferrye14', 'mining.varrock.copper', []), avatars,
            '2026-09-01T13:02:00.000Z');
        expect(mined).toMatchObject({ status: 'active', partyASatisfied: false, partyBSatisfied: false });
        expect(mined.evidence[0]).toMatchObject({ party: 'b', matchedService: true, matchedGp: 0 });

        const workerTradeId = '44444444-4444-4444-8444-444444444444';
        const workerTrade = completedRun(workerTradeId, 'ferrye14', 'trade.varrock.deliver-copper', [
            tradeEvent(workerTradeId, 'trade.varrock.deliver-copper', 'ForgePay', {
                partner: 'ForgePay', gave: [{ id: 436, name: 'Copper ore', count: 100 }],
                received: [{ id: 995, name: 'Coins', count: 2_000 }],
                inventoryDelta: [{ id: 436, name: 'Copper ore', delta: -100 },
                    { id: 995, name: 'Coins', delta: 2_000 }]
            })
        ]);
        const delivered = contracts.recordRunEvidence(active.contractId, 'ferrye14', workerTrade, avatars,
            '2026-09-01T13:03:00.000Z');
        expect(delivered).toMatchObject({ status: 'active', partyASatisfied: false, partyBSatisfied: true });

        const payerTradeId = '55555555-5555-4555-8555-555555555555';
        const payerTrade = completedRun(payerTradeId, 'forgepay', 'trade.varrock.pay-worker', [
            tradeEvent(payerTradeId, 'trade.varrock.pay-worker', 'Ferrye14', {
                partner: 'Ferrye14', gave: [{ id: 995, name: 'Coins', count: 2_000 }],
                received: [{ id: 436, name: 'Copper ore', count: 100 }],
                inventoryDelta: [{ id: 995, name: 'Coins', delta: -2_000 },
                    { id: 436, name: 'Copper ore', delta: 100 }]
            })
        ]);
        const fulfilled = contracts.recordRunEvidence(active.contractId, 'varrock-forge', payerTrade, avatars,
            '2026-09-01T13:04:00.000Z');
        expect(fulfilled).toMatchObject({ status: 'fulfilled', partyASatisfied: true,
            partyBSatisfied: true, fulfilledAt: '2026-09-01T13:04:00.000Z', revision: 4 });
        expect(fulfilled.evidence).toHaveLength(3);
        expect(contracts.recordRunEvidence(active.contractId, 'varrock-forge', payerTrade, avatars)).toEqual(fulfilled);
        contracts.close();
    });

    test('rejects unrelated, pre-contract, failed, foreign-avatar and reused evidence', () => {
        const contracts = store();
        const offer = contracts.create(workOffer(), '2026-09-01T12:00:00.000Z');
        const active = contracts.accept(offer.offerId, 'ferrye14', offer.revision,
            '2026-09-01T12:30:00.000Z').contract;
        const avatars = new Map<string, string | null>([
            ['varrock-forge', 'forgepay'], ['ferrye14', 'ferrye14']
        ]);
        const run = completedRun('66666666-6666-4666-8666-666666666666', 'otherbot',
            'mining.varrock.copper', []);
        expect(() => contracts.recordRunEvidence(active.contractId, 'ferrye14', run, avatars)).toThrow('exact party avatar');
        expect(() => contracts.recordRunEvidence(active.contractId, 'outsider',
            { ...run, username: 'ferrye14' }, avatars)).toThrow('contract party');
        expect(() => contracts.recordRunEvidence(active.contractId, 'ferrye14',
            { ...run, username: 'ferrye14', status: 'failed' }, avatars)).toThrow('completed post-acceptance');
        expect(() => contracts.recordRunEvidence(active.contractId, 'ferrye14',
            { ...run, username: 'ferrye14', startedAt: '2026-09-01T12:00:00.000Z' }, avatars)).toThrow('post-acceptance');
        expect(() => contracts.recordRunEvidence(active.contractId, 'ferrye14',
            completedRun('77777777-7777-4777-8777-777777777777', 'ferrye14', 'unrelated.skill', []), avatars))
            .toThrow('no evidence relevant');
        const valid = completedRun('88888888-8888-4888-8888-888888888888', 'ferrye14',
            'mining.varrock.copper', []);
        contracts.recordRunEvidence(active.contractId, 'ferrye14', valid, avatars);
        const secondOffer = contracts.create(workOffer({ title: 'Another delivery' }),
            '2026-09-01T12:00:00.000Z');
        const secondContract = contracts.accept(secondOffer.offerId, 'ferrye14', secondOffer.revision,
            '2026-09-01T12:30:00.000Z').contract;
        expect(() => contracts.recordRunEvidence(secondContract.contractId, 'ferrye14', valid, avatars))
            .toThrow('already claimed');
        contracts.close();
    });
});
