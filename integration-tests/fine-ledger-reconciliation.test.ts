import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketStore } from '../server/engine/src/engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from '../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import { inspectFineCollection } from '../crime-cases/fine-collection-preflight.js';
import { FineCollectionIntentStore } from '../crime-cases/fine-collection-intent-store.js';
import { fineLedgerIds, inspectFineLedger } from '../crime-cases/fine-ledger-reconciliation.js';
import { FineLedgerReconciliationStore } from '../crime-cases/fine-ledger-reconciliation-store.js';

type Sources = Parameters<typeof inspectFineCollection>[1];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'fine-ledger-reconcile-')); roots.push(root);
    const intentPath = join(root, 'intent.sqlite'), treasuryPath = join(root, 'treasury.sqlite');
    const sources = {
        decisions: { get: () => ({ decisionId: 'decision-1', decisionDigest: 'a'.repeat(64),
            disposition: 'approved', amountGp: 25, jurisdictionId: 'town-law',
            proposalId: 'proposal-1', suspectAgentId: 'suspect-1' }) },
        proposals: { get: () => ({ findingId: 'finding-1' }) },
        evidence: { getFinding: () => ({ caseId: 'case-1' }) },
        cases: { getState: () => ({ outcomeReceiptId: 'outcome-1' }) },
        thieving: { getOutcome: () => ({ playerUsername: 'avatar', actorAgentId: 'suspect-1' }) },
        agents: { getIdentity: () => ({ playerUsername: 'avatar' }),
            getControlProfile: () => ({ role: 'player', subjectKind: 'player',
                avatarPlayerUsername: 'avatar', subjectId: 'avatar' }) },
        governance: { getJurisdiction: () => ({ factionId: 'town' }),
            getFaction: () => ({ factionId: 'town', status: 'active', treasuryActorId: 'town_treasury' }) },
    } as unknown as Sources;
    const intents = new FineCollectionIntentStore(intentPath, sources);
    const intent = intents.record('decision-1');
    const market = new MarketStore(join(root, 'market.sqlite'));
    const escrow = new PlayerInventoryEscrowStore(market);
    const treasury = new InstitutionTreasuryStore(treasuryPath);
    const scope = { intents, escrow, treasury };
    const ids = fineLedgerIds(intent.collectionId);
    let coins = 100;
    const wallet = { count: () => coins,
        remove: (_id: number, count: number) => { coins -= count; return count; },
        add: (_id: number, count: number) => { coins += count; return count; } };
    const account = { owner: 'avatar', save: () => new Uint8Array([coins]),
        rollback: () => { coins = 100; } };
    const hold = () => escrow.mutateWithCheckpoint({ operation: 'hold', escrowId: ids.escrowId,
        username: 'avatar', assets: { gp: 25, items: [] } }, wallet, account);
    const credit = (settlementId = ids.settlementId, sourceRef = intent.collectionId,
        amountGp = 25) => treasury.creditExternalSettlement({ settlementId, sourceRef,
        kind: 'faction', actorId: 'town_treasury', amountGp, status: 'committed',
        occurredAt: new Date().toISOString() }, () => true);
    return { intentPath, treasuryPath, intent, ids, scope, market, hold, credit, wallet, account,
        close: () => { intents.close(); escrow.close(); treasury.close(); market.db.close(true); } };
}

test('deterministic independent IDs and no movement remain strictly diagnostic', () => {
    const s = setup();
    expect(fineLedgerIds(s.intent.collectionId)).toEqual(s.ids);
    expect(fineLedgerIds(`fine-collection:${'a'.repeat(64)}`)).toEqual({
        escrowId: '31a46042-aab8-51d7-842b-1b7946d86bb7',
        settlementId: 'b77111a8-e530-59f7-8542-183f5e5a3375' });
    expect(s.ids.escrowId).not.toBe(s.ids.settlementId);
    expect(inspectFineLedger(s.intent.collectionId, s.scope)).toMatchObject({
        status: 'no-movement', canCollect: false, canMarkPaid: false });
    s.close();
});

test('diagnostic journal preserves observations while real ledgers advance without authorizing payment', () => {
    const s = setup();
    const path = join(s.intentPath, '..', 'reconciliation.sqlite');
    const journal = new FineLedgerReconciliationStore(path, s.scope);
    try {
        const first = journal.record('observation-before', s.intent.collectionId);
        expect(first).toMatchObject({ status: 'no-movement', canCollect: false, canMarkPaid: false });
        s.hold();
        s.scope.escrow.mutateWithCheckpoint({ operation: 'consume', escrowId: s.ids.escrowId,
            username: 'avatar' }, s.wallet, s.account);
        s.credit();
        expect(journal.record('observation-before', s.intent.collectionId)).toEqual(first);
        expect(journal.record('observation-after', s.intent.collectionId)).toMatchObject({
            status: 'matching-receipt-shape', canCollect: false, canMarkPaid: false });
        expect(journal.verifyAuditChain()).toBeTrue();
        expect(journal.list(s.intent.collectionId)).toHaveLength(2);
    } finally { journal.close(); s.close(); }
    const historical = new FineLedgerReconciliationStore(path, s.scope);
    try {
        // Historical reads must not consult the now-closed live source stores.
        expect(historical.get('observation-before')?.status).toBe('no-movement');
        expect(historical.get('observation-after')?.status).toBe('matching-receipt-shape');
    } finally { historical.close(); }
});

test('held, released and consumed-without-credit are distinguishable', () => {
    const s = setup(); s.hold();
    expect(inspectFineLedger(s.intent.collectionId, s.scope).status).toBe('held');
    s.scope.escrow.mutateWithCheckpoint({ operation: 'release', escrowId: s.ids.escrowId,
        username: 'avatar' }, s.wallet, s.account);
    expect(inspectFineLedger(s.intent.collectionId, s.scope).status).toBe('released');
    s.close();

    const t = setup(); t.hold();
    t.scope.escrow.mutateWithCheckpoint({ operation: 'consume', escrowId: t.ids.escrowId,
        username: 'avatar' }, t.wallet, t.account);
    expect(inspectFineLedger(t.intent.collectionId, t.scope)).toMatchObject({
        status: 'debit-only', canMarkPaid: false });
    t.credit();
    expect(inspectFineLedger(t.intent.collectionId, t.scope)).toMatchObject({
        status: 'matching-receipt-shape', canCollect: false, canMarkPaid: false });
    t.close();
});

test('valid escrow changes between ledger reads are not diagnosed from mixed-time evidence', () => {
    const s = setup(); s.hold();
    let changed = false;
    const scope = { ...s.scope, treasury: { listExternalCredits: () => {
        const credits = s.scope.treasury.listExternalCredits();
        if (!changed) {
            changed = true;
            s.scope.escrow.mutateWithCheckpoint({ operation: 'release', escrowId: s.ids.escrowId,
                username: 'avatar' }, s.wallet, s.account);
        }
        return credits;
    } } };
    try {
        expect(inspectFineLedger(s.intent.collectionId, scope)).toMatchObject({
            status: 'unverifiable', reasons: ['escrow-evidence-changed-during-inspection'],
            canCollect: false, canMarkPaid: false });
        expect(s.scope.escrow.verifySharedAuditChain()).toBeTrue();
        expect(inspectFineLedger(s.intent.collectionId, s.scope).status).toBe('released');
    } finally { s.close(); }
});

test('valid treasury writes between reads are detected and the instability is journaled', () => {
    const s = setup(); s.hold();
    s.scope.escrow.mutateWithCheckpoint({ operation: 'consume', escrowId: s.ids.escrowId,
        username: 'avatar' }, s.wallet, s.account);
    let changed = false;
    const scope = { ...s.scope, treasury: { listExternalCredits: () => {
        const credits = s.scope.treasury.listExternalCredits();
        if (!changed) { changed = true; s.credit(); }
        return credits;
    } } };
    const journal = new FineLedgerReconciliationStore(join(s.intentPath, '..', 'unstable.sqlite'), scope);
    try {
        const first = journal.record('unstable-observation', s.intent.collectionId);
        expect(first).toMatchObject({ status: 'unverifiable',
            reasons: ['treasury-evidence-changed-during-inspection'], canCollect: false, canMarkPaid: false });
        expect(journal.record('unstable-observation', s.intent.collectionId)).toEqual(first);
        expect(journal.record('stable-observation', s.intent.collectionId).status).toBe('matching-receipt-shape');
        expect(journal.verifyAuditChain()).toBeTrue();
    } finally { journal.close(); s.close(); }
});

test('one-sided credit, duplicate source reference, mismatched amount and non-GP escrow conflict', () => {
    const s = setup(); s.credit();
    expect(inspectFineLedger(s.intent.collectionId, s.scope).status).toBe('conflict');
    s.credit('11111111-1111-4111-8111-111111111111');
    expect(inspectFineLedger(s.intent.collectionId, s.scope).reasons)
        .toContain('duplicate-or-orphan-source-ref');
    s.close();

    const t = setup(); t.hold(); t.scope.escrow.mutateWithCheckpoint({ operation: 'consume',
        escrowId: t.ids.escrowId, username: 'avatar' }, t.wallet, t.account);
    t.credit(t.ids.settlementId, t.intent.collectionId, 26);
    expect(inspectFineLedger(t.intent.collectionId, t.scope).reasons).toContain('treasury-credit-mismatch');
    t.close();

    const u = setup();
    const balances = new Map([[995, 100], [1, 1]]);
    u.scope.escrow.mutateWithCheckpoint({ operation: 'hold', escrowId: u.ids.escrowId,
        username: 'avatar', assets: { gp: 25, items: [{ id: 1, count: 1 }] } },
    { count: id => balances.get(id) ?? 0,
        remove: (id, count) => { balances.set(id, (balances.get(id) ?? 0) - count); return count; },
        add: (id, count) => { balances.set(id, (balances.get(id) ?? 0) + count); return count; } },
    { owner: 'avatar', save: () => new Uint8Array([1]), rollback: () => {} });
    expect(inspectFineLedger(u.intent.collectionId, u.scope).reasons)
        .toContain('escrow-payer-assets-or-payee-mismatch');
    u.close();
});

test('source and ledger tampering, and legacy non-shared escrow fail closed', () => {
    const s = setup();
    const raw = new Database(s.intentPath);
    raw.run("UPDATE fine_collection_intent_audit SET entry_hash='bad' WHERE sequence=1");
    expect(inspectFineLedger(s.intent.collectionId, s.scope).status).toBe('unverifiable');
    raw.close(true); s.close();

    const t = setup(); t.hold();
    const rawMarket = t.market.db;
    rawMarket.run('UPDATE player_inventory_escrow SET error=?1 WHERE escrow_id=?2',
        ['tampered', t.ids.escrowId]);
    expect(inspectFineLedger(t.intent.collectionId, t.scope).status).toBe('unverifiable');
    t.close();

    const u = setup();
    const legacy = new PlayerInventoryEscrowStore(join(roots.at(-1)!, 'legacy.sqlite'));
    expect(inspectFineLedger(u.intent.collectionId, { ...u.scope, escrow: legacy }).status).toBe('unverifiable');
    legacy.close(); u.close();
});

test('an existing unaudited treasury receipt is explicitly unverifiable', () => {
    const s = setup();
    s.scope.treasury.ensure('faction', 'town_treasury');
    const raw = new Database(s.treasuryPath);
    raw.run(`INSERT INTO institution_treasury_external_credit
        (settlement_id, actor_kind, actor_id, amount_gp, source_ref, created_at)
        VALUES (?1, 'faction', 'town_treasury', 25, ?2, ?3)`,
    [s.ids.settlementId, s.intent.collectionId, new Date().toISOString()]);
    expect(inspectFineLedger(s.intent.collectionId, s.scope)).toMatchObject({
        status: 'unverifiable', reasons: ['treasury-audit-unavailable'],
        canCollect: false, canMarkPaid: false });
    raw.close(true); s.close();
});
