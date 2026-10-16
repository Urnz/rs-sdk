import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FineCollectionIntentStore } from '../fine-collection-intent-store.js';
import { inspectFineCollection } from '../fine-collection-preflight.js';

type Sources = Parameters<typeof inspectFineCollection>[1];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'fine-collection-intent-')); roots.push(root);
    const path = join(root, 'collection.sqlite');
    const state = { disposition: 'approved', factionStatus: 'active', username: 'avatar',
        avatar: 'avatar', treasury: 'treasury', digest: 'a'.repeat(64) };
    // All interfaces are typed source ports; the test doubles deliberately model only queried fields.
    const sources = {
        decisions: { get: () => ({ decisionId: 'decision-1', decisionDigest: state.digest,
            disposition: state.disposition, amountGp: 25, jurisdictionId: 'town-law',
            proposalId: 'proposal-1', suspectAgentId: 'suspect-1' }) },
        proposals: { get: () => ({ findingId: 'finding-1' }) },
        evidence: { getFinding: () => ({ caseId: 'case-1' }) },
        cases: { getState: () => ({ outcomeReceiptId: 'outcome-1' }) },
        thieving: { getOutcome: () => ({ playerUsername: state.username,
            actorAgentId: 'suspect-1' }) },
        agents: { getIdentity: () => ({ playerUsername: 'avatar' }),
            getControlProfile: () => ({ role: 'player', subjectKind: 'player',
                avatarPlayerUsername: state.avatar, subjectId: 'avatar' }) },
        governance: { getJurisdiction: () => ({ factionId: 'town' }),
            getFaction: () => ({ factionId: 'town', status: state.factionStatus,
                treasuryActorId: state.treasury }) },
    } as unknown as Sources;
    return { path, state, sources, store: new FineCollectionIntentStore(path, sources) };
}

test('one immutable audited intent per approved exact-avatar decision, replay and restart', () => {
    const { path, sources, store } = setup();
    const first = store.record('decision-1', '2030-01-01T00:00:00.000Z');
    expect(first).toMatchObject({ decisionId: 'decision-1', amountGp: 25,
        payerUsername: 'avatar', creditorFactionId: 'town', treasuryActorId: 'treasury' });
    expect(first.collectionId).toStartWith('fine-collection:');
    expect(store.record('decision-1', '2030-01-02T00:00:00.000Z')).toEqual(first);
    expect(store.list()).toEqual([first]);
    expect(store.verifyAuditChain()).toBeTrue();
    store.close();
    const reopened = new FineCollectionIntentStore(path, sources);
    expect(reopened.get(first.collectionId)).toEqual(first);
    reopened.close();
});

test('rejects unapproved, inactive, unbound and missing treasury endpoints', () => {
    const { state, store } = setup();
    state.disposition = 'rejected';
    expect(() => store.record('decision-1')).toThrow('endpoints');
    state.disposition = 'approved'; state.factionStatus = 'disabled';
    expect(() => store.record('decision-1')).toThrow('endpoints');
    state.factionStatus = 'active'; state.avatar = 'other';
    expect(() => store.record('decision-1')).toThrow('endpoints');
    state.avatar = 'avatar'; state.treasury = '';
    expect(() => store.record('decision-1')).toThrow('endpoints');
    expect(store.list()).toEqual([]);
    store.close();
});

test('source drift and row or audit tampering fail closed on reads and writes', () => {
    const { path, state, store } = setup();
    const first = store.record('decision-1');
    state.digest = 'b'.repeat(64);
    expect(store.verifyAuditChain()).toBeFalse();
    expect(() => store.get(first.collectionId)).toThrow('audit chain');
    expect(() => store.list()).toThrow('audit chain');
    expect(() => store.record('decision-1')).toThrow('audit chain');
    state.digest = 'a'.repeat(64);
    expect(store.verifyAuditChain()).toBeTrue();
    const raw = new Database(path);
    raw.run("UPDATE fine_collection_intent SET amount_gp=26 WHERE decision_id='decision-1'");
    expect(() => store.getForDecision('decision-1')).toThrow('audit chain');
    raw.run("UPDATE fine_collection_intent SET amount_gp=25 WHERE decision_id='decision-1'");
    raw.run("UPDATE fine_collection_intent_audit SET entry_hash='bad' WHERE sequence=1");
    expect(() => store.list()).toThrow('audit chain');
    raw.close(true); store.close();
});
