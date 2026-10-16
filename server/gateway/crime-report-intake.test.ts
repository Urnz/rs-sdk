import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { CrimeCaseStore } from '../../crime-cases/store.js';
import { CrimeReportStore } from '../../crime-cases/report-store.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { fileAuthenticatedWitnessReport } from './crime-report-intake.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z', observed = '2030-01-01T10:01:00.000Z';
const reported = '2030-01-01T10:02:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

for (const kind of ['discovery-recorded', 'suspect-identified'] as const) {
    test(`recognition ${kind} cannot be reported or replayed without independent source verification`, () => {
        const root = mkdtempSync(join(tmpdir(), 'recognition-report-gate-')); roots.push(root);
        const paths = { agents: join(root, 'agents.sqlite'), thieving: join(root, 'thieving.sqlite'),
            cases: join(root, 'cases.sqlite'), reports: join(root, 'reports.sqlite') };
        const open = () => {
            const agents = new AgentStateStore(paths.agents);
            const thieving = new ThievingProcedureStore(paths.thieving);
            const cases = new CrimeCaseStore(paths.cases, thieving);
            const reports = new CrimeReportStore(paths.reports, cases);
            return { agents, thieving, cases, reports,
                close: () => { reports.close(); cases.close(); thieving.close(); agents.close(); } };
        };
        let active = open();
        try {
            active.agents.createIdentity({ agentId: 'witness-agent', playerUsername: 'witness1',
                displayName: 'Witness', background: 'Fixture.', personalityTraits: ['careful'] }, at);
            active.thieving.recordOutcome('receipt-1', { evidenceId: 'engine-evidence',
                procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
                actorAgentId: 'hidden-thief', playerUsername: 'thief1',
                target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
                result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
                thievingXpDelta: 8, startedAtEngineTick: 100, endedAtEngineTick: 102,
                sourceEventId: 'engine-event', sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at }, () => true, at);
            // Trusted local fixture, not a real recognition source. Even perfectly
            // valid downstream journals must not be enough at authenticated intake.
            active.thieving.recordDiscovery('recognition:fixture', { evidenceId: 'recognition-evidence',
                outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'witness-agent',
                actorIdentification: 'direct', suspectAgentId: 'hidden-thief', facts: ['Recognized the person.'],
                sourceEvidenceDigest: 'c'.repeat(64), occurredAt: observed }, () => true, observed);
            active.cases.recordDiscovery('case-1', 'discovery-1', 'recognition:fixture', observed);
            active.cases.recordIdentification('case-1', 'identification-1', 'recognition:fixture', observed);
            const input = { caseId: 'case-1', sourceCaseEventId: kind === 'discovery-recorded'
                ? 'discovery-1' : 'identification-1' };
            const reject = () => expect(() => fileAuthenticatedWitnessReport(input,
                'witness1', 'witness1', paths, reported))
                .toThrow('Witness recognition source verification is unavailable');
            reject();
            expect(active.reports.listForCase('case-1')).toEqual([]);
            // Reproduce a pre-gate report using the trusted internal port. A stored
            // exact replay must not bypass the unavailable recognition source.
            // Report storage only accepts discovery sources; identification requests
            // must still hit this gate rather than falling through to that validation.
            const storedInput = { caseId: 'case-1', sourceCaseEventId: 'discovery-1' };
            const reportId = `report-${hash({ username: 'witness1', ...storedInput }).slice(0, 32)}`;
            const attestation = hash({ kind: 'authenticated-witness-report-v1', username: 'witness1',
                reportId, ...storedInput, occurredAt: reported });
            const existing = active.reports.record({ reportId, ...storedInput, reporterAgentId: 'witness-agent',
                reporterAttestationDigest: attestation, occurredAt: reported }, () => attestation, reported);
            active.close(); active = open();
            for (const store of [active.thieving, active.cases, active.reports])
                expect(store.verifyAuditChain()).toBeTrue();
            reject();
            expect(active.reports.listForCase('case-1')).toEqual([existing]);
        } finally { active.close(); }
    });
}
