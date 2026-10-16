import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FineLedgerReconciliationStore } from '../fine-ledger-reconciliation-store.js';
import { fineLedgerIds, inspectFineLedger, type FineLedgerStatus } from '../fine-ledger-reconciliation.js';

type Sources = Parameters<typeof inspectFineLedger>[1];
const COLLECTION = `fine-collection:${'a'.repeat(64)}`;
const OTHER_COLLECTION = `fine-collection:${'b'.repeat(64)}`;
const TIME = '2030-01-01T00:00:00.000Z';
const roots: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
    for (const close of closers.splice(0)) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function path() {
    const root = mkdtempSync(join(tmpdir(), 'fine-observation-'));
    roots.push(root);
    return join(root, 'diagnostic.sqlite');
}

function fixture() {
    const ids = fineLedgerIds(COLLECTION);
    const state = { validAudit: true, escrowStatus: null as string | null, credited: false, reads: 0 };
    const intent: NonNullable<ReturnType<Sources['intents']['get']>> = {
        collectionId: COLLECTION, decisionId: 'decision-1', decisionDigest: 'c'.repeat(64),
        amountGp: 25, payerUsername: 'avatar', creditorFactionId: 'town',
        treasuryActorId: 'town_treasury', intentDigest: 'd'.repeat(64), recordedAt: TIME,
    };
    const escrow: NonNullable<ReturnType<Sources['escrow']['get']>> = {
        escrowId: ids.escrowId, username: 'avatar', assets: { gp: 25, items: [] },
        payeeUsername: null, status: 'held', committedAt: null, error: null,
    };
    const credit: ReturnType<Sources['treasury']['listExternalCredits']>[number] = {
        settlementId: ids.settlementId, kind: 'faction', actorId: 'town_treasury',
        amountGp: 25, sourceRef: COLLECTION, createdAt: TIME,
    };
    const sources: Sources = {
        intents: {
            verifyAuditChain: () => { state.reads++; return state.validAudit; },
            get: id => { state.reads++; return id === COLLECTION ? intent : null; },
        },
        escrow: {
            verifySharedAuditChain: () => { state.reads++; return true; },
            get: id => {
                state.reads++;
                return state.escrowStatus !== null && id === ids.escrowId
                    ? { ...escrow, status: state.escrowStatus,
                        committedAt: state.escrowStatus === 'committed' ? TIME : null } : null;
            },
        },
        treasury: { listExternalCredits: () => { state.reads++; return state.credited ? [credit] : []; } },
    };
    return { state, sources, intent, escrow, credit };
}

function open(databasePath: string, sources: Sources) {
    const store = new FineLedgerReconciliationStore(databasePath, sources);
    let closed = false;
    const close = () => { if (!closed) { store.close(); closed = true; } };
    closers.push(close);
    return { store, close };
}

test('separate SQLite v1 journal persists a historical diagnosis across source changes and restart', () => {
    const f = fixture(), databasePath = path();
    const first = open(databasePath, f.sources);
    const result = first.store.record('observation-1', COLLECTION, TIME);
    expect(result).toMatchObject({ ...inspectFineLedger(COLLECTION, f.sources),
        observationId: 'observation-1', recordedAt: TIME });
    expect(result.observationDigest).toMatch(/^[0-9a-f]{64}$/);
    f.state.escrowStatus = 'held';
    const reads = f.state.reads;
    expect(first.store.record('observation-1', COLLECTION, '2030-01-02T00:00:00.000Z')).toEqual(result);
    expect(first.store.get('observation-1')).toEqual(result);
    expect(first.store.verifyAuditChain()).toBeTrue();
    expect(f.state.reads).toBe(reads);
    expect(() => first.store.record('observation-1', OTHER_COLLECTION, TIME)).toThrow();
    const fresh = first.store.record('observation-2', COLLECTION, '2030-01-02T00:00:00.000Z');
    expect(fresh.status).toBe('held');
    expect(first.store.list(COLLECTION)).toEqual([result, fresh]);
    expect(first.store.list(OTHER_COLLECTION)).toEqual([]);
    expect(first.store.get('absent')).toBeNull();
    first.close();
    f.state.validAudit = false;
    const restarted = open(databasePath, f.sources).store;
    const before = f.state.reads;
    expect(restarted.list()).toEqual([result, fresh]);
    expect(restarted.verifyAuditChain()).toBeTrue();
    expect(f.state.reads).toBe(before);
    const raw = new Database(databasePath);
    expect(raw.query('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    raw.close(true);
});

const diagnoses: Array<[FineLedgerStatus, string | null, boolean, boolean]> = [
    ['no-movement', null, false, true], ['held', 'held', false, true],
    ['released', 'released', false, true], ['debit-only', 'committed', false, true],
    ['matching-receipt-shape', 'committed', true, true],
    ['conflict', null, true, true], ['unverifiable', null, false, false],
];
test.each(diagnoses)('%s is internally inspected and never grants payment or collection authority',
    (status, escrowStatus, credited, validAudit) => {
        const f = fixture();
        Object.assign(f.state, { escrowStatus, credited, validAudit });
        const before = structuredClone({ intent: f.intent, escrow: f.escrow, credit: f.credit });
        const store = open(path(), f.sources).store;
        const result = store.record(`observation-${status}`, COLLECTION, TIME);
        expect(result).toMatchObject({ status, canCollect: false, canMarkPaid: false });
        expect(result).toMatchObject(inspectFineLedger(COLLECTION, f.sources));
        expect({ intent: f.intent, escrow: f.escrow, credit: f.credit }).toEqual(before);
        expect(f.state).toMatchObject({ escrowStatus, credited, validAudit });
        expect(store.verifyAuditChain()).toBeTrue();
    });

const corruptions: Array<[string, string]> = [
    ['serialized diagnosis', "UPDATE fine_ledger_observation SET payload_json='{}'"],
    ['record digest', "UPDATE fine_ledger_observation SET observation_digest='bad'"],
    ['audit hash', "UPDATE fine_ledger_observation_audit SET entry_hash='bad'"],
    ['audit linkage', "UPDATE fine_ledger_observation_audit SET previous_hash='bad'"],
    ['observation deletion', 'DELETE FROM fine_ledger_observation'],
    ['audit deletion', 'DELETE FROM fine_ledger_observation_audit'],
];
test.each(corruptions)('%s tampering fails closed on historical reads and new writes', (_name, sql) => {
    const f = fixture(), databasePath = path();
    const store = open(databasePath, f.sources).store;
    store.record('observation-1', COLLECTION, TIME);
    const raw = new Database(databasePath);
    raw.run(sql);
    raw.close(true);
    expect(store.verifyAuditChain()).toBeFalse();
    expect(() => store.get('observation-1')).toThrow();
    expect(() => store.list()).toThrow();
    expect(() => store.record('observation-2', COLLECTION, TIME)).toThrow();
});

test('paired final-row and audit deletion is detected by the retained SQLite high-water mark', () => {
    const f = fixture(), databasePath = path();
    const store = open(databasePath, f.sources).store;
    store.record('observation-1', COLLECTION, TIME);
    store.record('observation-2', COLLECTION, TIME);
    const raw = new Database(databasePath);
    raw.run("DELETE FROM fine_ledger_observation WHERE observation_id='observation-2'");
    raw.run("DELETE FROM fine_ledger_observation_audit WHERE observation_id='observation-2'");
    raw.close(true);
    expect(store.verifyAuditChain()).toBeFalse();
    expect(() => store.get('observation-1')).toThrow();
    expect(() => store.list()).toThrow();
    expect(() => store.record('observation-3', COLLECTION, TIME)).toThrow();
});

test('authority-shaped payload tampering cannot elevate a diagnostic receipt', () => {
    const f = fixture(), databasePath = path();
    f.state.escrowStatus = 'committed'; f.state.credited = true;
    const store = open(databasePath, f.sources).store;
    store.record('observation-1', COLLECTION, TIME);
    const raw = new Database(databasePath);
    const row = raw.query('SELECT payload_json FROM fine_ledger_observation').get() as { payload_json: string };
    const payload = JSON.parse(row.payload_json);
    payload.canMarkPaid = true;
    raw.run('UPDATE fine_ledger_observation SET payload_json=?1', [JSON.stringify(payload)]);
    raw.close(true);
    expect(store.verifyAuditChain()).toBeFalse();
    expect(() => store.get('observation-1')).toThrow();
});

test('audit insert failure rolls back the observation and permits a clean retry', () => {
    const f = fixture(), databasePath = path();
    const store = open(databasePath, f.sources).store;
    const raw = new Database(databasePath);
    try {
        raw.run(`CREATE TRIGGER reject_observation_audit BEFORE INSERT ON fine_ledger_observation_audit
            BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`);
        expect(() => store.record('observation-1', COLLECTION, TIME)).toThrow('injected audit failure');
        expect(store.list()).toEqual([]);
        expect(store.verifyAuditChain()).toBeTrue();
        raw.run('DROP TRIGGER reject_observation_audit');
        expect(store.record('observation-1', COLLECTION, TIME)).toMatchObject({
            status: 'no-movement', canCollect: false, canMarkPaid: false });
        expect(store.list()).toHaveLength(1);
        expect(store.verifyAuditChain()).toBeTrue();
    } finally { raw.close(true); }
});

test('malformed IDs and timestamps are rejected before source reads or journal writes', () => {
    const f = fixture(), store = open(path(), f.sources).store;
    for (const id of ['', ' id', 'id ', '../observation', 'x'.repeat(129)])
        expect(() => store.record(id, COLLECTION, TIME)).toThrow();
    for (const collectionId of ['', 'fine-collection:short', `fine-collection:${'A'.repeat(64)}`, `${COLLECTION} `])
        expect(() => store.record('observation-1', collectionId, TIME)).toThrow();
    for (const timestamp of ['', 'not-a-date', '2030-01-01', '2030-01-01T00:00:00Z', '2030-02-30T00:00:00.000Z'])
        expect(() => store.record('observation-1', COLLECTION, timestamp)).toThrow();
    expect(f.state.reads).toBe(0);
    expect(store.list()).toEqual([]);
    expect(store.verifyAuditChain()).toBeTrue();
});

test.each(['future-version', 'unknown-unversioned'])('rejects %s databases without adopting or overwriting them', kind => {
    const databasePath = path(), raw = new Database(databasePath);
    raw.run('CREATE TABLE unrelated_payload (value TEXT)');
    raw.run("INSERT INTO unrelated_payload VALUES ('preserve-me')");
    if (kind === 'future-version') raw.run('PRAGMA user_version=99');
    raw.close(true);
    expect(() => new FineLedgerReconciliationStore(databasePath, fixture().sources)).toThrow();
    const reopened = new Database(databasePath);
    expect(reopened.query('SELECT value FROM unrelated_payload').all()).toEqual([{ value: 'preserve-me' }]);
    expect(reopened.query('PRAGMA user_version').get()).toEqual({ user_version: kind === 'future-version' ? 99 : 0 });
    expect(reopened.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
        .toEqual([{ name: 'unrelated_payload' }]);
    reopened.close(true);
});
