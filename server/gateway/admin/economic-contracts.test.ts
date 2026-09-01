import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomicContractStore, validateEconomicOffer, type CreateEconomicOffer } from './economic-contracts.js';
import { adminPublicDir } from './paths.js';

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
            service: 'Deliver the ore to the Varrock forge.' },
        expiresAt: '2026-09-05T12:00:00.000Z', ...overrides };
}

describe('economic offer validation', () => {
    test('normalizes item order into a stable immutable terms digest', () => {
        const first = validateEconomicOffer(workOffer({ counterpartyProvides: { gp: 0, service: 'Delivery', items: [
            { id: 438, name: 'Tin ore', count: 50 }, { id: 436, name: 'Copper ore', count: 50 }] } }),
        '2026-09-01T12:00:00.000Z');
        const second = validateEconomicOffer(workOffer({ counterpartyProvides: { gp: 0, service: 'Delivery', items: [
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
            partyAProvides: { gp: 2_000 }, partyBProvides: { service: 'Deliver the ore to the Varrock forge.' } });
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
