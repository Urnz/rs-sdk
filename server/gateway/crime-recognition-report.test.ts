import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../agent-state/store.js';
import { CrimeCaseStore } from '../../crime-cases/store.js';
import { CrimeEvidenceStore } from '../../crime-cases/evidence-store.js';
import { CrimeReportStore } from '../../crime-cases/report-store.js';
import { PlayerWitnessReportStore } from '../../crime-cases/player-witness-report-store.js';
import { promoteCrimeObservation } from '../../crime-cases/observation-ingest.js';
import { ThievingEvidenceStore } from '../engine/src/mods/ThievingEvidenceStore.js';
import { EngineWitnessInspectionStore } from '../engine/src/mods/WitnessInspectionStore.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { WitnessRecognitionStore } from '../../thieving-procedures/witness-recognition-store.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import { loadWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { recordEngineWitnessRecognition } from '../../thieving-procedures/engine-recognition.js';
import { fileAuthenticatedWitnessReport } from './crime-report-intake.js';
import { openWitnessRecognitionSources, recognizeAuthenticatedWitness } from './crime-witness-recognition.js';
import { listAuthenticatedWitnessObservations } from './crime-witness-observations.js';

const roots: string[] = [], at = '2030-01-01T10:00:00.000Z', noticed = '2030-01-01T10:01:00.000Z';
const recognized = '2030-01-01T10:02:00.000Z', reported = '2030-01-01T10:03:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
for (const playerOnly of [false, true]) test(`verified recognition report ${playerOnly ? 'player-only' : 'agent'} replays and refuses missing or corrupt engine proof`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'recognition-report-')); roots.push(root);
    const path = (name: string) => join(root, `${name}.sqlite`);
    const paths = { agents: path('agents'), thieving: path('thieving'), cases: path('cases'), reports: path('reports'),
        playerReports: path('player-reports'), engineEvidence: path('engine'), engineRecognition: path('inspection'),
        recognition: path('recognition'), caseEvidence: path('evidence'), witnessDecisions: path('decision'),
        witnessPolicy: join(import.meta.dir, '../../crime-cases/test/fixtures/witness-certain.json') };
    const source = new ThievingEvidenceStore(paths.engineEvidence), thieving = new ThievingProcedureStore(paths.thieving);
    const agents = new AgentStateStore(paths.agents), engineRecognition = new EngineWitnessInspectionStore(paths.engineRecognition);
    const recognition = new WitnessRecognitionStore(paths.recognition);
    const decisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, source, thieving, loadWitnessAttentionPolicy(paths.witnessPolicy));
    const cases = new CrimeCaseStore(paths.cases, thieving), evidence = new CrimeEvidenceStore(paths.caseEvidence, cases, thieving);
    try {
        agents.createIdentity({ agentId: 'thief-agent', playerUsername: 'thief1', displayName: 'Thief', background: 'Fixture.', personalityTraits: ['careful'] }, at);
        if (!playerOnly) agents.createIdentity({ agentId: 'witness-agent', playerUsername: 'witness1', displayName: 'Witness', background: 'Fixture.', personalityTraits: ['careful'] }, at);
        const target = { kind: 'npc' as const, typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 };
        const event = source.append({ eventId: 'theft-event', playerUsername: 'thief1', procedureKind: 'pickpocket', target,
            effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
            thievingXpDelta: 8, startedAtEngineTick: 100, endedAtEngineTick: 102, occurredAt: at,
            sightSnapshot: { actor: { x: 3222, z: 3218, level: 0 }, radius: 15,
                continuity: { actorSessionToken: '00000000-0000-4000-8000-000000000002', visualDigest: 'a'.repeat(64),
                    observers: [{ username: 'witness1', sessionToken: '00000000-0000-4000-8000-000000000003' }] },
                candidates: [{ username: 'witness1', x: 3223, z: 3218, level: 0 }] } });
        thieving.recordOutcome('outcome:theft-event', { evidenceId: 'theft-event', procedureId: 'procedure.thieving.pickpocket',
            procedureVersion: '0.1.0', procedureKind: 'pickpocket', actorAgentId: 'thief-agent', playerUsername: 'thief1', target,
            result: 'succeeded', effect: 'item-transfer', transferredItems: event.transferredItems, thievingXpDelta: 8,
            startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: event.eventId, sourceEvidenceDigest: event.eventDigest, occurredAt: at }, () => true, at);
        const anonymous = decisions.decide(event.eventId, 'witness1', () => playerOnly ? null : 'witness-agent', noticed).observation!;
        const anonymousPromoted = promoteCrimeObservation(anonymous.observationId, thieving, cases, evidence, noticed);
        const visible = listAuthenticatedWitnessObservations('witness1', 'Witness1', paths);
        expect(visible).toEqual([{ eventId: event.eventId, observationId: anonymous.observationId,
            caseId: anonymousPromoted.caseId, sourceCaseEventId: anonymousPromoted.discovery.eventId,
            procedureKind: 'pickpocket', occurredAt: noticed, facts: anonymous.facts,
            observerKind: playerOnly ? 'player-only' : 'agent' }]);
        expect(JSON.stringify(visible)).not.toContain('thief-agent');
        expect(() => listAuthenticatedWitnessObservations('witness1', 'other1', paths))
            .toThrow('matching live game session');
        // Engine-receipt fixture only. Actual visibility/continuity is separately engine-tested.
        const recognitionId = '00000000-0000-4000-8000-000000000001';
        engineRecognition.append({ recognitionId, eventId: event.eventId, observerUsername: 'witness1',
            recognizedPlayerUsername: 'thief1', sourceEvidenceDigest: event.eventDigest, occurredAt: recognized,
            engineTick: 104, targetPlayerSlot: 42, actorSessionToken: '00000000-0000-4000-8000-000000000002', visualDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64) });
        const observation = recordEngineWitnessRecognition(recognitionId, 'witness1', { source, thieving,
            agents, decisions, recognition, engineRecognition }, recognized);
        const promoted = promoteCrimeObservation(observation.observationId, thieving, cases, evidence, recognized);
        const input = { caseId: promoted.caseId, sourceCaseEventId: promoted.discovery.eventId };
        expect(() => fileAuthenticatedWitnessReport(input, 'other1', 'other1', paths, reported)).toThrow();
        expect(() => fileAuthenticatedWitnessReport(input, 'witness1', 'witness1', { ...paths, engineRecognition: undefined }, reported)).toThrow('unavailable');
        const first = fileAuthenticatedWitnessReport(input, 'witness1', 'witness1', paths, reported);
        expect(fileAuthenticatedWitnessReport(input, 'witness1', 'witness1', paths, reported)).toEqual(first);
        if (playerOnly) {
            // A historical player-only witness remains player-only after an agent
            // profile is attached later; source attention identity is immutable.
            agents.createIdentity({ agentId: 'later-witness-agent', playerUsername: 'witness1',
                displayName: 'Later witness', background: 'Fixture.', personalityTraits: ['careful'] }, reported);
            expect(fileAuthenticatedWitnessReport(input, 'witness1', 'witness1', paths, reported)).toEqual(first);
        }
        expect(thieving.getDiscovery(anonymous.observationId)).toEqual(anonymous);
        expect(evidence.listFindings(promoted.caseId)).toEqual([]);
        if (playerOnly) {
            if (!('reporterUsername' in first)) throw new Error('Expected player report');
            const deps = openWitnessRecognitionSources(paths);
            const ledger = new PlayerWitnessReportStore(paths.playerReports, { cases, thieving, witnessDecisions: decisions, verifyRecognition: deps.verifyRecognition });
            try { expect(ledger.verifyAuditChain()).toBeTrue(); expect(ledger.listForCase(promoted.caseId)).toEqual([first]); }
            finally { ledger.close(); deps.close(); }
        } else {
            if (!('reporterAgentId' in first)) throw new Error('Expected agent report');
            const ledger = new CrimeReportStore(paths.reports, cases);
            try { expect(ledger.verifyAuditChain()).toBeTrue(); expect(ledger.listForCase(promoted.caseId)).toEqual([first]); } finally { ledger.close(); }
        }
        await expect(recognizeAuthenticatedWitness({ eventId: event.eventId, recognizedPlayerUsername: 'thief1' }, 'witness1', 'witness1', paths)).rejects.toThrow('fields');
        const recognitionRequest = { commandId: recognitionId, eventId: event.eventId, targetPlayerSlot: 42 };
        for (const avatar of [null, 'other1'])
            await expect(recognizeAuthenticatedWitness(recognitionRequest, 'witness1', avatar, paths))
                .rejects.toThrow('matching live game session');
        await expect(recognizeAuthenticatedWitness({ ...recognitionRequest, observerUsername: 'witness1' },
            'witness1', 'witness1', paths)).rejects.toThrow('fields');
        for (const targetPlayerSlot of [-1, 2048, 1.5, '42'])
            await expect(recognizeAuthenticatedWitness({ ...recognitionRequest, targetPlayerSlot },
                'witness1', 'witness1', paths)).rejects.toThrow('request is invalid');
        const missedPolicy = join(import.meta.dir, '../../crime-cases/test/fixtures/witness-missed.json');
        const missedDecisions = new WitnessAttentionDecisionStore(path('missed-decisions'), source, thieving,
            loadWitnessAttentionPolicy(missedPolicy));
        try {
            expect(missedDecisions.decide(event.eventId, 'witness1', () => null, noticed).noticed).toBeFalse();
            await expect(recognizeAuthenticatedWitness(recognitionRequest, 'witness1', 'witness1',
                { ...paths, witnessDecisions: path('missed-decisions'), witnessPolicy: missedPolicy }))
                .rejects.toThrow('requires a noticed event');
        } finally { missedDecisions.close(); }
        const raw = new Database(paths.engineRecognition);
        try { raw.run("UPDATE witness_inspection SET receipt_digest=?1", ['f'.repeat(64)]); } finally { raw.close(true); }
        expect(() => fileAuthenticatedWitnessReport(input, 'witness1', 'witness1', paths, reported)).toThrow('source');
    } finally { evidence.close(); cases.close(); decisions.close(); recognition.close(); engineRecognition.close(); agents.close(); thieving.close(); source.close(); }
});
