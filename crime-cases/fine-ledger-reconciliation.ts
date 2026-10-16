import { createHash } from 'node:crypto';

import type { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import type { FineCollectionIntentStore, RecordedFineCollectionIntent } from './fine-collection-intent-store.js';

interface EscrowEvidence {
    escrowId: string;
    username: string;
    assets: { gp: number; items: Array<{ id: number; count: number }> };
    payeeUsername: string | null;
    status: string;
    committedAt: string | null;
    error: string | null;
}
interface SharedEscrowReader {
    verifySharedAuditChain(): boolean;
    get(escrowId: string): EscrowEvidence | null;
}

export type FineLedgerStatus = 'unverifiable' | 'conflict' | 'no-movement' | 'held'
    | 'released' | 'debit-only' | 'matching-receipt-shape';
export interface FineLedgerReconciliation {
    collectionId: string;
    escrowId: string;
    settlementId: string;
    status: FineLedgerStatus;
    reasons: string[];
    /** Diagnosis is never debtor consent, settlement authority, or proof of payment. */
    canCollect: false;
    canMarkPaid: false;
}

/** Versioned, domain-separated convention for future settlement identifiers, not proof of execution. */
export function fineLedgerIds(collectionId: string): { escrowId: string; settlementId: string } {
    const uuid = (domain: string) => {
        const hex = createHash('sha256').update(`fine-ledger/v1/${domain}\0${collectionId}`).digest('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    return { escrowId: uuid('player-escrow'), settlementId: uuid('treasury-credit') };
}

function canonicalIntent(intent: RecordedFineCollectionIntent, collectionId: string): boolean {
    return intent.collectionId === collectionId
        && /^fine-collection:[0-9a-f]{64}$/.test(collectionId)
        && /^[a-z0-9]{1,12}$/.test(intent.payerUsername)
        && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(intent.treasuryActorId)
        && Number.isSafeInteger(intent.amountGp) && intent.amountGp > 0 && intent.amountGp <= 2_147_483_647;
}

function intentSnapshot(value: RecordedFineCollectionIntent | null): string {
    return JSON.stringify(value === null ? null : [value.collectionId, value.decisionId,
        value.decisionDigest, value.amountGp, value.payerUsername, value.creditorFactionId,
        value.treasuryActorId, value.intentDigest, value.recordedAt]);
}
function escrowSnapshot(value: EscrowEvidence | null): string {
    return JSON.stringify(value === null ? null : [value.escrowId, value.username,
        value.assets.gp, value.assets.items.map(item => [item.id, item.count]),
        value.payeeUsername, value.status, value.committedAt, value.error]);
}
function creditSnapshot(rows: ReturnType<InstitutionTreasuryStore['listExternalCredits']>,
    collectionId: string, settlementId: string): string {
    // Ordering and unrelated credits are not part of this collection's evidence.
    return JSON.stringify(rows.filter(row => row.settlementId === settlementId || row.sourceRef === collectionId)
        .map(row => JSON.stringify([row.settlementId, row.kind, row.actorId, row.amountGp, row.sourceRef, row.createdAt])).sort());
}

/** Cross-database read only; each source verifies its own audit, but there is no atomic joint snapshot. */
export function inspectFineLedger(collectionId: string, sources: {
    intents: Pick<FineCollectionIntentStore, 'verifyAuditChain' | 'get'>;
    escrow: SharedEscrowReader;
    treasury: Pick<InstitutionTreasuryStore, 'listExternalCredits'>;
}): FineLedgerReconciliation {
    const { escrowId, settlementId } = fineLedgerIds(collectionId);
    const result = (status: FineLedgerStatus, reasons: string[]): FineLedgerReconciliation =>
        ({ collectionId, escrowId, settlementId, status, reasons, canCollect: false, canMarkPaid: false });
    let intent: RecordedFineCollectionIntent | null;
    let initialIntent: string;
    try {
        if (!sources.intents.verifyAuditChain()) return result('unverifiable', ['intent-source-audit-invalid']);
        intent = structuredClone(sources.intents.get(collectionId));
        initialIntent = intentSnapshot(intent);
    } catch { return result('unverifiable', ['intent-source-audit-unavailable']); }
    if (!intent || !canonicalIntent(intent, collectionId))
        return result('unverifiable', ['intent-missing-or-invalid']);
    let escrow: ReturnType<typeof sources.escrow.get>;
    let initialEscrow: string;
    try {
        if (!sources.escrow.verifySharedAuditChain()) return result('unverifiable', ['shared-escrow-audit-invalid']);
        escrow = structuredClone(sources.escrow.get(escrowId));
        initialEscrow = escrowSnapshot(escrow);
    } catch { return result('unverifiable', ['shared-escrow-audit-unavailable']); }
    let allCredits: ReturnType<typeof sources.treasury.listExternalCredits>;
    let initialCredits: string;
    try {
        // This method verifies the complete external-credit cohort, not a bounded page.
        allCredits = structuredClone(sources.treasury.listExternalCredits());
        initialCredits = creditSnapshot(allCredits, collectionId, settlementId);
    } catch { return result('unverifiable', ['treasury-audit-unavailable']); }
    try {
        if (!sources.intents.verifyAuditChain()) return result('unverifiable', ['intent-source-audit-changed']);
        if (!sources.escrow.verifySharedAuditChain()) return result('unverifiable', ['shared-escrow-audit-changed']);
    } catch { return result('unverifiable', ['source-audit-changed-or-unavailable']); }
    try {
        // Capture serialized values immediately: adapters may return mutable objects.
        if (intentSnapshot(sources.intents.get(collectionId)) !== initialIntent)
            return result('unverifiable', ['intent-evidence-changed-during-inspection']);
        if (escrowSnapshot(sources.escrow.get(escrowId)) !== initialEscrow)
            return result('unverifiable', ['escrow-evidence-changed-during-inspection']);
        if (creditSnapshot(sources.treasury.listExternalCredits(), collectionId, settlementId) !== initialCredits)
            return result('unverifiable', ['treasury-evidence-changed-during-inspection']);
        if (!sources.intents.verifyAuditChain() || !sources.escrow.verifySharedAuditChain())
            return result('unverifiable', ['source-audit-changed-during-inspection']);
    } catch { return result('unverifiable', ['source-evidence-recheck-unavailable']); }
    try {
        const related = allCredits.filter(row => row.settlementId === settlementId
            || row.sourceRef === collectionId);
        const reasons: string[] = [];
        if (related.length > 1) reasons.push('duplicate-or-orphan-source-ref');
        const credit = related.find(row => row.settlementId === settlementId);
        if (related.some(row => row.settlementId !== settlementId || row.sourceRef !== collectionId))
            reasons.push('unexpected-settlement-id-or-source-ref');
        if (credit && (credit.kind !== 'faction' || credit.actorId !== intent.treasuryActorId
            || credit.amountGp !== intent.amountGp)) reasons.push('treasury-credit-mismatch');
        if (escrow && (escrow.escrowId !== escrowId || escrow.username !== intent.payerUsername
            || escrow.assets.gp !== intent.amountGp || escrow.assets.items.length !== 0
            || escrow.payeeUsername !== null)) reasons.push('escrow-payer-assets-or-payee-mismatch');
        if (escrow?.error !== null && escrow?.error !== undefined) reasons.push('escrow-error-requires-manual-review');
        if (escrow && !['held', 'released', 'committed'].includes(escrow.status))
            reasons.push('escrow-status-requires-manual-review');
        if (escrow?.status === 'committed' && !escrow.committedAt)
            reasons.push('escrow-consume-timestamp-missing');
        if (credit && escrow?.status !== 'committed') reasons.push('treasury-credit-without-consumed-escrow');
        if (reasons.length) return result('conflict', reasons);
        if (!escrow) return result('no-movement', []);
        if (escrow.status === 'held') return result('held', []);
        if (escrow.status === 'released') return result('released', []);
        return result(credit ? 'matching-receipt-shape' : 'debit-only', []);
    } catch { return result('unverifiable', ['ledger-shape-unavailable']); }
}
