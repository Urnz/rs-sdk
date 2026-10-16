#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { runScript } from '../sdk/runner.js';
import { BotSDK } from '../sdk/index.js';
import { BotActions } from '../sdk/actions.js';
import { SkillExecutor } from '../agent-skills/executor.js';
import { RsSdkSkillRuntime } from '../agent-skills/rs-sdk-runtime.js';
import { FileSkillRunJournal } from '../agent-skills/journal.js';
import { validateSkillDefinition } from '../agent-skills/validation.js';
import { AgentStateStore } from '../agent-state/store.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { ingestEngineThievingOutcome } from '../thieving-procedures/engine-bridge.js';
import { resolveBoundAvatarAgent } from '../thieving-procedures/event-processor.js';
import { matchLivePickpocket } from './lib/phase22-live-evidence.js';
import { loadWitnessAttentionPolicy } from '../thieving-procedures/witness-attention.js';
import { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import { CrimeCaseStore } from '../crime-cases/store.js';
import { CrimeEvidenceStore } from '../crime-cases/evidence-store.js';
import { CrimeObservationCursorStore } from '../crime-cases/observation-ingest.js';

// Explicit local test only: no publication, autonomous enrollment, sanctions or existing-save edits.
const username = process.argv[2]?.toLowerCase();
if (!username || !/^[a-z0-9]{1,12}$/.test(username))
    throw new Error('Usage: bun scripts/run-phase22-pickpocket-live.ts <new-local-test-bot>');
const root = resolve(import.meta.dir, '..');
async function localSettings(name: string): Promise<Record<string, string>> {
    if (!/^[a-z0-9]{1,12}$/i.test(name)) throw new Error('Invalid local trial bot name');
    const environment = await Bun.file(join(root, 'bots', name, 'bot.env')).text();
    const value = Object.fromEntries(
        environment
            .split(/\r?\n/)
            .filter((line) => line.includes('=') && !line.startsWith('#'))
            .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
    );
    if (
        value.SERVER !== 'localhost:8888' ||
        value.GATEWAY_URL !== 'ws://localhost:7780' ||
        value.BOT_USERNAME?.toLowerCase() !== name.toLowerCase() ||
        !value.PASSWORD
    )
        throw new Error('Live trial requires this bot on the private localhost emulator');
    return value;
}
if (process.argv.length > 4)
    throw new Error('Usage: bun scripts/run-phase22-pickpocket-live.ts <thief-test-bot> [observer-test-bot]');
const settings = await localSettings(process.argv[2]!);
const observerSettings = process.argv[3] ? await localSettings(process.argv[3]) : null;
const observerUsername = observerSettings?.BOT_USERNAME?.toLowerCase();
if (observerUsername === username) throw new Error('Observer must be a separate test avatar');
// Prevent ambient environment credentials or server overrides from selecting another account/server.
for (const key of ['BOT_USERNAME', 'PASSWORD', 'SERVER', 'GATEWAY_URL']) process.env[key] = settings[key];
const definition = validateSkillDefinition(
    await Bun.file(join(root, 'agent-skills/catalog/procedure.thieving.pickpocket@1.0.0.skill.json')).json(),
);
const bundleId = `pickpocket-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const output = join(root, '.local', 'phase22-live', bundleId);
mkdirSync(output, { recursive: true });
const enginePath = join(root, 'server/engine/data/mods/thieving-engine-evidence.sqlite');
function latestSequence(): number {
    if (!existsSync(enginePath)) return 0;
    const db = new Database(enginePath, { readonly: true });
    try {
        return (
            db.query('SELECT COALESCE(MAX(sequence),0) AS sequence FROM thieving_engine_evidence').get() as {
                sequence: number;
            }
        ).sequence;
    } finally {
        db.close(true);
    }
}
const witnessPolicy = loadWitnessAttentionPolicy(join(root, 'config/thieving-witness-attention.json'));
const attemptSummaries: Array<{
    runId: string;
    status: string;
    engineEventId: string | null;
    receiptId: string | null;
    observerCaptured?: boolean;
    observerNoticed?: boolean;
    observationId?: string | null;
}> = [];
const result = await runScript(
    async ({ bot, sdk }) => {
        const observer = observerSettings
            ? new BotSDK({
                  botUsername: observerSettings.BOT_USERNAME!,
                  password: observerSettings.PASSWORD,
                  gatewayUrl: observerSettings.GATEWAY_URL,
                  autoLaunchBrowser: false,
                  autoReconnect: false,
                  showChat: false,
              })
            : null;
        try {
            if (observer) {
                await observer.connect();
                const state = observer.getState();
                if (
                    !state?.inGame ||
                    !state.player ||
                    observer.getStateAge() > 5_000 ||
                    state.player?.name.toLowerCase() !== observerUsername
                )
                    throw new Error('Fresh exact observer avatar required');
                const actions = new BotActions(observer);
                if (
                    state.player.worldX >= 3090 &&
                    state.player.worldX <= 3150 &&
                    state.player.worldZ >= 3090 &&
                    state.player.worldZ <= 3150 &&
                    !(await actions.skipTutorial({ randomizeAppearance: false })).success
                )
                    throw new Error('Observer tutorial setup failed');
                if (!(await actions.walkTo(3222, 3218, 1)).success)
                    throw new Error('Observer could not reach the trial area');
            }
            const initial = sdk.getState();
            if (!initial?.inGame || sdk.getStateAge() > 5_000 || initial.player?.name?.toLowerCase() !== username)
                throw new Error('Fresh state of the exact test avatar is required');
            if (
                initial.player.worldX >= 3090 &&
                initial.player.worldX <= 3150 &&
                initial.player.worldZ >= 3090 &&
                initial.player.worldZ <= 3150
            ) {
                const skipped = await bot.skipTutorial({ randomizeAppearance: false });
                if (!skipped.success) throw new Error('Test bot tutorial setup did not complete');
            }
            await bot.dismissBlockingUI();
            const moved = await bot.walkTo(3222, 3218, 3);
            if (!moved.success) throw new Error('Test bot could not reach the Lumbridge trial area');
            const agents = new AgentStateStore(join(output, 'agents.sqlite'));
            const procedures = new ThievingProcedureStore(join(output, 'procedures.sqlite'));
            const agentId = `phase22-live.${username}`;
            let successes = 0;
            try {
                agents.createIdentity({
                    agentId,
                    playerUsername: username,
                    displayName: 'Local Thieving test',
                    background: 'Isolated live acceptance fixture.',
                    personalityTraits: ['careful'],
                });
                for (let attempt = 0; attempt < 8 && successes < 2; attempt++) {
                    if ((sdk.getSkill('Hitpoints')?.level ?? 0) < 4)
                        throw new Error('Trial stopped at its HP safety limit');
                    const before = latestSequence();
                    const run = await new SkillExecutor(new RsSdkSkillRuntime(bot, sdk)).execute(definition, {
                        parameters: { 'target-name': 'Man', 'minimum-level': 1 },
                    });
                    run.username = username;
                    await new FileSkillRunJournal(join(output, 'runs')).save(run);
                    const summary = {
                        runId: run.runId,
                        status: run.status,
                        engineEventId: null as string | null,
                        receiptId: null as string | null,
                    };
                    attemptSummaries.push(summary);
                    let engineEventId: string | null = null,
                        receiptId: string | null = null;
                    if (run.status === 'completed') {
                        if (!existsSync(enginePath)) throw new Error('SDK success has no engine evidence journal');
                        const source = new ThievingEvidenceStore(enginePath);
                        try {
                            if (!source.verifyChain()) throw new Error('Live engine evidence chain is invalid');
                            const matched = matchLivePickpocket(run, source.listAfter(before, 1000));
                            const receipt = ingestEngineThievingOutcome(matched.eventId, source, procedures, (avatar) =>
                                resolveBoundAvatarAgent(agents, avatar),
                            );
                            engineEventId = matched.eventId;
                            receiptId = receipt.receiptId;
                            if (observerUsername) {
                                const captured = matched.sightSnapshot?.candidates.some(
                                    (candidate) => candidate.username === observerUsername,
                                );
                                if (!captured)
                                    throw new Error('Live engine did not capture the exact observer in line of sight');
                                const decisions = new WitnessAttentionDecisionStore(
                                    join(output, 'witness.sqlite'),
                                    source,
                                    procedures,
                                    witnessPolicy,
                                );
                                try {
                                    const decision = decisions.decide(matched.eventId, observerUsername, () => null);
                                    Object.assign(summary, {
                                        observerCaptured: true,
                                        observerNoticed: decision.noticed,
                                        observationId: decision.observation?.observationId ?? null,
                                    });
                                    const cases = new CrimeCaseStore(join(output, 'cases.sqlite'), procedures);
                                    const evidence = new CrimeEvidenceStore(
                                        join(output, 'evidence.sqlite'),
                                        cases,
                                        procedures,
                                    );
                                    const cursor = new CrimeObservationCursorStore(
                                        join(output, 'case-cursor.sqlite'),
                                        procedures,
                                        cases,
                                        evidence,
                                    );
                                    try {
                                        cursor.runPage();
                                        const caseId = cases.getCaseForOutcome(receipt.receiptId);
                                        if (
                                            caseId &&
                                            (cases.getState(caseId)!.identifications.length !== 0 ||
                                                evidence.listFindings(caseId).length !== 0)
                                        )
                                            throw new Error('Witness attention leaked identification or guilt');
                                        if (
                                            !decisions.verifyAuditChain() ||
                                            !cases.verifyAuditChain() ||
                                            !evidence.verifyAuditChain() ||
                                            !cursor.verifyAuditChain()
                                        )
                                            throw new Error('Live witness/case chain is invalid');
                                    } finally {
                                        cursor.close();
                                        evidence.close();
                                        cases.close();
                                    }
                                } finally {
                                    decisions.close();
                                }
                            }
                            successes++;
                        } finally {
                            source.close();
                        }
                    }
                    Object.assign(summary, { engineEventId, receiptId });
                    console.log(JSON.stringify(attemptSummaries.at(-1)));
                    await sdk.waitForTicks(10);
                }
                if (successes !== 2 || !procedures.verifyAuditChain())
                    throw new Error('Two independently journaled engine-backed successes were not achieved');
                return { successes, procedureAuditValid: true };
            } finally {
                procedures.close();
                agents.close();
            }
        } finally {
            if (observer) await observer.disconnect();
        }
    },
    { timeout: 240_000, printState: false },
);
let restartVerified = false;
if (result.success) {
    const source = new ThievingEvidenceStore(enginePath);
    const agents = new AgentStateStore(join(output, 'agents.sqlite'));
    const procedures = new ThievingProcedureStore(join(output, 'procedures.sqlite'));
    try {
        if (!source.verifyChain() || !procedures.verifyAuditChain()) throw new Error('Reopened journals are invalid');
        for (const attempt of attemptSummaries.filter((value) => value.receiptId)) {
            const original = procedures.getOutcome(attempt.receiptId!);
            const replay = ingestEngineThievingOutcome(attempt.engineEventId!, source, procedures, (avatar) =>
                resolveBoundAvatarAgent(agents, avatar),
            );
            if (!original || JSON.stringify(original) !== JSON.stringify(replay))
                throw new Error('Reopened receipt replay changed');
            if (observerUsername) {
                const decisions = new WitnessAttentionDecisionStore(
                    join(output, 'witness.sqlite'),
                    source,
                    procedures,
                    witnessPolicy,
                );
                try {
                    const first = decisions.get(attempt.engineEventId!, observerUsername);
                    const replay = decisions.decide(attempt.engineEventId!, observerUsername, () => null);
                    if (
                        !first ||
                        JSON.stringify(first) !== JSON.stringify(replay.decision) ||
                        replay.noticed !== attempt.observerNoticed ||
                        !decisions.verifyAuditChain()
                    )
                        throw new Error('Reopened attention decision changed or rerolled');
                } finally {
                    decisions.close();
                }
            }
        }
        restartVerified = true;
    } finally {
        source.close();
        procedures.close();
        agents.close();
    }
}
const bundle = {
    schemaVersion: 1,
    bundleId,
    skill: { id: definition.id, version: definition.version },
    passed: result.success && restartVerified,
    restartVerified,
    attempts: attemptSummaries,
    result: result.result ?? null,
    error: result.success ? null : 'Live trial failed; inspect the local attempt journals',
    scope: observerUsername
        ? 'private-engine pickpocket and player-only attention/case; no live HTTP report, identification, finding or publication'
        : 'private-engine pickpocket only; no witness, finding, publication or autonomous authorization',
};
writeFileSync(join(output, 'acceptance.json'), JSON.stringify(bundle, null, 2));
console.log(JSON.stringify({ bundleId, passed: bundle.passed, attempts: attemptSummaries.length }));
if (!result.success) process.exitCode = 1;
