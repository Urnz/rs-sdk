import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingEvidenceStore, type EngineThievingEvidence }
    from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { fileAuthenticatedWitnessReport } from '../../server/gateway/crime-report-intake.js';
import { ingestEngineThievingOutcome } from '../../thieving-procedures/engine-bridge.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import { validateWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { PlayerWitnessReportStore, type PlayerWitnessReportAction } from '../player-witness-report-store.js';
import { CrimeCaseStore } from '../store.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z';
const reported = '2030-01-01T10:02:00.000Z';
const attestation = 'a'.repeat(64);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const entry: EngineThievingEvidence = { eventId: 'entry-1', playerUsername: 'thief1',
    procedureKind: 'property-burglary', target: { kind: 'loc', typeId: 4673, instanceIndex: null,
        name: 'Property door', x: 2969, z: 3328, level: 0 }, effect: 'entry-completed',
    transferredItems: [], thievingXpDelta: 10, startedAtEngineTick: 100, endedAtEngineTick: 102,
    occurredAt: at, propertyAccess: { propertyId: 'falador.south-house', entryPointId: 'front-door',
        owner: { kind: 'player', id: 'victim' }, propertyStateVersion: 2, actorAuthorized: false, lockLevel: 35 },
    sightSnapshot: { actor: { x: 2969, z: 3328, level: 0 }, radius: 15,
        candidates: [{ username: 'nearby', x: 2970, z: 3328, level: 0 },
            { username: 'faraway', x: 2982, z: 3328, level: 0 }] } };
const certain = validateWitnessAttentionPolicy({ schemaVersion: 1, policyId: 'certain-attention',
    version: '1.0.0', bands: [{ maxDistance: 15, attentionBasisPoints: 10_000 }] });

function setup(agentId: string | null = null) {
    const root = mkdtempSync(join(tmpdir(), 'player-witness-report-')); roots.push(root);
    const path = (name: string) => join(root, `${name}.sqlite`);
    const reportPath = path('player-reports');
    const source = new ThievingEvidenceStore(path('engine'));
    const thieving = new ThievingProcedureStore(path('procedure'));
    const decisions = new WitnessAttentionDecisionStore(path('decisions'), source, thieving, certain);
    source.append(entry);
    ingestEngineThievingOutcome('entry-1', source, thieving, () => 'agent-thief', at);
    const witness = decisions.decide('entry-1', 'nearby', () => agentId, at);
    const cases = new CrimeCaseStore(path('cases'), thieving);
    cases.recordDiscovery('case-1', 'discovery-1', witness.observation!.observationId, at);
    const sources = { cases, thieving, witnessDecisions: decisions };
    const reports = new PlayerWitnessReportStore(reportPath, sources);
    return { source, thieving, decisions, cases, reports, sources, reportPath, path };
}
function close(value: ReturnType<typeof setup>): void {
    value.reports.close(); value.cases.close(); value.decisions.close();
    value.thieving.close(); value.source.close();
}
function action(): PlayerWitnessReportAction {
    return { reportId: 'player-report-1', caseId: 'case-1', sourceCaseEventId: 'discovery-1',
        actionAttestationDigest: attestation, occurredAt: reported };
}

describe('audited player-only witness reports', () => {
    test('gateway accepts a live authenticated player-only witness and replays without an agent identity', () => {
        const value = setup();
        const policyPath = value.path('witness-policy.json');
        const { digest: unused, ...policy } = certain; void unused;
        writeFileSync(policyPath, JSON.stringify(policy));
        const paths = { agents: value.path('agents'), thieving: value.path('procedure'),
            cases: value.path('cases'), reports: value.path('agent-reports'),
            playerReports: value.reportPath, engineEvidence: value.path('engine'),
            witnessDecisions: value.path('decisions'), witnessPolicy: policyPath };
        const input = { caseId: 'case-1', sourceCaseEventId: 'discovery-1' };
        try {
            expect(() => fileAuthenticatedWitnessReport(input, 'nearby', 'someoneelse', paths, reported))
                .toThrow('matching live game session');
            const first = fileAuthenticatedWitnessReport(input, 'nearby', 'nearby', paths, reported);
            expect(first).toMatchObject({ caseId: 'case-1', reporterUsername: 'nearby' });
            expect(fileAuthenticatedWitnessReport(input, 'nearby', 'nearby', paths,
                '2030-01-01T10:03:00.000Z')).toEqual(first);
            expect(() => fileAuthenticatedWitnessReport(input, 'faraway', 'faraway', paths, reported))
                .toThrow('not the recorded player-only witness');
            expect(existsSync(paths.agents)).toBeFalse();
            expect(value.cases.getState('case-1')?.legalFinding).toBeNull();
        } finally { close(value); }
    });

    test('requires an authenticated explicit action, persists source digests and replays exactly', () => {
        const value = setup();
        try {
            expect(() => value.reports.record(action(), () => null, () => attestation, reported))
                .toThrow('Authenticated witness username');
            expect(() => value.reports.record(action(), () => 'nearby', () => null, reported))
                .toThrow('not trusted');
            expect(() => value.reports.record({ ...action(), reporterUsername: 'nearby' } as PlayerWitnessReportAction,
                () => 'nearby', () => attestation, reported)).toThrow('fields');
            const first = value.reports.record(action(), () => 'NEARBY', () => attestation, reported);
            expect(first).toMatchObject({ reporterUsername: 'nearby', caseId: 'case-1' });
            expect(first.observationId.startsWith('witness:')).toBeTrue();
            expect(first.sourceCaseEventDigest).toHaveLength(64);
            expect(first.witnessDecisionDigest).toHaveLength(64);
            expect(value.reports.record(action(), () => 'nearby', () => attestation,
                '2030-01-01T10:03:00.000Z')).toEqual(first);
            expect(value.reports.listForCase('case-1')).toEqual([first]);
            expect(value.reports.verifyAuditChain()).toBeTrue();
            const reopened = new PlayerWitnessReportStore(value.reportPath, value.sources);
            try { expect(reopened.get(first.reportId)).toEqual(first); }
            finally { reopened.close(); }
            expect(value.cases.getState('case-1')?.legalFinding).toBeNull();
        } finally { close(value); }
    });

    test('rejects wrong witness, agent-bound witness, changed replay and duplicate source action', () => {
        const value = setup();
        try {
            expect(() => value.reports.record(action(), () => 'faraway', () => attestation, reported))
                .toThrow('not the recorded player-only witness');
            expect(() => value.reports.record(action(), () => 'thief1', () => attestation, reported))
                .toThrow('not the recorded player-only witness');
            expect(() => value.reports.record({ ...action(), occurredAt: '2030-01-01T09:59:00.000Z' },
                () => 'nearby', () => attestation, reported)).toThrow('predates');
            value.reports.record(action(), () => 'nearby', () => attestation, reported);
            expect(() => value.reports.record({ ...action(), actionAttestationDigest: 'b'.repeat(64) },
                () => 'nearby', () => 'b'.repeat(64), reported)).toThrow('reused');
            expect(() => value.reports.record({ ...action(), reportId: 'player-report-2' },
                () => 'nearby', () => attestation, reported)).toThrow('UNIQUE constraint');
        } finally { close(value); }
        const bound = setup('agent-nearby');
        try { expect(() => bound.reports.record(action(), () => 'nearby', () => attestation, reported))
            .toThrow('not the recorded player-only witness'); }
        finally { close(bound); }
    });

    test('fails closed after report or source-ledger tampering', () => {
        const value = setup();
        try {
            value.reports.record(action(), () => 'nearby', () => attestation, reported);
            const raw = new Database(value.reportPath, { strict: true });
            try { raw.run("UPDATE player_witness_report SET reporter_username='faraway' WHERE report_id='player-report-1'"); }
            finally { raw.close(true); }
            expect(value.reports.verifyAuditChain()).toBeFalse();
            expect(() => value.reports.get('player-report-1')).toThrow('audit chain');
        } finally { close(value); }
        const sourceChanged = setup();
        try {
            sourceChanged.reports.record(action(), () => 'nearby', () => attestation, reported);
            const raw = new Database(join(sourceChanged.reportPath, '..', 'decisions.sqlite'), { strict: true });
            try { raw.run("UPDATE witness_attention_decision SET roll=9999 WHERE observer_username='nearby'"); }
            finally { raw.close(true); }
            expect(sourceChanged.reports.verifyAuditChain()).toBeFalse();
            expect(() => sourceChanged.reports.listForCase('case-1')).toThrow('audit chain');
        } finally { close(sourceChanged); }
    });
});
