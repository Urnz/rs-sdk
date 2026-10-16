import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { fileAuthenticatedWitnessReport, hasMatchingLiveWitnessAvatar } from '../../server/gateway/crime-report-intake.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore, CrimeReportStore, fileWitnessReportForAvatar,
    type CrimeReportRequest } from '../index.js';

const roots: string[] = [], at = '2030-01-01T10:00:00.000Z', observed = '2030-01-01T10:01:00.000Z';
const reported = '2030-01-01T10:02:00.000Z', attestation = 'a'.repeat(64);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(observerAgentId: string | null = 'witness-agent') {
    const root = mkdtempSync(join(tmpdir(), 'crime-report-')); roots.push(root);
    const reportPath = join(root, 'reports.sqlite');
    const thieving = new ThievingProcedureStore(join(root, 'thieving.sqlite'));
    const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence',
        procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
        actorAgentId: 'hidden-thief', playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer',
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
        startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event',
        sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at };
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    thieving.recordDiscovery('observation-1', { evidenceId: 'discovery-evidence',
        outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId,
        actorIdentification: 'none', suspectAgentId: null, facts: ['I saw a theft.'],
        sourceEvidenceDigest: 'c'.repeat(64), occurredAt: observed }, () => true, observed);
    const cases = new CrimeCaseStore(join(root, 'cases.sqlite'), thieving);
    cases.recordDiscovery('case-1', 'discovery-1', 'observation-1', observed);
    const reports = new CrimeReportStore(reportPath, cases);
    return { thieving, cases, reports, reportPath };
}
function request(): CrimeReportRequest { return { reportId: 'report-1', caseId: 'case-1',
    sourceCaseEventId: 'discovery-1', reporterAgentId: 'witness-agent',
    reporterAttestationDigest: attestation, occurredAt: reported }; }

describe('explicit witness crime reports', () => {
    test('requires matching observer and independent report action, without finding guilt', () => {
        const { thieving, cases, reports, reportPath } = setup();
        try {
            expect(() => reports.record(request(), undefined, reported)).toThrow('not trusted');
            expect(() => reports.record({ ...request(), reporterAgentId: 'other-agent' },
                () => attestation, reported)).toThrow('this agent');
            const first = reports.record(request(), () => attestation, reported);
            expect(first).toMatchObject({ caseId: 'case-1', reporterAgentId: 'witness-agent' });
            expect(reports.get('report-1')).toEqual(first);
            expect(reports.record(request(), () => attestation, reported)).toEqual(first);
            expect(reports.listForCase('case-1')).toEqual([first]);
            expect(cases.getState('case-1')).toMatchObject({ identifications: [], legalFinding: null });
            expect(reports.verifyAuditChain()).toBeTrue();
            reports.close();
            const reopened = new CrimeReportStore(reportPath, cases);
            expect(reopened.listForCase('case-1')).toEqual([first]);
            reopened.close();
        } finally { cases.close(); thieving.close(); }
    });

    test('rejects anonymous witnesses, changed replay and duplicate report for one discovery', () => {
        const { thieving, cases, reports } = setup(null);
        try {
            expect(() => reports.record(request(), () => attestation, reported)).toThrow('this agent');
        } finally { reports.close(); cases.close(); thieving.close(); }
        const active = setup();
        try {
            active.reports.record(request(), () => attestation, reported);
            expect(() => active.reports.record({ ...request(), reporterAttestationDigest: 'd'.repeat(64) },
                () => 'd'.repeat(64), reported)).toThrow('reused');
            expect(() => active.reports.record({ ...request(), reportId: 'report-2' },
                () => attestation, reported)).toThrow('UNIQUE constraint');
            expect(active.reports.listForCase('case-1')).toHaveLength(1);
        } finally { active.reports.close(); active.cases.close(); active.thieving.close(); }
    });

    test('rejects premature or forged reports and detects ledger tampering', () => {
        const { thieving, cases, reports, reportPath } = setup();
        try {
            expect(() => reports.record({ ...request(), occurredAt: at }, () => attestation, reported))
                .toThrow('predates');
            expect(() => reports.record(request(), () => 'e'.repeat(64), reported)).toThrow('not trusted');
            reports.record(request(), () => attestation, reported);
            const db = new Database(reportPath, { strict: true });
            try { db.run("UPDATE crime_report SET reporter_agent_id='other-agent' WHERE report_id='report-1'");
            } finally { db.close(true); }
            expect(reports.verifyAuditChain()).toBeFalse();
            expect(() => reports.listForCase('case-1')).toThrow('audit chain');
            expect(() => reports.get('report-1')).toThrow('audit chain');
        } finally { reports.close(); cases.close(); thieving.close(); }
    });
});

describe('authenticated avatar witness report port', () => {
    test('requires enabled login authentication and a fresh state from this exact connection', () => {
        const live = { loginServerEnabled: true, authenticatedUsername: 'Witness1',
            avatarName: 'Witness1', connected: true, receivedStateThisConnection: true,
            inGame: true, lastStateReceivedAt: 100_000, nowMs: 101_000 };
        expect(hasMatchingLiveWitnessAvatar(live)).toBeTrue();
        expect(hasMatchingLiveWitnessAvatar({ ...live, loginServerEnabled: false })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, avatarName: 'Other1' })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, connected: false })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, receivedStateThisConnection: false })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, inGame: false })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, nowMs: 116_000 })).toBeFalse();
        expect(hasMatchingLiveWitnessAvatar({ ...live, nowMs: 99_000 })).toBeFalse();
    });

    test('accepts an explicit authenticated game-avatar request with server-generated proof and exact replay', () => {
        const { thieving, cases, reports, reportPath } = setup();
        const root = dirname(reportPath), agentPath = join(root, 'agents.sqlite');
        const agents = new AgentStateStore(agentPath);
        try {
            agents.createIdentity({ agentId: 'witness-agent', playerUsername: 'Witness1',
                displayName: 'Witness', background: 'Witness.', personalityTraits: ['observant'] });
            const paths = { agents: agentPath, thieving: join(root, 'thieving.sqlite'),
                cases: join(root, 'cases.sqlite'), reports: reportPath };
            const input = { caseId: 'case-1', sourceCaseEventId: 'discovery-1' };
            expect(() => fileAuthenticatedWitnessReport(input, 'Witness1', 'Other1', paths, reported))
                .toThrow('matching live game session');
            expect(() => fileAuthenticatedWitnessReport({ ...input, reporterAgentId: 'witness-agent' },
                'Witness1', 'Witness1', paths, reported)).toThrow('fields');
            expect(reports.listForCase('case-1')).toEqual([]);
            const first = fileAuthenticatedWitnessReport(input, 'Witness1', 'Witness1', paths, reported);
            if (!('reporterAgentId' in first)) throw new Error('Agent witness report expected');
            expect(first).toMatchObject({ caseId: 'case-1', reporterAgentId: 'witness-agent' });
            expect(first.reportId.startsWith('report-')).toBeTrue();
            const replay = fileAuthenticatedWitnessReport(input, 'Witness1', 'Witness1', paths,
                '2030-01-01T10:03:00.000Z');
            if (!('reporterAgentId' in replay)) throw new Error('Agent witness report expected');
            expect(replay).toEqual(first);
            expect(reports.get(first.reportId)).toEqual(first);
            expect(() => fileAuthenticatedWitnessReport({ ...input, sourceCaseEventId: 'absent-event' },
                'Witness1', 'Witness1', paths, reported)).toThrow('discovery');
            expect(reports.listForCase('case-1')).toEqual([first]);
        } finally { agents.close(); reports.close(); cases.close(); thieving.close(); }
    });

    test('does not route from a tampered case event before checking its audit chain', () => {
        const { thieving, cases, reports, reportPath } = setup();
        const root = dirname(reportPath), agentPath = join(root, 'agents.sqlite');
        const raw = new Database(join(root, 'cases.sqlite'), { strict: true });
        try {
            raw.run("UPDATE crime_case_event SET observer_agent_id=NULL WHERE event_id='discovery-1'");
            expect(() => fileAuthenticatedWitnessReport({ caseId: 'case-1', sourceCaseEventId: 'discovery-1' },
                'Witness1', 'Witness1', { agents: agentPath, thieving: join(root, 'thieving.sqlite'),
                    cases: join(root, 'cases.sqlite'), reports: reportPath }, reported))
                .toThrow('source audit chain');
        } finally { raw.close(true); reports.close(); cases.close(); thieving.close(); }
    });

    test('derives the reporter from an exact player binding and still requires action attestation', () => {
        const { thieving, cases, reports, reportPath } = setup();
        const agents = new AgentStateStore(join(dirname(reportPath), 'agents.sqlite'));
        try {
            agents.createIdentity({ agentId: 'witness-agent', playerUsername: 'Witness1',
                displayName: 'Witness', background: 'Witness.', personalityTraits: ['observant'] });
            const { reporterAgentId: unused, ...action } = request(); void unused;
            expect(() => fileWitnessReportForAvatar(action, () => 'Witness1', agents, cases, reports,
                () => null, reported)).toThrow('not trusted');
            const result = fileWitnessReportForAvatar(action, () => 'Witness1', agents, cases, reports,
                () => attestation, reported);
            expect(result.reporterAgentId).toBe('witness-agent');
            expect(fileWitnessReportForAvatar(action, () => 'WITNESS1', agents, cases, reports,
                () => attestation, reported)).toEqual(result);
            expect(reports.verifyAuditChain()).toBeTrue();
        } finally { agents.close(); reports.close(); cases.close(); thieving.close(); }
    });

    test('rejects absent, other-avatar and unbound agent identities', () => {
        const { thieving, cases, reports, reportPath } = setup();
        const agents = new AgentStateStore(join(dirname(reportPath), 'agents.sqlite'));
        try {
            agents.createIdentity({ agentId: 'witness-agent', playerUsername: 'Witness1',
                displayName: 'Witness', background: 'Witness.', personalityTraits: ['observant'] });
            agents.createIdentity({ agentId: 'other-agent', playerUsername: 'Other1',
                displayName: 'Other', background: 'Other.', personalityTraits: ['careful'] });
            const { reporterAgentId: unused, ...action } = request(); void unused;
            const file = (avatar: string | null) => fileWitnessReportForAvatar(action, () => avatar,
                agents, cases, reports, () => attestation, reported);
            expect(() => file(null)).toThrow('Authenticated avatar');
            expect(() => file('Unknown1')).toThrow('unique player agent');
            expect(() => file('Other1')).toThrow('recorded witness');
            expect(reports.listForCase('case-1')).toEqual([]);
            const profile = agents.getControlProfile('witness-agent')!;
            agents.setControlProfile('witness-agent', profile.revision, {
                role: 'institution', subjectKind: 'faction', subjectId: 'guards',
                avatarPlayerUsername: null, decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
                dailyLlmBudgetMicros: 1, dailyOperationalBudgetGp: 0 });
            expect(() => file('Witness1')).toThrow('not bound to a player agent');
        } finally { agents.close(); reports.close(); cases.close(); thieving.close(); }
    });
});
