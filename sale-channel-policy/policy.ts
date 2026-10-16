import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ItemInspectionEvidence, ItemInspectionVerifier, ItemSaleOffer, SaleChannel,
    SaleChannelDecision, SaleChannelPolicyCatalog, SaleChannelRule, SaleCounterparty } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/;
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function exact(value: object, keys: string[], field: string): void { if (Object.keys(value).sort().join(',')
    !== [...keys].sort().join(',')) throw new Error(`${field} is invalid`); }
function id(value: string, field: string): string { if (typeof value !== 'string' || !ID.test(value)) {
    throw new Error(`${field} is invalid`); } return value; }
function integer(value: number, field: string, minimum = 1): number { if (!Number.isSafeInteger(value) || value < minimum
    || value > 2_147_483_647) throw new Error(`${field} is invalid`); return value; }
function counterparty(value: SaleCounterparty, field: string): SaleCounterparty { if (!value || typeof value !== 'object') {
    throw new Error(`${field} is invalid`); } exact(value, ['kind', 'id'], field);
    if (!['agent', 'business', 'npc'].includes(value.kind)) throw new Error(`${field} is invalid`);
    return { kind: value.kind, id: id(value.id, `${field}.id`) }; }
function same(left: SaleCounterparty, right: SaleCounterparty): boolean {
    return left.kind === right.kind && left.id === right.id;
}
export function saleChannelPolicyDigest(value: Omit<SaleChannelPolicyCatalog, 'digest'>): string { return hash(value); }
export function validateSaleChannelPolicyCatalog(value: unknown): SaleChannelPolicyCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sale channel policy is invalid');
    const input = value as Record<string, unknown>; exact(input, ['schemaVersion', 'channels'], 'Sale channel policy');
    if (input.schemaVersion !== 1 || !Array.isArray(input.channels) || input.channels.length !== 3) {
        throw new Error('Sale channel policy is invalid');
    }
    const channels = input.channels.map((entry, index): SaleChannelRule => { if (!entry || typeof entry !== 'object'
            || Array.isArray(entry)) throw new Error(`channels[${index}] is invalid`);
        const rule = entry as Record<string, unknown>;
        exact(rule, ['channel', 'acquirerKind', 'inspection', 'recognizedIneligible', 'provenanceDisposition'],
            `channels[${index}]`); const channel = rule.channel as SaleChannel;
        if (!['business-shop', 'npc-shop', 'player-trade'].includes(channel)
            || !['agent', 'business', 'npc'].includes(String(rule.acquirerKind))
            || !['observer-evidence', 'none'].includes(String(rule.inspection))
            || !['reject', 'pass-through'].includes(String(rule.recognizedIneligible))
            || rule.provenanceDisposition !== 'preserve') throw new Error(`channels[${index}] is invalid`);
        const required = channel === 'business-shop' ? ['business', 'observer-evidence', 'reject']
            : channel === 'npc-shop' ? ['npc', 'observer-evidence', 'reject'] : ['agent', 'none', 'pass-through'];
        if (rule.acquirerKind !== required[0] || rule.inspection !== required[1]
            || rule.recognizedIneligible !== required[2]) throw new Error(`channels[${index}] weakens channel boundary`);
        return { channel, acquirerKind: rule.acquirerKind as SaleCounterparty['kind'],
            inspection: rule.inspection as SaleChannelRule['inspection'],
            recognizedIneligible: rule.recognizedIneligible as SaleChannelRule['recognizedIneligible'],
            provenanceDisposition: 'preserve' }; });
    if (new Set(channels.map(rule => rule.channel)).size !== 3) throw new Error('Sale channel rules must be unique');
    const definition = { schemaVersion: 1 as const, channels };
    return { ...definition, digest: saleChannelPolicyDigest(definition) };
}
export function loadSaleChannelPolicyCatalog(path: string): SaleChannelPolicyCatalog {
    return validateSaleChannelPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
export function loadDefaultSaleChannelPolicyCatalog(): SaleChannelPolicyCatalog {
    return loadSaleChannelPolicyCatalog(join(import.meta.dir, '..', 'config', 'sale-channel-policies.json'));
}
export function decideSaleChannel(catalog: SaleChannelPolicyCatalog, offerInput: ItemSaleOffer,
    evidenceInput: ItemInspectionEvidence[], verify?: ItemInspectionVerifier): SaleChannelDecision {
    const { digest, ...definition } = catalog;
    if (digest !== saleChannelPolicyDigest(definition)) throw new Error('Sale channel policy digest mismatch');
    const offer = validateOffer(offerInput), rule = catalog.channels.find(value => value.channel === offer.channel);
    if (!rule || offer.acquirer.kind !== rule.acquirerKind) throw new Error('Sale offer conflicts with channel policy');
    if (!Array.isArray(evidenceInput) || evidenceInput.length > 100) throw new Error('Inspection evidence is invalid');
    if (rule.inspection === 'none' && evidenceInput.length > 0) throw new Error('Direct trade does not consume merchant inspection');
    const evidence = evidenceInput.map((value, index) => validateEvidence(value, index));
    if (new Set(evidence.map(value => value.evidenceId)).size !== evidence.length) throw new Error('Inspection evidence is duplicated');
    for (const item of evidence) { if (item.offerId !== offer.offerId || !same(item.inspector, offer.acquirer)) {
            throw new Error('Inspection evidence belongs to another observer or offer'); }
        if (!verify?.(Object.freeze(item))) throw new Error('Item inspection evidence is not trusted'); }
    const recognized = evidence.some(value => value.finding === 'recognized-ineligible');
    const base = { offer, status: recognized && rule.recognizedIneligible === 'reject' ? 'rejected' as const : 'accepted' as const,
        reason: offer.channel === 'player-trade' ? 'direct-trade' as const : recognized
            ? 'recognized-ineligible' as const : 'not-recognized' as const,
        consideredEvidenceIds: evidence.map(value => value.evidenceId).sort(), provenanceDisposition: 'preserve' as const,
        policyDigest: catalog.digest };
    return { ...base, decisionDigest: hash(base) };
}
export function assertAcceptedBusinessAcquisition(decision: SaleChannelDecision, expected: {
    offerId: string; businessId: string; itemId: number; quantity: number; policyDigest: string }): void {
    const { decisionDigest, ...base } = decision;
    if (decisionDigest !== hash(base) || decision.policyDigest !== expected.policyDigest || decision.status !== 'accepted'
        || decision.offer.channel !== 'business-shop' || decision.offer.offerId !== expected.offerId
        || decision.offer.acquirer.kind !== 'business' || decision.offer.acquirer.id !== expected.businessId
        || decision.offer.itemId !== expected.itemId || decision.offer.quantity !== expected.quantity
        || decision.provenanceDisposition !== 'preserve') throw new Error('Business acquisition is not eligible');
}
export function assertAcceptedPlayerTrade(decision: SaleChannelDecision, expected: {
    offerId:string;buyerAgentId:string;sellerAgentId:string;itemId:number;quantity:number;
    assetId:string|null;provenanceDigest:string|null;policyDigest:string }):void {
    const {decisionDigest,...base}=decision;
    if(decisionDigest!==hash(base)||decision.policyDigest!==expected.policyDigest||decision.status!=='accepted'
        ||decision.reason!=='direct-trade'||decision.offer.channel!=='player-trade'
        ||decision.offer.offerId!==expected.offerId||decision.offer.sellerAgentId!==expected.sellerAgentId
        ||decision.offer.acquirer.kind!=='agent'||decision.offer.acquirer.id!==expected.buyerAgentId
        ||decision.offer.itemId!==expected.itemId||decision.offer.quantity!==expected.quantity
        ||decision.offer.assetId!==expected.assetId||decision.offer.provenanceDigest!==expected.provenanceDigest
        ||decision.provenanceDisposition!=='preserve')throw new Error('Player trade acquisition is not eligible');
}
function validateOffer(value: ItemSaleOffer): ItemSaleOffer { if (!value || typeof value !== 'object') {
        throw new Error('Sale offer is invalid'); }
    exact(value, ['offerId', 'channel', 'sellerAgentId', 'acquirer', 'itemId', 'quantity', 'assetId', 'provenanceDigest'],
        'Sale offer'); if (!['business-shop', 'npc-shop', 'player-trade'].includes(value.channel)) {
        throw new Error('Sale offer is invalid'); }
    const assetId = value.assetId === null ? null : id(value.assetId, 'assetId');
    const provenanceDigest = value.provenanceDigest;
    if ((assetId === null) !== (provenanceDigest === null) || provenanceDigest !== null && !DIGEST.test(provenanceDigest)) {
        throw new Error('Sale offer provenance is invalid');
    }
    return { offerId: id(value.offerId, 'offerId'), channel: value.channel,
        sellerAgentId: id(value.sellerAgentId, 'sellerAgentId'), acquirer: counterparty(value.acquirer, 'acquirer'),
        itemId: integer(value.itemId, 'itemId', 0), quantity: integer(value.quantity, 'quantity'), assetId, provenanceDigest };
}
function validateEvidence(value: ItemInspectionEvidence, index: number): ItemInspectionEvidence {
    const field = `evidence[${index}]`; if (!value || typeof value !== 'object') throw new Error(`${field} is invalid`);
    exact(value, ['evidenceId', 'offerId', 'inspector', 'method', 'finding', 'sourceRecordId', 'sourceEvidenceDigest',
        'occurredAt'], field); if (!['reported-identifier', 'physical-mark', 'document-check', 'local-provenance-record']
        .includes(value.method) || !['recognized-ineligible', 'no-match', 'inconclusive'].includes(value.finding)
        || !DIGEST.test(value.sourceEvidenceDigest) || Number.isNaN(Date.parse(value.occurredAt))
        || new Date(value.occurredAt).toISOString() !== value.occurredAt) throw new Error(`${field} is invalid`);
    return { evidenceId: id(value.evidenceId, `${field}.evidenceId`), offerId: id(value.offerId, `${field}.offerId`),
        inspector: counterparty(value.inspector, `${field}.inspector`), method: value.method, finding: value.finding,
        sourceRecordId: id(value.sourceRecordId, `${field}.sourceRecordId`),
        sourceEvidenceDigest: value.sourceEvidenceDigest, occurredAt: value.occurredAt };
}
