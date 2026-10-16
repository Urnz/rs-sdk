import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WitnessRecognitionStore, witnessRecognitionDigest, type WitnessRecognitionInput } from '../witness-recognition-store.js';

const dirs: string[] = [], stores: WitnessRecognitionStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close();
    for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'recognition-store-')); dirs.push(dir);
    const path = join(dir, 'recognition.sqlite'), store = new WitnessRecognitionStore(path); stores.push(store);
    const input: WitnessRecognitionInput = { recognitionId: 'recognition:one', eventId: 'engine:one',
        observerUsername: 'witness', recognizedPlayerUsername: 'offender', recognizedAgentId: 'agent:offender',
        attentionDecisionDigest: 'a'.repeat(64), sourceEvidenceDigest: 'b'.repeat(64),
        occurredAt: '2026-09-27T01:00:00.000Z' };
    const trustedDigest = witnessRecognitionDigest(input);
    return { path, store, input, verify: () => trustedDigest };
}
describe('independent witness recognition journal', () => {
    test('canonical digest, exact verified replay and reopening retain one audited source', () => {
        const { path, store, input, verify } = fixture();
        const value = store.record(input, verify);
        expect(value.recognitionDigest).toBe(witnessRecognitionDigest(input));
        expect(witnessRecognitionDigest(Object.fromEntries(Object.entries(input).reverse()) as WitnessRecognitionInput))
            .toBe(value.recognitionDigest);
        expect(store.verifyAuditChain()).toBe(true);
        expect(store.get(input.recognitionId)).toEqual(value);
        const retrieved = store.get(input.recognitionId)!; retrieved.recognizedAgentId = 'agent:fake';
        expect(store.get(input.recognitionId)).toEqual(value);
        expect(store.record(input, verify)).toEqual(value);
        expect(() => store.record(input, () => null)).toThrow('verification failed');
        store.close(); stores.splice(stores.indexOf(store), 1);
        const reopened = new WitnessRecognitionStore(path); stores.push(reopened);
        expect(reopened.verifyAuditChain()).toBe(true);
        expect(reopened.record(input, verify)).toEqual(value);
        const db = new Database(path); expect(db.query('SELECT COUNT(*) AS n FROM witness_recognition_audit').get()).toEqual({ n: 1 }); db.close();
    });
    test('authority is mandatory, conflicts and malformed source fields never write', () => {
        const { store, input, verify } = fixture();
        expect(() => store.record(input, undefined as never)).toThrow('verifier required');
        expect(() => store.record(input, () => true as never)).toThrow('verification failed');
        expect(() => store.record(input, () => { throw new Error('authority unavailable'); })).toThrow('authority unavailable');
        expect(store.get(input.recognitionId)).toBeNull();
        for (const change of [ { extra: 'bad' }, { recognitionDigest: 'c'.repeat(64) }, { eventId: '' },
            { recognizedAgentId: 'invalid agent' }, { observerUsername: 'Witness' }, { observerUsername: 123 },
            { recognizedPlayerUsername: 'witness' }, { sourceEvidenceDigest: 'B'.repeat(64) },
            { occurredAt: '2026-09-27T01:00:00Z' }, { occurredAt: 'bad' } ]) {
            expect(() => store.record({ ...input, ...change } as WitnessRecognitionInput, verify)).toThrow();
        }
        store.record(input, verify);
        const conflict = { ...input, recognizedAgentId: 'agent:other' };
        expect(() => store.record(conflict, () => witnessRecognitionDigest(conflict))).toThrow('different source');
        expect(store.verifyAuditChain()).toBe(true);
        expect(store.get(input.recognitionId)?.recognizedAgentId).toBe(input.recognizedAgentId);
    });
    test('payload, audit, orphan and removed-row tampering fail closed on reads and writes', () => {
        for (const sql of [ "UPDATE witness_recognition SET payload='{}'", "UPDATE witness_recognition_audit SET previous_hash='bad'",
            'DELETE FROM witness_recognition_audit', 'DELETE FROM witness_recognition' ]) {
            const { path, store, input, verify } = fixture(); store.record(input, verify);
            const db = new Database(path); db.run(sql); db.close();
            expect(store.verifyAuditChain()).toBe(false);
            expect(() => store.get(input.recognitionId)).toThrow('audit is invalid');
            expect(() => store.record({ ...input, recognitionId: 'recognition:two' }, verify)).toThrow('audit is invalid');
        }
    });
    test('unsupported future schema is not silently downgraded', () => {
        const { path, store } = fixture(); store.close(); stores.splice(stores.indexOf(store), 1);
        const db = new Database(path); db.run('PRAGMA user_version = 2'); db.close();
        expect(() => new WitnessRecognitionStore(path)).toThrow('newer than supported');
    });
});
