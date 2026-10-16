#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { BotSDK } from '../sdk/index.js';
import { runScript } from '../sdk/runner.js';
import { SkillExecutor } from '../agent-skills/executor.js';
import { RsSdkSkillRuntime } from '../agent-skills/rs-sdk-runtime.js';
import { FileSkillRunJournal } from '../agent-skills/journal.js';
import { validateSkillDefinition } from '../agent-skills/validation.js';
import type { SkillRunResult } from '../agent-skills/types.js';
import { AgentStateStore } from '../agent-state/store.js';
import { ThievingEvidenceStore, type EngineThievingEvidenceRecord } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { resolveBoundAvatarAgent } from '../thieving-procedures/event-processor.js';
import { resolveCrimeReportIntakePaths } from '../server/gateway/crime-report-paths.js';
import { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import { loadWitnessAttentionPolicy } from '../thieving-procedures/witness-attention.js';
import { CrimeCaseStore } from '../crime-cases/store.js';
import { CrimeEvidenceStore } from '../crime-cases/evidence-store.js';

const operations = { 'lockpick-door': 'thieve-lockpick', 'container-theft': 'thieve-container',
    'property-burglary': 'thieve-property-entry' } as const;
type Procedure = keyof typeof operations;
/** SDK observations are correlated with independently journaled actual game effects, never substituted for them. */
export function matchLiveLocProcedure(run: SkillRunResult, kind: Procedure,
    candidates: EngineThievingEvidenceRecord[]): EngineThievingEvidenceRecord {
    if (run.status !== 'completed' || !run.username || run.skill.id !== `procedure.thieving.${kind}`
        || run.skill.version !== '1.0.0') throw new Error('Exact completed loc procedure run required');
    const steps = run.events.filter(event => event.type === 'step.succeeded' && event.operation === operations[kind]);
    if (steps.length !== 1) throw new Error('One successful loc procedure operation required');
    const data = steps[0]!.data;
    const target = data?.target as { kind?: string; id?: number; x?: number; z?: number; name?: string } | undefined;
    const xp = data?.thievingXpDelta;
    const inventory = data?.inventoryDelta as Array<{ id: number; delta: number }> | undefined;
    if (data?.outcome !== 'succeeded' || target?.kind !== 'loc' || !Number.isInteger(target.id)
        || !Number.isInteger(target.x) || !Number.isInteger(target.z) || typeof target.name !== 'string'
        || typeof xp !== 'number' || xp <= 0 || !Array.isArray(inventory)) throw new Error('Exact loc and XP observation required');
    const gains = inventory.filter(item => item.delta > 0).map(item => [item.id, item.delta]).sort((a, b) => a[0]! - b[0]!);
    const expectedEffect = kind === 'lockpick-door' ? 'lock-opened' : kind === 'container-theft' ? 'item-transfer' : 'entry-completed';
    const matches = candidates.filter(event => event.playerUsername === run.username && event.procedureKind === kind
        && event.effect === expectedEffect && event.target.kind === 'loc' && event.target.typeId === target.id
        && event.target.x === target.x && event.target.z === target.z && event.target.name.toLowerCase() === target.name!.toLowerCase()
        // UPDATE_STAT exposes floor(engineXP / 10), so a delta can differ by less than one XP.
        && Math.abs(event.thievingXpDelta / 10 - xp) < 1
        && JSON.stringify(event.transferredItems.map(item => [item.itemId, item.quantity]).sort((a, b) => a[0]! - b[0]!)) === JSON.stringify(gains));
    if (matches.length !== 1) throw new Error('No unique exact engine-backed loc procedure outcome');
    return matches[0]!;
}

/** Door scripts can award XP before p_delay(0) commits the authoritative outcome on a later engine tick. */
export async function waitForLiveLocProcedure(run: SkillRunResult, kind: Procedure,
    read: () => EngineThievingEvidenceRecord[], waitOneTick: () => Promise<unknown>): Promise<EngineThievingEvidenceRecord> {
    for (let attempt = 0; attempt < 7; attempt++) {
        const candidates = read();
        if (candidates.length) return matchLiveLocProcedure(run, kind, candidates);
        if (attempt < 6) await waitOneTick();
    }
    throw new Error('SDK success has no authoritative outcome after six engine ticks');
}

async function main(): Promise<void> {
    const [name, kindInput, targetName, xInput, zInput, levelInput, attemptsInput = '8'] = process.argv.slice(2);
    const username = name?.toLowerCase(), kind = kindInput as Procedure;
    const x = Number(xInput), z = Number(zInput), level = Number(levelInput), attempts = Number(attemptsInput);
    if (process.argv.length < 8 || process.argv.length > 9 || !username || !/^[a-z0-9]{1,12}$/.test(username)
        || !Object.hasOwn(operations, kind) || !targetName || !Number.isInteger(x) || !Number.isInteger(z)
        || x < 0 || z < 0 || x > 16383 || z > 16383 || !Number.isInteger(level) || level < 1 || level > 99
        || !Number.isInteger(attempts) || attempts < 1 || attempts > 12)
        throw new Error('Usage: bun scripts/run-phase22-procedures-live.ts <isolated-bot> <lockpick-door|container-theft|property-burglary> <exact-name> <x> <z> <minimum-level> [attempts 1..12]');
    const root = resolve(import.meta.dir, '..');
    const envText = await Bun.file(join(root, 'bots', name!, 'bot.env')).text();
    const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => line.includes('=') && !line.startsWith('#'))
        .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
    if (env.SERVER !== 'localhost:8888' || env.GATEWAY_URL !== 'ws://localhost:7780'
        || env.BOT_USERNAME?.toLowerCase() !== username || !env.PASSWORD) throw new Error('Private localhost test avatar required');
    for (const key of ['BOT_USERNAME', 'PASSWORD', 'SERVER', 'GATEWAY_URL']) process.env[key] = env[key];
    const definition = validateSkillDefinition(await Bun.file(join(root,
        `agent-skills/catalog/procedure.thieving.${kind}@1.0.0.skill.json`)).json());
    const acceptedBundle = process.env.PHASE22_PROCEDURE_BUNDLE;
    const sharedPaths = resolveCrimeReportIntakePaths(acceptedBundle);
    const bundleId = acceptedBundle ?? `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const output = join(root, '.local', 'phase22-live', bundleId); mkdirSync(output, { recursive: true });
    const enginePath = sharedPaths.engineEvidence;
    const agentPath = sharedPaths.agents;
    const procedurePath = sharedPaths.thieving;
    const observerFolder = process.env.PHASE22_PROCEDURE_OBSERVER;
    if (observerFolder && (observerFolder !== 'ZUgnsbd3A' || !acceptedBundle)) throw new Error('Exact agent observer and accepted bundle required');
    let observer: BotSDK | null = null;
    if (observerFolder) {
        const observerEnv = await Bun.file(join(root, 'bots', observerFolder, 'bot.env')).text();
        const values = Object.fromEntries(observerEnv.split(/\r?\n/).filter(line => line.includes('=') && !line.startsWith('#'))
            .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
        if (values.BOT_USERNAME?.toLowerCase() !== observerFolder.toLowerCase() || values.SERVER !== 'localhost:8888'
            || values.GATEWAY_URL !== 'ws://localhost:7780' || !values.PASSWORD) throw new Error('Exact private observer settings required');
        observer = new BotSDK({ botUsername: values.BOT_USERNAME!, password: values.PASSWORD, gatewayUrl: values.GATEWAY_URL,
            autoLaunchBrowser: false, autoReconnect: false, showChat: false });
        await observer.connect();
        if (!observer.getState()?.inGame || observer.getStateAge() > 5000
            || observer.getState()?.player?.name.toLowerCase() !== observerFolder.toLowerCase())
            throw new Error('Fresh exact observer avatar required');
    }
    const summaries: Array<{ runId: string; status: string; engineEventId: string | null; receiptId: string | null;
        noticed?: boolean; recognition?: unknown; reportId?: string; commandId?: string; targetPlayerSlot?: number }> = [];
    let acceptedRecognition = false;
    const needsRecognition = !!observer && kind !== 'lockpick-door';
    let result;
    try {
    result = await runScript(async ({ bot, sdk }) => {
        const state = sdk.getState();
        if (!state?.inGame || sdk.getStateAge() > 5000 || state.player?.name.toLowerCase() !== username)
            throw new Error('Fresh exact test avatar state required');
        if (state.player.worldX >= 3090 && state.player.worldX <= 3150 && state.player.worldZ >= 3090 && state.player.worldZ <= 3150)
            if (!(await bot.skipTutorial({ randomizeAppearance: false })).success) throw new Error('Tutorial setup failed');
        await bot.dismissBlockingUI();
        if (!(await bot.walkTo(x, z, 2)).success) throw new Error('Cannot reach actual configured target');
        const agents = new AgentStateStore(agentPath);
        const procedures = new ThievingProcedureStore(procedurePath);
        try {
            if (!resolveBoundAvatarAgent(agents, username)) {
                if (acceptedBundle) throw new Error('Accepted bundle actor binding required');
                agents.createIdentity({ agentId: `phase22-live.${username}`, playerUsername: username,
                    displayName: 'Isolated procedure test', background: 'Private live acceptance only.', personalityTraits: ['careful'] });
            }
            if (observerFolder && !resolveBoundAvatarAgent(agents, observerFolder.toLowerCase())) throw new Error('Exact agent observer binding required');
            for (let index = 0; index < attempts && !(needsRecognition ? acceptedRecognition : summaries.some(value => value.receiptId)); index++) {
                await bot.dismissBlockingUI();
                if ((sdk.getSkill('Hitpoints')?.level ?? 0) < 4) throw new Error('HP safety limit reached');
                const db = new Database(enginePath, { readonly: true });
                const before = (db.query('SELECT COALESCE(MAX(sequence),0) AS n FROM thieving_engine_evidence').get() as { n: number }).n;
                db.close(true);
                const run = await new SkillExecutor(new RsSdkSkillRuntime(bot, sdk)).execute(definition,
                    { parameters: { 'target-name': targetName, 'target-x': x, 'target-z': z, 'minimum-level': level } });
                run.username = username; await new FileSkillRunJournal(join(output, 'runs')).save(run);
                const summary: typeof summaries[number] = { runId: run.runId, status: run.status, engineEventId: null, receiptId: null };
                summaries.push(summary);
                const source = new ThievingEvidenceStore(enginePath);
                try {
                    if (!source.verifyChain()) throw new Error('Engine source audit invalid');
                    const readCandidates = () => {
                        if (!source.verifyChain()) throw new Error('Engine source audit invalid');
                        return source.listAfter(before, 1000).filter(event => event.playerUsername === username && event.procedureKind === kind);
                    };
                    if (run.status === 'completed') {
                        const matched = await waitForLiveLocProcedure(run, kind, readCandidates, () => sdk.waitForTicks(1));
                        if (kind === 'lockpick-door' && matched.sightSnapshot !== undefined)
                            throw new Error('Lockpick unexpectedly produced witness sight evidence');
                        const deadline = Date.now() + 30_000;
                        let receipt = procedures.getOutcome(`outcome:${matched.eventId}`);
                        while (!receipt && Date.now() < deadline) {
                            await Bun.sleep(250);
                            receipt = procedures.getOutcome(`outcome:${matched.eventId}`);
                        }
                        if (!receipt) throw new Error('Production Thieving processor did not ingest the live event in time');
                        if (kind === 'lockpick-door' && procedures.listDiscoveries(receipt.receiptId).length !== 0)
                            throw new Error('Lockpick unexpectedly produced witness discovery');
                        summary.engineEventId = matched.eventId; summary.receiptId = receipt.receiptId;
                        if (needsRecognition && observer && observerFolder) {
                            const decisions = new WitnessAttentionDecisionStore(sharedPaths.witnessDecisions, source, procedures,
                                loadWitnessAttentionPolicy(sharedPaths.witnessPolicy));
                            const cases = new CrimeCaseStore(sharedPaths.cases, procedures);
                            const evidence = new CrimeEvidenceStore(sharedPaths.caseEvidence, cases, procedures);
                            try {
                                const projectionDeadline = Date.now() + 30_000;
                                // A successful entry can end on either side of an opaque wall.
                                // Absence from the real sight snapshot is an unseen event, not a
                                // fabricated attention decision or an invalid recognition request.
                                const candidate = matched.sightSnapshot?.candidates.some(value => value.username === observerFolder.toLowerCase());
                                let decision = candidate ? decisions.get(matched.eventId, observerFolder.toLowerCase()) : null;
                                while (candidate && !decision && Date.now() < projectionDeadline) {
                                    await Bun.sleep(250);
                                    decision = decisions.get(matched.eventId, observerFolder.toLowerCase());
                                }
                                if (candidate && !decision) throw new Error('Production watcher did not decide witness attention in time');
                                const noticed = !!decision && decision.roll < decision.attentionBasisPoints;
                                summary.noticed = noticed;
                                if (noticed && decision) {
                                    let observation = procedures.listDiscoveries(receipt.receiptId).find(value =>
                                        value.source === 'direct-witness' && value.sourceEvidenceDigest === decision!.decisionDigest);
                                    let caseEvent = observation
                                        ? cases.findEventByObservation('discovery-recorded', observation.observationId) : null;
                                    while ((!observation || !caseEvent) && Date.now() < projectionDeadline) {
                                        await Bun.sleep(250);
                                        observation = procedures.listDiscoveries(receipt.receiptId).find(value =>
                                            value.source === 'direct-witness' && value.sourceEvidenceDigest === decision!.decisionDigest);
                                        caseEvent = observation
                                            ? cases.findEventByObservation('discovery-recorded', observation.observationId) : null;
                                    }
                                    if (!observation || !caseEvent) throw new Error('Production watcher did not create the witness case in time');
                                    const notice = (await observer.listWitnessObservations()).find(value => value.eventId === matched.eventId);
                                    if (!notice || notice.observationId !== observation.observationId
                                        || notice.caseId !== caseEvent.caseId || notice.sourceCaseEventId !== caseEvent.eventId)
                                        throw new Error('Authenticated witness observation projection is missing or inconsistent');
                                    const visible = observer.getNearbyPlayers().find(player => player.name.toLowerCase() === username);
                                    if (!visible) throw new Error('Exact actor no longer visible to observer');
                                    const commandId = randomUUID();
                                    const recognition = await observer.recognizeWitness(matched.eventId, visible.index, commandId);
                                    const reportId = await observer.fileWitnessReport(recognition.caseId, recognition.sourceCaseEventId);
                                    if (await observer.fileWitnessReport(recognition.caseId, recognition.sourceCaseEventId) !== reportId
                                        || (await observer.recognizeWitness(matched.eventId, visible.index, commandId)).observationId !== recognition.observationId)
                                        throw new Error('Live loc recognition or report replay changed');
                                    if (cases.getState(recognition.caseId)?.identifications.length !== 1
                                        || evidence.listEvidence(recognition.caseId).filter(value => value.kind === 'direct-identification').length !== 1
                                        || evidence.listFindings(recognition.caseId).length !== 0) throw new Error('Identification/evidence/no-finding invariant failed');
                                    Object.assign(summary, { recognition, reportId, commandId, targetPlayerSlot: visible.index });
                                    acceptedRecognition = true;
                                }
                            } finally { evidence.close(); cases.close(); decisions.close(); }
                        }
                    } else if (readCandidates().length !== 0) throw new Error('Failed SDK attempt nevertheless produced committed engine effect');
                } finally { source.close(); }
                console.log(JSON.stringify(summary)); await sdk.waitForTicks(10);
            }
            if (!summaries.some(value => value.receiptId) || (needsRecognition && !acceptedRecognition)
                || !procedures.verifyAuditChain()) throw new Error('No actual verified procedure and required recognition success');
            return { successes: summaries.filter(value => value.receiptId).length, procedureAuditValid: true };
        } finally { procedures.close(); agents.close(); }
    }, { timeout: 240000, printState: false });
    } finally { if (observer) await observer.disconnect(); }
    let restartVerified = false;
    if (result.success) {
        const source = new ThievingEvidenceStore(enginePath), procedures = new ThievingProcedureStore(procedurePath);
        try {
            if (!source.verifyChain() || !procedures.verifyAuditChain()) throw new Error('Reopened source audit invalid');
            for (const summary of summaries.filter(value => value.receiptId)) {
                const receipt = procedures.getOutcome(summary.receiptId!);
                if (!receipt || receipt.sourceEventId !== summary.engineEventId) throw new Error('Reopened receipt changed');
            }
            restartVerified = true;
        } finally { procedures.close(); source.close(); }
    }
    await Bun.write(join(output, `${kind}-acceptance.json`), JSON.stringify({ schemaVersion: 1, bundleId, passed: result.success && restartVerified,
        restartVerified, skill: { id: definition.id, version: definition.version }, target: { name: targetName, x, z },
        attempts: summaries, result: result.result ?? null, scope: needsRecognition
            ? 'Actual private engine loc procedure, independent server recognition and explicit replay-stable agent report; no guilt or publication.'
            : 'Actual private engine lock/loc procedure only; no fixture source, witness discovery, guilt or publication.' }, null, 2));
    console.log(JSON.stringify({ bundleId, passed: result.success && restartVerified }));
    if (!result.success || !restartVerified) process.exitCode = 1;
}
if (import.meta.main) await main();
