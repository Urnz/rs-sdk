#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentStateStore } from '../agent-state/store.js';
import { RightsViolationStore } from '../rights-violations/store.js';
import { CrimeCaseStore, CrimeEvidenceStore, CrimeObservationCursorStore } from '../crime-cases/index.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog,
    loadHousingUnitCatalog } from '../housing/config.js';
import { loadHousingSecurityPolicy } from '../housing/security.js';
import { HousingTraceRollStore } from '../housing/trace-roll-store.js';
import { loadPropertyCatalog } from '../server/engine/src/mods/Properties.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { runThievingProcessorPage, ThievingEventCursorStore } from './cursor-store.js';
import { ThievingProcedureStore } from './store.js';
import { loadWitnessAttentionPolicy } from './witness-attention.js';
import { WitnessAttentionDecisionStore } from './witness-decision-store.js';
import { backfillPropertyEntryRights } from './rights-backfill.js';
import { resolveCrimeReportIntakePaths } from '../server/gateway/crime-report-paths.js';

const once = process.argv.includes('--once');
if (process.argv.includes('--help')) {
    console.log('Usage: bun thieving-procedures/watch.ts [--once]');
    process.exit(0);
}
if (process.argv.slice(2).some(value => value !== '--once')) throw new Error('Unknown watcher option');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = join(root, 'config');
const intakePaths = resolveCrimeReportIntakePaths(process.env.CRIME_REPORT_ACCEPTANCE_BUNDLE, root);
const crime = dirname(intakePaths.thieving);
const sourcePath = intakePaths.engineEvidence;
const agentPath = intakePaths.agents;
if (!existsSync(agentPath))
    throw new Error('Agent-state database must exist before starting the watcher');

const properties = loadPropertyCatalog(join(config, 'properties.json'));
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const securityPolicy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy,
    new Set(properties.properties.map(value => value.propertyId)));
const witnessPolicy = loadWitnessAttentionPolicy(join(config, 'thieving-witness-attention.json'));

const closers: Array<() => void> = [];
function opened<T extends { close(): void }>(value: T): T { closers.push(() => value.close()); return value; }
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

try {
    const source = opened(new ThievingEvidenceStore(sourcePath));
    const thieving = opened(new ThievingProcedureStore(intakePaths.thieving));
    const agents = opened(new AgentStateStore(agentPath));
    const rights = opened(new RightsViolationStore(join(crime, 'rights-violations.sqlite')));
    const traceRolls = opened(new HousingTraceRollStore(join(crime, 'housing-trace-rolls.sqlite'), thieving));
    const witnessDecisions = opened(new WitnessAttentionDecisionStore(intakePaths.witnessDecisions,
        source, thieving, witnessPolicy));
    const cursor = opened(new ThievingEventCursorStore(join(crime, 'engine-cursor.sqlite'), source, thieving));
    const cases = opened(new CrimeCaseStore(intakePaths.cases, thieving));
    const evidence = opened(new CrimeEvidenceStore(intakePaths.caseEvidence, cases, thieving));
    const observationCursor = opened(new CrimeObservationCursorStore(join(crime, 'observation-cursor.sqlite'),
        thieving, cases, evidence));
    const deps = { source, thieving, agents, rights, traceRolls, witnessDecisions,
        properties, hierarchy, effects, securityPolicy, units, witnessPolicy };
    // Old cursor versions advanced without writing rights facts. Reusing stable IDs makes
    // this bounded prefix repair safe after a crash, without inventing historical audit.
    if (!cursor.verifyAuditChain()) throw new Error('Thieving cursor or source audit is invalid before rights backfill');
    const throughSequence = cursor.current();
    let rightsSequence = 0;
    while (rightsSequence < throughSequence) {
        if (stopping) break;
        rightsSequence = backfillPropertyEntryRights(deps, rightsSequence, throughSequence, 100,
            new Date().toISOString(), (eventId, digest) => cursor.getSkipped(eventId, digest) !== null);
    }
    while (!stopping) {
        const result = runThievingProcessorPage(deps, cursor);
        if (result.processed.length > 0) console.log(JSON.stringify(result));
        const observations = observationCursor.runPage();
        if (observations.processed > 0) console.log(JSON.stringify({ crimeObservations: observations }));
        if (result.skipped.length > 0) console.error(JSON.stringify({ skippedThievingEvents: result.skipped }));
        if (once) break;
        if (result.processed.length < 100 && observations.processed < 100)
            await new Promise<void>(done => setTimeout(done, 5_000));
    }
} finally {
    for (const close of closers.reverse()) close();
}
