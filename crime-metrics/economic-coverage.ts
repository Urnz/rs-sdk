import type { ItemProvenanceStore } from '../item-provenance/store.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;

export interface CrimeEconomicCoverage {
    /** Both lists are caller-selected, not a census of either ledger. */
    scope: 'selected-thieving-and-provenance-receipts';
    actorAgentId: string;
    sourceReceiptIds: string[];
    selectedTheftEventIds: string[];
    receipts: Array<{ receiptId: string; transferredItemCount: number;
        linkedTheftEventIds: string[]; unlinkedTransferredItems: Array<{ itemId: number; quantity: number }> }>;
    unavailable: {
        income: 'economy-events-lack-theft-receipt-or-asset-link-and-read-audit-verifier';
        harm: 'no-verified-victim-loss-or-valuation-source';
    };
}

function selectedIds(value: readonly string[], field: string, allowEmpty: boolean): string[] {
    if (!Array.isArray(value) || value.length > 1_000 || (!allowEmpty && value.length === 0)
        || value.some(id => typeof id !== 'string' || !ID.test(id))) throw new Error(`${field} is invalid`);
    if (new Set(value).size !== value.length) throw new Error(`${field} contains duplicates`);
    return [...value];
}

/**
 * Read-only evidence coverage, not a sale, income, valuation or victim-loss metric.
 * The caller must authorize access to these hidden receipts. Omitted event IDs cannot
 * be interpreted as absent provenance: this API has no whole-ledger enumeration.
 */
export function inspectCrimeEconomicCoverage(
    thieving: Pick<ThievingProcedureStore, 'verifyAuditChain' | 'getOutcome'>,
    provenance: Pick<ItemProvenanceStore, 'verifyAuditChain' | 'getEvent'>,
    actorAgentId: string, receiptIdsInput: readonly string[], theftEventIdsInput: readonly string[]
): CrimeEconomicCoverage {
    if (typeof actorAgentId !== 'string' || !ID.test(actorAgentId)) throw new Error('actorAgentId is invalid');
    const receiptIds = selectedIds(receiptIdsInput, 'Receipt cohort', false);
    const theftEventIds = selectedIds(theftEventIdsInput, 'Theft event cohort', true);
    if (!thieving.verifyAuditChain() || !provenance.verifyAuditChain())
        throw new Error('Crime economic source audit chain is invalid');

    const receipts = new Map(receiptIds.map(receiptId => {
        const receipt = thieving.getOutcome(receiptId);
        if (!receipt) throw new Error(`Thieving receipt ${receiptId} does not exist`);
        if (receipt.actorAgentId !== actorAgentId) throw new Error('Receipt cohort contains another actor');
        return [receiptId, receipt] as const;
    }));
    const linked = new Map(receiptIds.map(id => [id, new Set<number>()] as const));
    const eventIds = new Map(receiptIds.map(id => [id, [] as string[]] as const));
    for (const eventId of theftEventIds) {
        const event = provenance.getEvent(eventId);
        if (!event) throw new Error(`Provenance theft event ${eventId} does not exist`);
        const receipt = receipts.get(event.sourceRecordId);
        if (!receipt || event.kind !== 'stolen' || event.sourceDomain !== 'thieving-procedures'
            || event.sourceEvidenceDigest !== receipt.receiptDigest
            || event.holderAfter.kind !== 'agent' || event.holderAfter.id !== actorAgentId
            || receipt.result !== 'succeeded' || receipt.effect !== 'item-transfer')
            throw new Error('Provenance theft event does not match selected Thieving receipt');
        const indexes = receipt.transferredItems.flatMap((item, index) => item.itemId === event.itemId
            && item.quantity === event.quantity ? [index] : []);
        if (indexes.length !== 1 || linked.get(receipt.receiptId)!.has(indexes[0]!))
            throw new Error('Provenance theft event has ambiguous or duplicate item linkage');
        linked.get(receipt.receiptId)!.add(indexes[0]!);
        eventIds.get(receipt.receiptId)!.push(eventId);
    }
    return { scope: 'selected-thieving-and-provenance-receipts', actorAgentId,
        sourceReceiptIds: receiptIds, selectedTheftEventIds: theftEventIds,
        receipts: receiptIds.map(receiptId => { const receipt = receipts.get(receiptId)!;
            return { receiptId, transferredItemCount: receipt.transferredItems.length,
                linkedTheftEventIds: eventIds.get(receiptId)!,
                unlinkedTransferredItems: receipt.transferredItems.flatMap((item, index) =>
                    linked.get(receiptId)!.has(index) ? [] : [{ itemId: item.itemId, quantity: item.quantity }]) }; }),
        unavailable: { income: 'economy-events-lack-theft-receipt-or-asset-link-and-read-audit-verifier',
            harm: 'no-verified-victim-loss-or-valuation-source' } };
}
