import { expect, test } from 'bun:test';

import { fineLedgerIds, inspectFineLedger, type FineLedgerStatus } from '../fine-ledger-reconciliation.js';

type Sources = Parameters<typeof inspectFineLedger>[1];
type Intent = NonNullable<ReturnType<Sources['intents']['get']>>;
type Escrow = NonNullable<ReturnType<Sources['escrow']['get']>>;
type Credit = ReturnType<Sources['treasury']['listExternalCredits']>[number];
const COLLECTION = `fine-collection:${'a'.repeat(64)}`;
const TIME = '2030-01-01T00:00:00.000Z';

function fixture() {
    const ids = fineLedgerIds(COLLECTION);
    const intent: Intent = {
        collectionId: COLLECTION, decisionId: 'decision-1', decisionDigest: 'c'.repeat(64),
        amountGp: 25, payerUsername: 'avatar', creditorFactionId: 'town',
        treasuryActorId: 'town_treasury', intentDigest: 'd'.repeat(64), recordedAt: TIME,
    };
    const escrow: Escrow = {
        escrowId: ids.escrowId, username: 'avatar', assets: { gp: 25, items: [] },
        payeeUsername: null, status: 'committed', committedAt: TIME, error: null,
    };
    const credit: Credit = {
        settlementId: ids.settlementId, kind: 'faction', actorId: 'town_treasury',
        amountGp: 25, sourceRef: COLLECTION, createdAt: TIME,
    };
    const state = { intent: intent as Intent | null, escrow: escrow as Escrow | null,
        credits: [credit] as Credit[] };
    const calls = { intent: 0, escrow: 0, treasury: 0, intentAudit: 0, escrowAudit: 0 };
    const sources: Sources = {
        intents: {
            verifyAuditChain: () => { calls.intentAudit++; return true; },
            get: () => { calls.intent++; return state.intent; },
        },
        escrow: {
            verifySharedAuditChain: () => { calls.escrowAudit++; return true; },
            get: () => { calls.escrow++; return state.escrow; },
        },
        treasury: { listExternalCredits: () => { calls.treasury++; return state.credits; } },
    };
    return { sources, state, calls, intent, escrow, credit };
}

function check(sources: Sources, status: FineLedgerStatus, reasons: string[] = []) {
    const result = inspectFineLedger(COLLECTION, sources);
    expect(result).toEqual({ collectionId: COLLECTION, ...fineLedgerIds(COLLECTION), status,
        reasons, canCollect: false, canMarkPaid: false });
    return result;
}

test('audit-valid intent update between reads invalidates the diagnosis', () => {
    const f = fixture();
    f.sources.intents.get = () => ++f.calls.intent === 1 ? f.intent : { ...f.intent, amountGp: 26 };
    check(f.sources, 'unverifiable', ['intent-evidence-changed-during-inspection']);
});

test('audit-valid intent deletion between reads invalidates the diagnosis', () => {
    const f = fixture();
    f.sources.intents.get = () => ++f.calls.intent === 1 ? f.intent : null;
    check(f.sources, 'unverifiable', ['intent-evidence-changed-during-inspection']);
});

test('audit-valid escrow status update between reads invalidates the diagnosis', () => {
    const f = fixture();
    f.sources.escrow.get = () => ++f.calls.escrow === 1 ? f.escrow : { ...f.escrow, status: 'released' };
    check(f.sources, 'unverifiable', ['escrow-evidence-changed-during-inspection']);
});

test('absent escrow becoming a newly held escrow is source drift, not no-movement', () => {
    const f = fixture();
    f.state.credits = [];
    f.sources.escrow.get = () => ++f.calls.escrow === 1 ? null : { ...f.escrow, status: 'held', committedAt: null };
    check(f.sources, 'unverifiable', ['escrow-evidence-changed-during-inspection']);
});

test('escrow deletion between reads invalidates the diagnosis', () => {
    const f = fixture();
    f.sources.escrow.get = () => ++f.calls.escrow === 1 ? f.escrow : null;
    check(f.sources, 'unverifiable', ['escrow-evidence-changed-during-inspection']);
});

const treasuryChanges: Array<[string, (credit: Credit) => Credit[]]> = [
    ['amount update', credit => [{ ...credit, amountGp: 26 }]],
    ['deletion', () => []],
    ['duplicate', credit => [credit, { ...credit }]],
    ['new orphan source reference', credit => [credit, { ...credit, settlementId: 'other-settlement' }]],
];
test.each(treasuryChanges)('audit-valid treasury %s between reads invalidates the diagnosis', (_name, change) => {
    const f = fixture();
    f.sources.treasury.listExternalCredits = () => ++f.calls.treasury === 1 ? [f.credit] : change(f.credit);
    check(f.sources, 'unverifiable', ['treasury-evidence-changed-during-inspection']);
});

test('new matching treasury receipt after an initially empty read is source drift', () => {
    const f = fixture();
    f.sources.treasury.listExternalCredits = () => ++f.calls.treasury === 1 ? [] : [f.credit];
    check(f.sources, 'unverifiable', ['treasury-evidence-changed-during-inspection']);
});

test('unrelated treasury changes and reordered related rows do not invalidate a stable diagnosis', () => {
    const f = fixture();
    const orphan = { ...f.credit, settlementId: 'other-settlement' };
    const unrelated = { ...f.credit, settlementId: 'unrelated-settlement', sourceRef: 'unrelated-collection' };
    f.sources.treasury.listExternalCredits = () => ++f.calls.treasury === 1
        ? [f.credit, orphan, unrelated]
        : [{ ...unrelated, amountGp: 999 }, orphan, f.credit, { ...unrelated, settlementId: 'new-unrelated' }];
    check(f.sources, 'conflict', ['duplicate-or-orphan-source-ref', 'unexpected-settlement-id-or-source-ref']);
});

test('unrelated treasury additions alone leave a matching receipt diagnosis unchanged', () => {
    const f = fixture();
    f.sources.treasury.listExternalCredits = () => ++f.calls.treasury === 1 ? [f.credit]
        : [f.credit, { ...f.credit, settlementId: 'unrelated', sourceRef: 'unrelated' }];
    check(f.sources, 'matching-receipt-shape');
});

test('mutable intent alias changed by a later escrow read cannot rewrite the initial snapshot', () => {
    const f = fixture();
    f.sources.escrow.get = () => { f.intent.amountGp = 26; return f.escrow; };
    check(f.sources, 'unverifiable', ['intent-evidence-changed-during-inspection']);
});

test('mutable nested escrow alias changed by a later treasury read cannot rewrite the initial snapshot', () => {
    const f = fixture();
    f.sources.treasury.listExternalCredits = () => { f.escrow.assets.items.push({ id: 1, count: 1 }); return [f.credit]; };
    check(f.sources, 'unverifiable', ['escrow-evidence-changed-during-inspection']);
});

test('mutable treasury row alias changed by a later audit check cannot rewrite the initial snapshot', () => {
    const f = fixture();
    f.sources.intents.verifyAuditChain = () => {
        if (++f.calls.intentAudit === 2) f.credit.createdAt = '2030-01-02T00:00:00.000Z';
        return true;
    };
    check(f.sources, 'unverifiable', ['treasury-evidence-changed-during-inspection']);
});

test.each(['intent', 'escrow', 'treasury'] as const)('%s recheck exception fails closed', source => {
    const f = fixture();
    if (source === 'intent') f.sources.intents.get = () => {
        if (++f.calls.intent === 2) throw new Error('intent unavailable');
        return f.intent;
    };
    if (source === 'escrow') f.sources.escrow.get = () => {
        if (++f.calls.escrow === 2) throw new Error('escrow unavailable');
        return f.escrow;
    };
    if (source === 'treasury') f.sources.treasury.listExternalCredits = () => {
        if (++f.calls.treasury === 2) throw new Error('treasury audit invalid');
        return [f.credit];
    };
    check(f.sources, 'unverifiable', ['source-evidence-recheck-unavailable']);
});

test.each(['intent', 'escrow'] as const)('%s audit becoming invalid after evidence recheck fails closed', source => {
    const f = fixture();
    if (source === 'intent') f.sources.intents.verifyAuditChain = () => ++f.calls.intentAudit < 3;
    else f.sources.escrow.verifySharedAuditChain = () => ++f.calls.escrowAudit < 3;
    check(f.sources, 'unverifiable', ['source-audit-changed-during-inspection']);
});

test.each(['intent', 'escrow'] as const)('%s audit throwing after evidence recheck fails closed', source => {
    const f = fixture();
    const audit = () => {
        const call = source === 'intent' ? ++f.calls.intentAudit : ++f.calls.escrowAudit;
        if (call === 3) throw new Error('audit unavailable');
        return true;
    };
    if (source === 'intent') f.sources.intents.verifyAuditChain = audit;
    else f.sources.escrow.verifySharedAuditChain = audit;
    check(f.sources, 'unverifiable', ['source-evidence-recheck-unavailable']);
});

const stableStatuses: Array<[FineLedgerStatus, string | null, boolean]> = [
    ['no-movement', null, false], ['held', 'held', false], ['released', 'released', false],
    ['debit-only', 'committed', false], ['matching-receipt-shape', 'committed', true],
];
test.each(stableStatuses)('stable %s sources retain their diagnosis without payment authority', (status, escrowStatus, credited) => {
    const f = fixture();
    f.state.escrow = escrowStatus === null ? null : { ...f.escrow, status: escrowStatus,
        committedAt: escrowStatus === 'committed' ? TIME : null };
    f.state.credits = credited ? [f.credit] : [];
    check(f.sources, status);
    expect(f.calls).toEqual({ intent: 2, escrow: 2, treasury: 2, intentAudit: 3, escrowAudit: 3 });
});
