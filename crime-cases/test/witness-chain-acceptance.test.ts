import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { RightsViolationStore } from '../../rights-violations/store.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog,
    loadHousingUnitCatalog } from '../../housing/config.js';
import { loadHousingSecurityPolicy } from '../../housing/security.js';
import { HousingTraceRollStore } from '../../housing/trace-roll-store.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { ThievingEvidenceStore, type EngineThievingEvidence }
    from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { fileAuthenticatedWitnessReport } from '../../server/gateway/crime-report-intake.js';
import { runThievingProcessorPage, ThievingEventCursorStore } from '../../thieving-procedures/cursor-store.js';
import { backfillPropertyEntryRights } from '../../thieving-procedures/rights-backfill.js';
import { processEngineThievingBatch } from '../../thieving-procedures/event-processor.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { loadWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import { createCurrentWitnessRecognitionPort, recordWitnessIdentification, type WitnessRecognitionSource } from '../../thieving-procedures/witness-identification.js';
import { WitnessRecognitionStore, witnessRecognitionDigest } from '../../thieving-procedures/witness-recognition-store.js';
import { EngineWitnessInspectionStore } from '../../server/engine/src/mods/WitnessInspectionStore.js';
import { makeVerifiedEngineRecognitionPort, recordEngineWitnessRecognition } from '../../thieving-procedures/engine-recognition.js';
import { CrimeCaseStore } from '../store.js';
import { CrimeEvidenceStore } from '../evidence-store.js';
import { CrimeObservationCursorStore, promoteCrimeObservation } from '../observation-ingest.js';
import { CrimeReportStore } from '../report-store.js';
import { PlayerWitnessReportStore } from '../player-witness-report-store.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z', later = '2030-01-01T10:01:00.000Z';
const config = join(import.meta.dir, '..', '..', 'config');
const properties = loadPropertyCatalog(join(config, 'properties.json'));
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const securityPolicy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy,
    new Set(properties.properties.map(value => value.propertyId)));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// This fixture starts at the real engine journal, not at gameplay/RuneScript or HTTP authentication.
const entry: EngineThievingEvidence = { eventId: 'acceptance-entry', playerUsername: 'thief1',
    procedureKind: 'property-burglary', target: { kind: 'loc', typeId: 4673, instanceIndex: null,
        name: 'Property door', x: 2969, z: 3328, level: 0 }, effect: 'entry-completed',
    transferredItems: [], thievingXpDelta: 10, startedAtEngineTick: 100, endedAtEngineTick: 102,
    occurredAt: at, propertyAccess: { propertyId: 'falador.south-house', entryPointId: 'front-door',
        owner: { kind: 'player', id: 'victim' }, propertyStateVersion: 2, actorAuthorized: false, lockLevel: 35 },
    sightSnapshot: { actor: { x: 2969, z: 3328, level: 0 }, radius: 15,
        candidates: [{ username: 'nearby', x: 2970, z: 3328, level: 0 },
            { username: 'human1', x: 2971, z: 3328, level: 0 }] } };

function fixture(missed = false, ownerBound = true, sourceEvent: EngineThievingEvidence = entry) {
    const root = mkdtempSync(join(tmpdir(), 'phase22-witness-chain-')); roots.push(root);
    const path = (name: string) => join(root, `${name}.sqlite`);
    const paths = { agents: path('agents'), thieving: path('thieving'), cases: path('cases'),
        reports: path('reports'), playerReports: path('player-reports'),
        engineEvidence: path('engine'), witnessDecisions: path('witness'),
        witnessPolicy: join(import.meta.dir, 'fixtures', missed ? 'witness-missed.json' : 'witness-certain.json') };
    const open = () => {
        const source = new ThievingEvidenceStore(paths.engineEvidence);
        const thieving = new ThievingProcedureStore(paths.thieving);
        const agents = new AgentStateStore(paths.agents);
        const rights = new RightsViolationStore(path('rights'));
        const witnessPolicy = loadWitnessAttentionPolicy(paths.witnessPolicy);
        const witnessDecisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, source, thieving, witnessPolicy);
        const recognition = new WitnessRecognitionStore(path('recognition'));
        const traceRolls = new HousingTraceRollStore(path('trace'), thieving);
        const engineCursor = new ThievingEventCursorStore(path('engine-cursor'), source, thieving);
        const cases = new CrimeCaseStore(paths.cases, thieving);
        const evidence = new CrimeEvidenceStore(path('evidence'), cases, thieving);
        const caseCursor = new CrimeObservationCursorStore(path('case-cursor'), thieving, cases, evidence);
        const reports = new CrimeReportStore(paths.reports, cases);
        const playerReports = new PlayerWitnessReportStore(paths.playerReports, { cases, thieving, witnessDecisions });
        const deps = { source, thieving, agents, rights, witnessDecisions, traceRolls,
            properties, units, hierarchy, effects, securityPolicy, witnessPolicy };
        return { ...deps, recognition, engineCursor, cases, evidence, caseCursor, reports, playerReports,
            process: () => runThievingProcessorPage(deps, engineCursor, 10, later),
            close: () => { playerReports.close(); reports.close(); caseCursor.close(); evidence.close();
                cases.close(); engineCursor.close(); traceRolls.close(); recognition.close(); witnessDecisions.close();
                rights.close(); agents.close(); thieving.close(); source.close(); } };
    };
    const value = open();
    for (const [agentId, playerUsername] of [['agent-thief', 'thief1'], ['agent-nearby', 'nearby'],
        ['agent-victim', 'victim']] as const) {
        if (!ownerBound && playerUsername === 'victim') continue;
        value.agents.createIdentity({ agentId, playerUsername, displayName: agentId,
            background: 'Acceptance fixture.', personalityTraits: ['careful'] }, at);
    }
    value.source.append(sourceEvent);
    return { value, open, paths };
}

for (const kind of ['pickpocket', 'container-theft'] as const) {
    test(`${kind} follows the actual processor into agent and player-only notices, without identifying the hidden actor`, () => {
        const input: EngineThievingEvidence = { ...entry, procedureKind: kind, effect: 'item-transfer',
            target: { ...entry.target, kind: kind === 'pickpocket' ? 'npc' : 'loc',
                instanceIndex: kind === 'pickpocket' ? 7 : null }, propertyAccess: undefined,
            transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }] };
        const { value, open, paths } = fixture(false, true, input);
        let active = value;
        try {
            expect(active.process().processed[0]).toMatchObject({ traceDiscovered: null,
                noticedObservers: ['human1', 'nearby'], playerOnlyObservers: ['human1'] });
            expect(active.rights.list()).toEqual([]); // No invented Property entitlement for an NPC/stall.
            const discoveries = active.thieving.listDiscoveries('outcome:acceptance-entry');
            expect(discoveries).toHaveLength(2);
            expect(discoveries.every(item => item.actorIdentification === 'none' && item.suspectAgentId === null)).toBeTrue();
            expect(JSON.stringify(discoveries)).not.toContain('agent-thief');
            expect(active.caseCursor.runPage(100, later).processed).toBe(2);
            const caseId = active.cases.getCaseForOutcome('outcome:acceptance-entry')!;
            const requests = ['nearby', 'human1'].map(username => {
                const decision = active.witnessDecisions.get(input.eventId, username)!;
                const observation = discoveries.find(item => item.observerAgentId === decision.observerAgentId)!;
                const source = active.cases.findEventByObservation('discovery-recorded', observation.observationId)!;
                return { username, input: { caseId, sourceCaseEventId: source.eventId } };
            });
            const reports = requests.map(request => fileAuthenticatedWitnessReport(request.input,
                request.username, request.username, paths, later));
            expect(active.reports.listForCase(caseId)).toHaveLength(1);
            expect(active.playerReports.listForCase(caseId)).toHaveLength(1);
            expect(active.cases.getState(caseId)?.identifications).toEqual([]);
            expect(active.evidence.listFindings(caseId)).toEqual([]);
            expect(() => fileAuthenticatedWitnessReport(requests[0]!.input, 'thief1', 'thief1', paths, later)).toThrow();
            active.close(); active = open();
            expect(active.process().processed).toEqual([]);
            expect(active.caseCursor.runPage(100, later).processed).toBe(0);
            requests.forEach((request, index) => expect(fileAuthenticatedWitnessReport(request.input,
                request.username, request.username, paths, later)).toEqual(reports[index]!));
            for (const store of [active.thieving, active.witnessDecisions, active.engineCursor,
                active.cases, active.evidence, active.caseCursor, active.reports, active.playerReports])
                expect(store.verifyAuditChain()).toBeTrue();
        } finally { active.close(); }
    });
}

test('missed item-theft attention remains ignorant after processor retry', () => {
    const input: EngineThievingEvidence = { ...entry, procedureKind: 'pickpocket', effect: 'item-transfer',
        target: { ...entry.target, kind: 'npc', instanceIndex: 7 }, propertyAccess: undefined,
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }] };
    const { value } = fixture(true, true, input);
    try {
        expect(value.process().processed[0]?.noticedObservers).toEqual([]);
        expect(value.thieving.listDiscoveries('outcome:acceptance-entry')).toEqual([]);
        expect(value.caseCursor.runPage(100, later).processed).toBe(0);
        for (const username of ['nearby', 'human1']) {
            const first = value.witnessDecisions.get(input.eventId, username)!;
            expect(value.witnessDecisions.decide(input.eventId, username,
                avatar => avatar === 'nearby' ? 'agent-nearby' : null, later).decision).toEqual(first);
        }
        expect(value.process().processed).toEqual([]);
    } finally { value.close(); }
});

test('separate recognition promotes a new direct identification without rewriting anonymous discovery or finding guilt', () => {
    const { value, open } = fixture(); let active = value;
    try {
        active.process(); active.caseCursor.runPage(100, later);
        const anonymous = active.thieving.listDiscoveries('outcome:acceptance-entry');
        const decision = active.witnessDecisions.get(entry.eventId, 'nearby')!;
        const input = { recognitionId: 'recognition-one', eventId: entry.eventId,
            observerUsername: 'nearby', recognizedPlayerUsername: 'thief1', recognizedAgentId: 'agent-thief',
            attentionDecisionDigest: decision.decisionDigest, sourceEvidenceDigest: active.source.get(entry.eventId)!.eventDigest,
            occurredAt: later };
        // Explicit server-verifier fixture, not a production recognition event.
        const proof = active.recognition.record(input, candidate =>
            candidate.recognitionDigest === witnessRecognitionDigest(input) ? candidate.recognitionDigest : null);
        const deps = () => ({ source: active.source, thieving: active.thieving, decisions: active.witnessDecisions,
            recognition: active.recognition });
        expect(() => recordWitnessIdentification(proof.recognitionId, 'nearby',
            { ...deps(), recognition: createCurrentWitnessRecognitionPort() }, later)).toThrow('Independent recognition');
        for (const change of [{ observerUsername: 'human1' }, { recognizedAgentId: 'wrong-agent' },
            { attentionDecisionDigest: 'b'.repeat(64) }, { sourceEvidenceDigest: 'c'.repeat(64) },
            { occurredAt: at }, { recognizedPlayerUsername: 'someone' }])
            expect(() => recordWitnessIdentification(proof.recognitionId, 'nearby',
                { ...deps(), recognition: { verifyAuditChain: () => true, get: () => ({ ...proof, ...change }) } }, later)).toThrow();
        expect(active.thieving.listDiscoveries('outcome:acceptance-entry')).toEqual(anonymous);
        const recognized = recordWitnessIdentification(proof.recognitionId, 'nearby', deps(), later);
        expect(recognized).toMatchObject({ actorIdentification: 'direct', suspectAgentId: 'agent-thief' });
        expect(active.caseCursor.runPage(100, later).processed).toBe(1);
        const caseId = active.cases.getCaseForOutcome('outcome:acceptance-entry')!;
        expect(active.cases.getState(caseId)?.identifications).toHaveLength(1);
        expect(active.evidence.listEvidence(caseId).filter(item => item.kind === 'direct-identification')).toHaveLength(1);
        expect(active.evidence.listFindings(caseId)).toEqual([]);
        for (const observation of anonymous) expect(active.thieving.getDiscovery(observation.observationId)).toEqual(observation);
        active.close(); active = open();
        expect(active.recognition.get(proof.recognitionId)).toEqual(proof);
        expect(recordWitnessIdentification(proof.recognitionId, 'nearby', deps(), later)).toEqual(recognized);
        expect(active.caseCursor.runPage(100, later).processed).toBe(0);
        expect(active.cases.getState(caseId)?.identifications).toHaveLength(1);
        expect(active.cases.getWitnessSuspectDescription('agent-nearby', 'agent-thief')).not.toBeNull();
        expect(active.cases.getWitnessSuspectDescription('agent-victim', 'agent-thief')).toBeNull();
        const raw = new Database(join(roots.at(-1)!, 'recognition.sqlite'));
        try { raw.run("DELETE FROM witness_recognition_audit"); } finally { raw.close(); }
        expect(active.recognition.verifyAuditChain()).toBeFalse();
        expect(() => recordWitnessIdentification(proof.recognitionId, 'nearby', deps(), later)).toThrow('source audit');
    } finally { active.close(); }
});

test('engine inspection source independently binds recognition, survives reopen and refuses changed source coverage', () => {
    const continuity = { actorSessionToken: '00000000-0000-4000-8000-000000000001', visualDigest: 'd'.repeat(64),
        observers: [{ username: 'nearby', sessionToken: '00000000-0000-4000-8000-000000000002' }] };
    const { value, open } = fixture(false, true, { ...entry, sightSnapshot: { ...entry.sightSnapshot!, continuity } });
    let active = value;
    const path = join(roots.at(-1)!, 'inspection.sqlite');
    let engineRecognition = new EngineWitnessInspectionStore(path);
    const recognitionId = '00000000-0000-4000-8000-000000000003';
    const deps = () => ({ ...active, decisions: active.witnessDecisions, engineRecognition });
    try {
        active.process(); active.caseCursor.runPage(100, later);
        // Explicit engine-source fixture: runtime execution is tested separately by the real engine runner.
        const receipt = { recognitionId, eventId: entry.eventId, observerUsername: 'nearby',
            recognizedPlayerUsername: 'thief1', sourceEvidenceDigest: active.source.get(entry.eventId)!.eventDigest,
            occurredAt: later, engineTick: 103, actorSessionToken: continuity.actorSessionToken,
            visualDigest: continuity.visualDigest, policyDigest: 'e'.repeat(64), targetPlayerSlot: 2 };
        engineRecognition.append(receipt);
        expect(() => recordEngineWitnessRecognition(recognitionId, 'human1', deps(), later)).toThrow('Exact engine');
        const observation = recordEngineWitnessRecognition(recognitionId, 'nearby', deps(), later);
        expect(makeVerifiedEngineRecognitionPort(deps()).get(recognitionId)?.recognizedAgentId).toBe('agent-thief');
        expect(active.caseCursor.runPage(100, later).processed).toBe(1);
        active.close(); engineRecognition.close(); active = open(); engineRecognition = new EngineWitnessInspectionStore(path);
        expect(recordEngineWitnessRecognition(recognitionId, 'nearby', deps(), later)).toEqual(observation);
        expect(active.caseCursor.runPage(100, later).processed).toBe(0);
        const raw = new Database(path);
        try { raw.run("UPDATE witness_inspection SET receipt_digest='bad'"); } finally { raw.close(); }
        expect(makeVerifiedEngineRecognitionPort(deps()).verifyAuditChain()).toBeFalse();
        expect(() => recordEngineWitnessRecognition(recognitionId, 'nearby', deps(), later)).toThrow('audit');
    } finally { engineRecognition.close(); active.close(); }
});

test('missed attention and tampered recognition source never identify an actor', () => {
    for (const missed of [false, true]) {
        const { value } = fixture(missed);
        try {
            value.process();
            const decision = value.witnessDecisions.get(entry.eventId, 'nearby')!;
            const proof: WitnessRecognitionSource = { recognitionId: 'recognition-one', eventId: entry.eventId,
                observerUsername: 'nearby', recognizedPlayerUsername: 'thief1', recognizedAgentId: 'agent-thief',
                attentionDecisionDigest: decision.decisionDigest, sourceEvidenceDigest: value.source.get(entry.eventId)!.eventDigest,
                recognitionDigest: 'a'.repeat(64), occurredAt: later };
            expect(() => recordWitnessIdentification(proof.recognitionId, 'nearby', { source: value.source,
                thieving: value.thieving, decisions: value.witnessDecisions,
                recognition: { verifyAuditChain: () => missed, get: () => proof } }, later)).toThrow(missed ? 'noticed event' : 'source audit');
        } finally { value.close(); }
    }
});

test('engine journal to both witness report ledgers survives closing every store and exact replay', () => {
    const { value, open, paths } = fixture();
    let active = value;
    try {
        expect(active.process()).toMatchObject({ blockedEventId: null, processed: [{
            eventId: entry.eventId, noticedObservers: ['human1', 'nearby'], playerOnlyObservers: ['human1'] }] });
        const discoveries = active.thieving.listDiscoveries('outcome:acceptance-entry');
        expect(active.caseCursor.runPage(100, later).processed).toBe(discoveries.length);
        const caseId = active.cases.getCaseForOutcome('outcome:acceptance-entry')!;
        const state = active.cases.getState(caseId)!;
        expect(active.rights.list()).toHaveLength(1);
        expect(active.rights.list()[0]).toMatchObject({ actorAgentId: 'agent-thief',
            owner: { kind: 'agent', id: 'agent-victim' }, resourceKind: 'entry-entitlement' });
        expect(state.identifications).toEqual([]);
        expect(state.legalFinding).toBeNull();
        expect(active.evidence.listEvidence(caseId).every(proof => proof.kind === 'physical-trace')).toBeTrue();
        const reportFor = (username: string) => {
            const decision = active.witnessDecisions.get(entry.eventId, username)!;
            const observation = discoveries.find(item => item.observerAgentId === decision.observerAgentId
                && item.source === 'direct-witness')!;
            const event = active.cases.findEventByObservation('discovery-recorded', observation.observationId)!;
            return { caseId, sourceCaseEventId: event.eventId };
        };
        const agentRequest = reportFor('nearby'), playerRequest = reportFor('human1');
        const agentReport = fileAuthenticatedWitnessReport(agentRequest, 'nearby', 'nearby', paths, later);
        const playerReport = fileAuthenticatedWitnessReport(playerRequest, 'human1', 'human1', paths, later);
        expect(active.reports.listForCase(caseId)).toHaveLength(1);
        expect(active.playerReports.listForCase(caseId)).toHaveLength(1);
        expect(active.agents.listIdentities().map(identity => identity.playerUsername)).not.toContain('human1');
        expect(() => fileAuthenticatedWitnessReport(playerRequest, 'thief1', 'thief1', paths, later)).toThrow();
        expect(active.evidence.listFindings(caseId)).toEqual([]);
        const eventCount = active.cases.listEvents(caseId).length;
        active.close(); active = open();
        expect(active.process().processed).toEqual([]);
        expect(active.caseCursor.runPage(100, later).processed).toBe(0);
        expect(active.cases.listEvents(caseId)).toHaveLength(eventCount);
        expect(active.rights.list()).toHaveLength(1);
        expect(fileAuthenticatedWitnessReport(agentRequest, 'nearby', 'nearby', paths, later)).toEqual(agentReport);
        expect(fileAuthenticatedWitnessReport(playerRequest, 'human1', 'human1', paths, later)).toEqual(playerReport);
        expect(active.reports.listForCase(caseId)).toHaveLength(1);
        expect(active.playerReports.listForCase(caseId)).toHaveLength(1);
        for (const store of [active.rights, active.thieving, active.witnessDecisions, active.traceRolls,
            active.engineCursor, active.cases, active.evidence, active.caseCursor, active.reports, active.playerReports])
            expect(store.verifyAuditChain()).toBeTrue();
    } finally { active.close(); }
});

test('unbound Property owner does not block evidence and rights backfill waits for an explicit binding', () => {
    const { value } = fixture(false, false);
    try {
        expect(value.process()).toMatchObject({ nextSequence: 1, blockedEventId: null, processed: [{
            eventId: entry.eventId, rightsProjection: 'unbound-player-owner' }] });
        expect(value.engineCursor.current()).toBe(1);
        expect(value.rights.list()).toEqual([]);
        expect(value.thieving.getOutcome('outcome:acceptance-entry')).not.toBeNull();
        value.agents.createIdentity({ agentId: 'agent-victim', playerUsername: 'victim', displayName: 'Victim',
            background: 'Explicit owner binding.', personalityTraits: ['careful'] }, at);
        expect(backfillPropertyEntryRights(value, 0, 1, 10, later)).toBe(1);
        expect(value.rights.list()).toHaveLength(1);
    } finally { value.close(); }
});

test('rights write before cursor commit survives a full restart without a duplicate violation', () => {
    const { value, open } = fixture(); let active = value;
    try {
        expect(processEngineThievingBatch(active, 0, 10, later).nextSequence).toBe(1);
        expect(active.engineCursor.current()).toBe(0);
        const original = active.rights.list();
        expect(original).toHaveLength(1);
        active.close(); active = open();
        expect(active.process().nextSequence).toBe(1);
        expect(active.rights.list()).toEqual(original);
        expect(active.rights.verifyAuditChain()).toBeTrue();
    } finally { active.close(); }
});

test('historical cursor prefix backfills missing rights once without consuming later engine events', () => {
    const { value, open, paths } = fixture(); let active = value;
    try {
        active.process();
        const original = active.rights.list();
        const raw = new Database(join(paths.agents, '..', 'rights.sqlite'));
        try {
            // Reproduce an older worker that committed its cursor without projecting rights.
            raw.run('DELETE FROM rights_violation_audit'); raw.run('DELETE FROM rights_violation_event');
        } finally { raw.close(true); }
        active.source.append({ ...entry, eventId: 'later-entry' });
        expect(active.rights.verifyAuditChain()).toBeTrue();
        expect(backfillPropertyEntryRights(active, 0, active.engineCursor.current(), 1, later)).toBe(1);
        expect(active.rights.list()).toEqual(original);
        expect(active.thieving.getOutcome('outcome:later-entry')).toBeNull();
        active.close(); active = open();
        expect(backfillPropertyEntryRights(active, 0, active.engineCursor.current(), 100, later)).toBe(1);
        expect(active.rights.list()).toEqual(original);
        expect(active.engineCursor.current()).toBe(1);
        expect(() => backfillPropertyEntryRights(active, -1, 1)).toThrow('range is invalid');
        expect(() => backfillPropertyEntryRights(active, 0, 2)).toThrow('no matching procedure receipt');
        expect(active.engineCursor.current()).toBe(1);
    } finally { active.close(); }
});

test('missing rights audit cannot be regenerated by processing or historical backfill', () => {
    const { value, paths } = fixture();
    try {
        value.process();
        const raw = new Database(join(paths.agents, '..', 'rights.sqlite'));
        try { raw.run('DELETE FROM rights_violation_audit'); } finally { raw.close(true); }
        expect(value.rights.verifyAuditChain()).toBeFalse();
        expect(() => value.process()).toThrow('source audit');
        expect(() => backfillPropertyEntryRights(value, 0, 1)).toThrow('source audit');
        expect(value.engineCursor.current()).toBe(1);
    } finally { value.close(); }
});

test('agent engine-witness intake rejects missing decision sources without writing a report', () => {
    const { value, paths } = fixture();
    try {
        value.process(); value.caseCursor.runPage(100, later);
        const observation = value.thieving.listDiscoveries('outcome:acceptance-entry')
            .find(item => item.source === 'direct-witness' && item.observerAgentId === 'agent-nearby')!;
        const discovery = value.cases.findEventByObservation('discovery-recorded', observation.observationId)!;
        const request = { caseId: discovery.caseId, sourceCaseEventId: discovery.eventId };
        expect(() => fileAuthenticatedWitnessReport(request, 'nearby', 'nearby',
            { ...paths, witnessDecisions: undefined }, later)).toThrow('engine sources are unavailable');
        expect(() => fileAuthenticatedWitnessReport(request, 'thief1', 'thief1', paths, later))
            .toThrow('not bound');
        expect(value.reports.listForCase(discovery.caseId)).toEqual([]);
    } finally { value.close(); }
});

test('missed attention keeps both witnesses ignorant and cannot become a report or a suspect', () => {
    const { value, paths } = fixture(true);
    try {
        expect(value.process().processed[0]?.noticedObservers).toEqual([]);
        value.caseCursor.runPage(100, later);
        for (const username of ['nearby', 'human1']) {
            const decision = value.witnessDecisions.get(entry.eventId, username)!;
            expect(decision.attentionBasisPoints).toBe(0);
            expect(decision.roll >= decision.attentionBasisPoints).toBeTrue();
            expect(() => fileAuthenticatedWitnessReport({ caseId: 'absent-case', sourceCaseEventId: 'absent-discovery' },
                username, username, paths, later)).toThrow();
        }
        const caseId = value.cases.getCaseForOutcome('outcome:acceptance-entry');
        // A separately noticed physical trace is allowed, but cannot identify the hidden actor.
        if (caseId) {
            expect(value.cases.getState(caseId)?.identifications).toEqual([]);
            expect(value.evidence.listFindings(caseId)).toEqual([]);
        }
        expect(value.process().processed).toEqual([]);
    } finally { value.close(); }
});

test('restart after persisted projection but before cursor commit does not duplicate the chain', () => {
    const { value, open } = fixture(); let active = value;
    try {
        active.process();
        const observations = active.thieving.listDiscoveries('outcome:acceptance-entry');
        for (const observation of observations)
            promoteCrimeObservation(observation.observationId, active.thieving, active.cases, active.evidence, later);
        expect(active.caseCursor.current()).toBe(0);
        const caseId = active.cases.getCaseForOutcome('outcome:acceptance-entry')!;
        const events = active.cases.listEvents(caseId), proofs = active.evidence.listEvidence(caseId);
        active.close(); active = open();
        expect(active.caseCursor.runPage(100, later).processed).toBe(observations.length);
        expect(active.cases.listEvents(caseId)).toEqual(events);
        expect(active.evidence.listEvidence(caseId)).toEqual(proofs);
        expect(active.caseCursor.runPage(100, later).processed).toBe(0);
        expect(active.caseCursor.verifyAuditChain()).toBeTrue();
    } finally { active.close(); }
});

test('corrupt engine journal blocks processing and both report branches without advancing cursors', () => {
    const { value, paths } = fixture();
    try {
        value.process(); value.caseCursor.runPage(100, later);
        const observation = value.thieving.listDiscoveries('outcome:acceptance-entry')
            .find(item => item.source === 'direct-witness' && item.observerAgentId === null)!;
        const discovery = value.cases.findEventByObservation('discovery-recorded', observation.observationId)!;
        const before = value.engineCursor.current();
        const raw = new Database(paths.engineEvidence);
        try { raw.run("UPDATE thieving_engine_evidence SET thieving_xp_delta=999 WHERE event_id=?1", [entry.eventId]); }
        finally { raw.close(true); }
        expect(() => value.process()).toThrow();
        expect(value.engineCursor.current()).toBe(before);
        expect(() => fileAuthenticatedWitnessReport({ caseId: discovery.caseId, sourceCaseEventId: discovery.eventId },
            'human1', 'human1', paths, later)).toThrow();
        const agentObservation = value.thieving.listDiscoveries('outcome:acceptance-entry')
            .find(item => item.source === 'direct-witness' && item.observerAgentId === 'agent-nearby')!;
        const agentDiscovery = value.cases.findEventByObservation('discovery-recorded', agentObservation.observationId)!;
        expect(() => fileAuthenticatedWitnessReport({ caseId: agentDiscovery.caseId,
            sourceCaseEventId: agentDiscovery.eventId }, 'nearby', 'nearby', paths, later)).toThrow();
        expect(value.playerReports.verifyAuditChain()).toBeFalse();
    } finally { value.close(); }
});
