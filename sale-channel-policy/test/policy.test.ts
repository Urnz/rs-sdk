import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { assertAcceptedBusinessAcquisition, decideSaleChannel, loadSaleChannelPolicyCatalog,
    validateSaleChannelPolicyCatalog, type ItemInspectionEvidence, type ItemSaleOffer } from '../index.js';

const catalog = () => loadSaleChannelPolicyCatalog(join(import.meta.dir, '..', '..', 'config',
    'sale-channel-policies.json'));
const offer = (channel: ItemSaleOffer['channel'] = 'business-shop'): ItemSaleOffer => ({ offerId: 'offer-1', channel,
    sellerAgentId: 'seller', acquirer: channel === 'business-shop' ? { kind: 'business', id: 'general-store' }
        : channel === 'npc-shop' ? { kind: 'npc', id: 'shopkeeper-1' } : { kind: 'agent', id: 'buyer' },
    itemId: 1265, quantity: 1, assetId: 'pickaxe-1', provenanceDigest: 'a'.repeat(64) });
const inspection = (finding: ItemInspectionEvidence['finding'], inspector = offer().acquirer): ItemInspectionEvidence => ({
    evidenceId: `inspection-${finding}`, offerId: 'offer-1', inspector, method: 'reported-identifier', finding,
    sourceRecordId: 'local-report-1', sourceEvidenceDigest: 'b'.repeat(64), occurredAt: '2030-01-01T00:00:00.000Z' });

describe('observer-scoped sale channel policy', () => {
    test('rejects only when the acquiring merchant trusted evidence recognizes the item', () => {
        const rejected = decideSaleChannel(catalog(), offer(), [inspection('recognized-ineligible')], () => true);
        expect(rejected).toMatchObject({ status: 'rejected', reason: 'recognized-ineligible',
            provenanceDisposition: 'preserve' });
        const accepted = decideSaleChannel(catalog(), offer(), [inspection('no-match')], () => true);
        expect(accepted).toMatchObject({ status: 'accepted', reason: 'not-recognized' });
        assertAcceptedBusinessAcquisition(accepted, { offerId: 'offer-1', businessId: 'general-store',
            itemId: 1265, quantity: 1, policyDigest: catalog().digest });
        expect(() => assertAcceptedBusinessAcquisition(rejected, { offerId: 'offer-1', businessId: 'general-store',
            itemId: 1265, quantity: 1, policyDigest: catalog().digest })).toThrow('not eligible');
    });
    test('does not grant a merchant another observer\'s knowledge', () => {
        expect(() => decideSaleChannel(catalog(), offer(), [inspection('recognized-ineligible',
            { kind: 'business', id: 'other-store' })], () => true)).toThrow('another observer');
        expect(() => decideSaleChannel(catalog(), offer(), [inspection('recognized-ineligible')], () => false))
            .toThrow('not trusted');
        expect(decideSaleChannel(catalog(), offer(), [], () => true)).toMatchObject({ status: 'accepted',
            consideredEvidenceIds: [] });
    });
    test('allows direct player trade while preserving available provenance', () => {
        expect(decideSaleChannel(catalog(), offer('player-trade'), [], () => true)).toMatchObject({ status: 'accepted',
            reason: 'direct-trade', provenanceDisposition: 'preserve', offer: { assetId: 'pickaxe-1',
                provenanceDigest: 'a'.repeat(64) } });
        expect(() => decideSaleChannel(catalog(), offer('player-trade'), [inspection('inconclusive')], () => true))
            .toThrow('does not consume merchant inspection');
    });
    test('rejects weakened or malformed channel configuration', () => {
        const value = { schemaVersion: 1, channels: [
            { channel: 'business-shop', acquirerKind: 'business', inspection: 'none',
                recognizedIneligible: 'pass-through', provenanceDisposition: 'preserve' },
            { channel: 'npc-shop', acquirerKind: 'npc', inspection: 'observer-evidence',
                recognizedIneligible: 'reject', provenanceDisposition: 'preserve' },
            { channel: 'player-trade', acquirerKind: 'agent', inspection: 'none',
                recognizedIneligible: 'pass-through', provenanceDisposition: 'preserve' }] };
        expect(() => validateSaleChannelPolicyCatalog(value)).toThrow('weakens');
    });
});
