import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CrimeCaseStore } from '../../crime-cases/store.js';
import { verifyPlayerOnlyWitness } from '../../crime-cases/player-witness-proof.js';
import { ThievingEvidenceStore, type EngineThievingEvidence } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome } from '../engine-bridge.js';
import { ThievingProcedureStore } from '../store.js';
import { WitnessAttentionDecisionStore } from '../witness-decision-store.js';
import { loadWitnessAttentionPolicy, projectPropertyWitnessOpportunities,
    projectThievingWitnessOpportunities, validateWitnessAttentionPolicy } from '../witness-attention.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
const at = '2030-01-01T10:00:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(name: string): string { const root = mkdtempSync(join(tmpdir(), 'witness-attention-'));
    roots.push(root); return join(root, `${name}.sqlite`); }
const policy = loadWitnessAttentionPolicy(join(config, 'thieving-witness-attention.json'));
const entry: EngineThievingEvidence = { eventId: 'entry-1', playerUsername: 'thief1',
    procedureKind: 'property-burglary', target: { kind: 'loc', typeId: 4673, instanceIndex: null,
        name: 'Property door', x: 2969, z: 3328, level: 0 }, effect: 'entry-completed',
    transferredItems: [], thievingXpDelta: 10, startedAtEngineTick: 100, endedAtEngineTick: 102,
    occurredAt: at, propertyAccess: { propertyId: 'falador.south-house', entryPointId: 'front-door',
        owner: { kind: 'player', id: 'victim' }, propertyStateVersion: 2, actorAuthorized: false, lockLevel: 35 },
    sightSnapshot: { actor: { x: 2969, z: 3328, level: 0 }, radius: 15,
        candidates: [{ username: 'nearby', x: 2970, z: 3328, level: 0 },
            { username: 'faraway', x: 2982, z: 3328, level: 0 }] } };
function stores() { return { source: new ThievingEvidenceStore(path('engine')),
    thieving: new ThievingProcedureStore(path('procedure')) }; }

test('item-theft witness projection rejects authorized access and legacy missing snapshots', () => {
    for (const authorized of [false, true]) {
        const { source, thieving } = stores();
        try {
            const input: EngineThievingEvidence = { ...entry, procedureKind: 'container-theft', effect: 'item-transfer',
                transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
                propertyAccess: { ...entry.propertyAccess!, actorAuthorized: authorized } };
            source.append(input);
            ingestEngineThievingOutcome(input.eventId, source, thieving, () => 'agent-thief', at);
            if (authorized) expect(() => projectThievingWitnessOpportunities(input.eventId, source, thieving, policy))
                .toThrow('audited theft or denied Property');
            else expect(projectThievingWitnessOpportunities(input.eventId, source, thieving, policy)).toHaveLength(2);
            expect(() => projectPropertyWitnessOpportunities(input.eventId, source, thieving, policy))
                .toThrow('denied Property burglary');
        } finally { thieving.close(); source.close(); }
    }
    const { source, thieving } = stores();
    try {
        const input: EngineThievingEvidence = { ...entry, procedureKind: 'pickpocket', effect: 'item-transfer',
            target: { ...entry.target, kind: 'npc', instanceIndex: 7 }, propertyAccess: undefined,
            sightSnapshot: undefined, transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }] };
        source.append(input); ingestEngineThievingOutcome(input.eventId, source, thieving, () => 'agent-thief', at);
        expect(() => projectThievingWitnessOpportunities(input.eventId, source, thieving, policy)).toThrow('no sight snapshot');
    } finally { thieving.close(); source.close(); }
});

describe('property witness attention opportunity projection', () => {
    test('maps audited sight candidates into policy-bound rates without discovery', () => {
        const { source, thieving } = stores();
        try { const event = source.append(entry);
            ingestEngineThievingOutcome(event.eventId, source, thieving, () => 'agent-thief', at);
            const opportunities = projectPropertyWitnessOpportunities(event.eventId, source, thieving, policy);
            expect(opportunities.map(value => [value.observerUsername, value.distance,
                value.attentionBasisPoints])).toEqual([['faraway', 13, 1000], ['nearby', 1, 6000]]);
            expect(opportunities.every(value => value.sourceEvidenceDigest === event.eventDigest
                && value.opportunityDigest.length === 64)).toBeTrue();
            expect(JSON.stringify(opportunities)).not.toContain('agent-thief');
            expect(thieving.listDiscoveries('outcome:entry-1')).toEqual([]);
            expect(projectPropertyWitnessOpportunities(event.eventId, source, thieving, policy))
                .toEqual(opportunities);
        } finally { thieving.close(); source.close(); }
    });
    test('rejects invalid policy and forged, authorized or absent sight claims', () => {
        const { digest: _digest, ...definition } = policy;
        expect(() => validateWitnessAttentionPolicy({ ...definition, bands: [
            { maxDistance: 5, attentionBasisPoints: 1000 },
            { maxDistance: 15, attentionBasisPoints: 2000 }] })).toThrow('bands must cover');
        const { source, thieving } = stores();
        try { const event = source.append({ ...entry, sightSnapshot: { ...entry.sightSnapshot!,
                candidates: [{ username: 'thief1', x: 2970, z: 3328, level: 0 }] } });
            ingestEngineThievingOutcome(event.eventId, source, thieving, () => 'agent-thief', at);
            expect(() => projectPropertyWitnessOpportunities(event.eventId, source, thieving, policy))
                .toThrow('candidate identity');
            expect(() => projectPropertyWitnessOpportunities(event.eventId, source, thieving,
                { ...policy, digest: '0'.repeat(64) })).toThrow('digest mismatch');
        } finally { thieving.close(); source.close(); }
        const legacy = stores();
        try { const event = legacy.source.append({ ...entry, sightSnapshot: undefined });
            ingestEngineThievingOutcome(event.eventId, legacy.source, legacy.thieving, () => 'agent-thief', at);
            expect(() => projectPropertyWitnessOpportunities(event.eventId, legacy.source,
                legacy.thieving, policy)).toThrow('no sight snapshot');
        } finally { legacy.thieving.close(); legacy.source.close(); }
        const authorized = stores();
        try { const event = authorized.source.append({ ...entry, propertyAccess: {
                ...entry.propertyAccess!, actorAuthorized: true } });
            ingestEngineThievingOutcome(event.eventId, authorized.source, authorized.thieving,
                () => 'agent-thief', at);
            expect(() => projectPropertyWitnessOpportunities(event.eventId, authorized.source,
                authorized.thieving, policy)).toThrow('denied Property burglary');
        } finally { authorized.thieving.close(); authorized.source.close(); }
    });
});

describe('one-shot server witness attention decisions', () => {
    test('records a player-only witness without inventing an agent and keeps that identity after binding', () => {
        const { source, thieving } = stores(), decisionPath = path('player-decisions');
        const certain = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'certain-attention',
            version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });
        const decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, certain);
        try { source.append(entry);
            ingestEngineThievingOutcome('entry-1', source, thieving, () => 'agent-thief', at);
            const first = decisions.decide('entry-1', 'nearby', () => null, at);
            expect(first).toMatchObject({ noticed: true, decision: {
                observerUsername: 'nearby', observerAgentId: null }, observation: {
                source: 'direct-witness', observerAgentId: null, actorIdentification: 'none',
                suspectAgentId: null, sourceEvidenceDigest: first.decision.decisionDigest } });
            expect(decisions.decide('entry-1', 'nearby', () => 'agent-nearby',
                '2030-01-01T10:02:00.000Z')).toEqual(first);
            expect(decisions.decide('entry-1', 'nearby', () => 'agent-thief',
                '2030-01-01T10:03:00.000Z')).toEqual(first);
            expect(thieving.listDiscoveries('outcome:entry-1')).toHaveLength(1);
            expect(decisions.verifyAuditChain()).toBeTrue();
            const cases = new CrimeCaseStore(path('player-case'), thieving);
            try { const discovery = cases.recordDiscovery('case-player-1', 'case-discovery-1',
                first.observation!.observationId, at);
                expect(discovery).toMatchObject({ observerAgentId: null, suspectAgentId: null,
                    identification: 'none' });
                expect(cases.getState('case-player-1')?.identifications).toEqual([]);
                const sources = { cases, thieving, witnessDecisions: decisions };
                expect(verifyPlayerOnlyWitness('case-player-1', 'case-discovery-1', 'NEARBY', sources))
                    .toEqual({ caseId: 'case-player-1', sourceCaseEventId: 'case-discovery-1',
                        observerUsername: 'nearby', observationId: first.observation!.observationId,
                        witnessDecisionDigest: first.decision.decisionDigest });
                expect(verifyPlayerOnlyWitness('case-player-1', 'case-discovery-1', 'faraway', sources))
                    .toBeNull();
                expect(verifyPlayerOnlyWitness('other-case', 'case-discovery-1', 'nearby', sources))
                    .toBeNull();
                const raw = new Database(decisionPath);
                try { raw.run(`UPDATE witness_attention_decision SET roll=9999
                    WHERE event_id='entry-1' AND observer_username='nearby'`); }
                finally { raw.close(); }
                expect(() => verifyPlayerOnlyWitness('case-player-1', 'case-discovery-1',
                    'nearby', sources)).toThrow('source audit chain');
            } finally { cases.close(); }
        } finally { decisions.close(); thieving.close(); source.close(); }
    });
    test('persists a noticed event, publishes anonymous-actor discovery and replays after restart', () => {
        const { source, thieving } = stores(), decisionPath = path('decisions');
        const certain = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'certain-attention',
            version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });
        let decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, certain);
        try { source.append(entry);
            ingestEngineThievingOutcome('entry-1', source, thieving, () => 'agent-thief', at);
            const first = decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at);
            expect(first).toMatchObject({ noticed: true, observation: { source: 'direct-witness',
                observerAgentId: 'agent-nearby', actorIdentification: 'none', suspectAgentId: null } });
            expect(JSON.stringify(first.observation)).not.toContain('agent-thief');
            decisions.close();
            decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, certain);
            expect(decisions.decide('entry-1', 'nearby', () => 'agent-nearby',
                '2030-01-01T10:02:00.000Z')).toEqual(first);
            expect(decisions.verifyAuditChain()).toBeTrue();
            expect(thieving.listDiscoveries('outcome:entry-1')).toHaveLength(1);
            const cases = new CrimeCaseStore(path('agent-witness-case'), thieving);
            try {
                cases.recordDiscovery('case-agent-1', 'case-agent-discovery-1',
                    first.observation!.observationId, at);
                expect(verifyPlayerOnlyWitness('case-agent-1', 'case-agent-discovery-1',
                    'nearby', { cases, thieving, witnessDecisions: decisions })).toBeNull();
            } finally { cases.close(); }
            expect(() => decisions.decide('entry-1', 'nearby', () => 'different-agent', at))
                .toThrow('different binding');
        } finally { decisions.close(); thieving.close(); source.close(); }
    });
    test('migrates populated v1 decisions and audit chain to nullable v2 identity', () => {
        const { source, thieving } = stores(), decisionPath = path('legacy-decisions');
        const certain = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'certain-attention',
            version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });
        let decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, certain);
        try { source.append(entry);
            ingestEngineThievingOutcome('entry-1', source, thieving, () => 'agent-thief', at);
            const original = decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at);
            decisions.close();
            const database = new Database(decisionPath);
            try { const legacy = database.transaction(() => {
                database.run(`CREATE TABLE witness_attention_decision_v1 (
                    event_id TEXT NOT NULL,observer_username TEXT NOT NULL,observer_agent_id TEXT NOT NULL,
                    outcome_receipt_id TEXT NOT NULL,outcome_receipt_digest TEXT NOT NULL,
                    opportunity_digest TEXT NOT NULL,policy_digest TEXT NOT NULL,
                    attention_basis_points INTEGER NOT NULL,roll INTEGER NOT NULL,
                    occurred_at TEXT NOT NULL,decision_digest TEXT NOT NULL UNIQUE,
                    PRIMARY KEY(event_id,observer_username))`);
                database.run('INSERT INTO witness_attention_decision_v1 SELECT * FROM witness_attention_decision');
                database.run(`CREATE TABLE witness_attention_audit_v1 (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,
                    observer_username TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                    UNIQUE(event_id,observer_username),FOREIGN KEY(event_id,observer_username)
                    REFERENCES witness_attention_decision_v1(event_id,observer_username))`);
                database.run('INSERT INTO witness_attention_audit_v1 SELECT * FROM witness_attention_audit');
                database.run('DROP TABLE witness_attention_audit');
                database.run('DROP TABLE witness_attention_decision');
                database.run('ALTER TABLE witness_attention_decision_v1 RENAME TO witness_attention_decision');
                database.run('ALTER TABLE witness_attention_audit_v1 RENAME TO witness_attention_audit');
                database.run('PRAGMA user_version = 1');
            }); legacy.immediate(); } finally { database.close(); }
            decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, certain);
            expect(decisions.get('entry-1', 'nearby')).toEqual(original.decision);
            expect(decisions.verifyAuditChain()).toBeTrue();
            expect(decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at)).toEqual(original);
            const migrated = new Database(decisionPath);
            try { expect((migrated.query('PRAGMA user_version').get() as { user_version: number }).user_version)
                .toBe(2);
                expect(migrated.query('PRAGMA foreign_key_check').all()).toEqual([]);
            } finally { migrated.close(); }
        } finally { decisions.close(); thieving.close(); source.close(); }
    });
    test('retains a miss, rejects outsiders and detects modified decisions', () => {
        const { source, thieving } = stores(), decisionPath = path('decisions');
        const never = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'no-attention',
            version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 0 }] });
        const decisions = new WitnessAttentionDecisionStore(decisionPath, source, thieving, never);
        try { source.append(entry);
            ingestEngineThievingOutcome('entry-1', source, thieving, () => 'agent-thief', at);
            expect(() => decisions.decide('entry-1', 'outsider', () => 'agent-outsider', at))
                .toThrow('not a verified sight candidate');
            expect(() => decisions.decide('entry-1', 'nearby', () => 'agent-thief', at))
                .toThrow('Offender cannot witness');
            const first = decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at);
            expect(first).toMatchObject({ noticed: false, observation: null });
            expect(decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at)).toEqual(first);
            expect(thieving.listDiscoveries('outcome:entry-1')).toEqual([]);
            const changedPolicy = validateWitnessAttentionPolicy({ schemaVersion: 1,
                policyId: 'changed-attention', version: '1.0.0',
                bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });
            const changed = new WitnessAttentionDecisionStore(decisionPath, source, thieving, changedPolicy);
            try { expect(() => changed.decide('entry-1', 'nearby', () => 'agent-nearby', at))
                .toThrow('different binding');
            } finally { changed.close(); }
            const tamper = new Database(decisionPath);
            try { tamper.run(`UPDATE witness_attention_decision SET roll=?1
                WHERE event_id='entry-1' AND observer_username='nearby'`, [(first.decision.roll + 1) % 10_000]);
            } finally { tamper.close(); }
            expect(decisions.verifyAuditChain()).toBeFalse();
            expect(() => decisions.decide('entry-1', 'nearby', () => 'agent-nearby', at))
                .toThrow('audit is invalid');
        } finally { decisions.close(); thieving.close(); source.close(); }
    });
});
