import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BotSDK } from '../sdk/index.js';
import { BotActions } from '../sdk/actions.js';
import { SkillExecutor } from '../agent-skills/executor.js';
import { RsSdkSkillRuntime } from '../agent-skills/rs-sdk-runtime.js';
import { validateSkillDefinition } from '../agent-skills/validation.js';
import { AgentStateStore } from '../agent-state/store.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { resolveBoundAvatarAgent } from '../thieving-procedures/event-processor.js';
import { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import { loadWitnessAttentionPolicy } from '../thieving-procedures/witness-attention.js';
import { CrimeCaseStore } from '../crime-cases/store.js';
import { CrimeEvidenceStore } from '../crime-cases/evidence-store.js';
import { resolveCrimeReportIntakePaths } from '../server/gateway/crime-report-paths.js';
import { matchLivePickpocket } from './lib/phase22-live-evidence.js';

const [bundleId, actorFolder, observerFolder, mode] = process.argv.slice(2);
if (!bundleId || !actorFolder || !observerFolder || !['player', 'agent', 'replay'].includes(mode ?? '')
    || process.argv.length !== 6)
    throw new Error('Usage: bun scripts/run-phase22-recognition-live.ts <accepted-bundle> <actor> <observer> <player|agent|replay>');
const root = join(import.meta.dir, '..'), output = join(root, '.local/phase22-live', bundleId);
const paths = resolveCrimeReportIntakePaths(bundleId);
async function connect(folder: string) {
    if (!/^[a-z0-9]{1,12}$/i.test(folder)) throw new Error('Invalid local avatar');
    const settings = Object.fromEntries((await Bun.file(join(root, 'bots', folder, 'bot.env')).text())
        .split(/\r?\n/).filter(line => line.includes('=') && !line.startsWith('#'))
        .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
    if (settings.SERVER !== 'localhost:8888' || settings.GATEWAY_URL !== 'ws://localhost:7780'
        || settings.BOT_USERNAME?.toLowerCase() !== folder.toLowerCase() || !settings.PASSWORD)
        throw new Error('Exact private local test avatar required');
    const sdk = new BotSDK({ botUsername: settings.BOT_USERNAME, password: settings.PASSWORD,
        gatewayUrl: settings.GATEWAY_URL, autoLaunchBrowser: false, autoReconnect: false, showChat: false });
    await sdk.connect();
    await sdk.waitForStateUpdate();
    if (!sdk.getState()?.inGame || sdk.getStateAge() > 5000
        || sdk.getState()?.player?.name.toLowerCase() !== folder.toLowerCase())
        throw new Error('Fresh exact live avatar required');
    return sdk;
}
const actor = await connect(actorFolder), observer = await connect(observerFolder);
const source = new ThievingEvidenceStore(paths.engineEvidence);
const thieving = new ThievingProcedureStore(paths.thieving);
const agents = new AgentStateStore(paths.agents);
const decisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, source, thieving,
    loadWitnessAttentionPolicy(paths.witnessPolicy));
const cases = new CrimeCaseStore(paths.cases, thieving);
const evidence = new CrimeEvidenceStore(paths.caseEvidence, cases, thieving);
async function waitForProductionProjection(eventId: string, observerUsername: string) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const receipt = thieving.getOutcome(`outcome:${eventId}`);
        const decision = decisions.get(eventId, observerUsername);
        if (receipt && decision) {
            const noticed = decision.roll < decision.attentionBasisPoints;
            if (!noticed) return { receipt, decision, noticed, observation: null, caseEvent: null };
            const observation = thieving.listDiscoveries(receipt.receiptId).find(value =>
                value.source === 'direct-witness' && value.sourceEvidenceDigest === decision.decisionDigest
                && value.observerAgentId === decision.observerAgentId);
            const caseEvent = observation
                ? cases.findEventByObservation('discovery-recorded', observation.observationId) : null;
            if (observation && caseEvent) return { receipt, decision, noticed, observation, caseEvent };
        }
        await Bun.sleep(250);
    }
    throw new Error('Production Thieving processor did not project the live event in time');
}
function latestSequence(): number {
    let sequence = 0;
    while (true) {
        const page = source.listAfter(sequence, 1000);
        if (page.length === 0) return sequence;
        sequence = page.at(-1)!.sequence;
        if (page.length < 1000) return sequence;
    }
}
try {
    if (mode === 'replay') {
        const acceptance = await Bun.file(join(output, `recognition-${observerFolder.toLowerCase()}.json`)).json();
        const result = await observer.recognizeWitness(acceptance.eventId, acceptance.targetPlayerSlot, acceptance.commandId);
        if (result.observationId !== acceptance.result.observationId
            || await observer.fileWitnessReport(result.caseId, result.sourceCaseEventId) !== acceptance.reportId)
            throw new Error('Recognition/report process-restart replay changed');
        await Bun.write(join(output, `recognition-${observerFolder.toLowerCase()}-restart.json`),
            JSON.stringify({ passed: true, result, reportId: acceptance.reportId }));
        console.log(JSON.stringify({ passed: true, restartReplay: true, result }));
    } else {
        const observerUsername = observerFolder.toLowerCase();
        if (mode === 'agent' && !resolveBoundAvatarAgent(agents, observerUsername))
            agents.createIdentity({ agentId: `phase22-live.${observerUsername}`, playerUsername: observerUsername,
                displayName: 'Recognition test observer', background: 'Isolated acceptance avatar.', personalityTraits: ['careful'] });
        if (mode === 'player' && resolveBoundAvatarAgent(agents, observerUsername))
            throw new Error('Player-only trial observer must remain unbound');
        const actorActions = new BotActions(actor), observerActions = new BotActions(observer);
        for (const [sdk, actions] of [[actor, actorActions], [observer, observerActions]] as const) {
            const player = sdk.getState()!.player;
            if (!player) throw new Error('Exact live player missing');
            if (player.worldX >= 3090 && player.worldX <= 3150 && player.worldZ >= 3090 && player.worldZ <= 3150)
                if (!(await actions.skipTutorial({ randomizeAppearance: false })).success) throw new Error('Tutorial setup failed');
            if (!(await actions.walkTo(3222, 3218, 1)).success) throw new Error('Trial avatar could not reach location');
        }
        const definition = validateSkillDefinition(await Bun.file(join(root,
            'agent-skills/catalog/procedure.thieving.pickpocket@1.0.0.skill.json')).json());
        let accepted = false;
        for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
            if ((actor.getSkill('Hitpoints')?.level ?? 0) < 4) throw new Error('HP safety limit');
            const before = latestSequence();
            const run = await new SkillExecutor(new RsSdkSkillRuntime(actorActions, actor)).execute(definition,
                { parameters: { 'target-name': 'Man', 'minimum-level': 1 } });
            run.username = actorFolder.toLowerCase();
            await Bun.write(join(output, `recognition-run-${run.runId}.json`), JSON.stringify(run));
            if (run.status !== 'completed') continue;
            const event = matchLivePickpocket(run, source.listAfter(before, 1000));
            const projection = await waitForProductionProjection(event.eventId, observerUsername);
            if (!projection.noticed) continue; // A new theft is a new event; a miss is never rerolled.
            const notice = (await observer.listWitnessObservations()).find(value => value.eventId === event.eventId);
            if (!notice || notice.observationId !== projection.observation!.observationId
                || notice.caseId !== projection.caseEvent!.caseId
                || notice.sourceCaseEventId !== projection.caseEvent!.eventId)
                throw new Error('Authenticated witness observation projection is missing or inconsistent');
            const target = observer.getNearbyPlayers().find(value => value.name.toLowerCase() === actorFolder.toLowerCase());
            if (!target) throw new Error('Exact actor is not visible to observer');
            const commandId = randomUUID();
            const credentialText = await Bun.file(join(root, 'bots', observerFolder, 'bot.env')).text();
            const password = credentialText.split(/\r?\n/).find(line => line.startsWith('PASSWORD='))?.slice(9).trim();
            if (!password) throw new Error('Local test credential missing');
            const post = (body: unknown, auth: 'none' | 'wrong' | 'valid') => fetch(
                `http://localhost:7780/crime/recognize/${encodeURIComponent(observerFolder)}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json',
                        ...(auth === 'none' ? {} : { Authorization: `Bearer ${auth === 'wrong' ? 'invalid-test-password' : password}` }) },
                    body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
            const request = { eventId: event.eventId, targetPlayerSlot: target.index, commandId };
            const checks = {
                missingBearerRejected: (await post(request, 'none')).status === 401,
                wrongPasswordRejected: (await post(request, 'wrong')).status === 401,
                forgedIdentityRejected: (await post({ ...request, recognizedPlayerUsername: actorFolder }, 'valid')).status === 409,
                wrongVisibleTargetRejected: (await post({ ...request, targetPlayerSlot: 2047, commandId: randomUUID() }, 'valid')).status === 409,
            };
            if (Object.values(checks).some(value => !value)) throw new Error('Live recognition security gate failed');
            const result = await observer.recognizeWitness(event.eventId, target.index, commandId);
            const reportId = await observer.fileWitnessReport(result.caseId, result.sourceCaseEventId);
            if (await observer.fileWitnessReport(result.caseId, result.sourceCaseEventId) !== reportId)
                throw new Error('Report replay changed');
            if ((await observer.recognizeWitness(event.eventId, target.index, commandId)).observationId !== result.observationId)
                throw new Error('Recognition replay changed');
            if (cases.getState(result.caseId)?.identifications.length !== 1
                || evidence.listEvidence(result.caseId).filter(value => value.kind === 'direct-identification').length !== 1
                || evidence.listFindings(result.caseId).length !== 0)
                throw new Error('Separate identification/evidence or no-finding invariant failed');
            await Bun.write(join(output, `recognition-${observerUsername}.json`), JSON.stringify({ passed: true,
                mode, bundleId, eventId: event.eventId, commandId, targetPlayerSlot: target.index, result, reportId, checks }));
            console.log(JSON.stringify({ passed: true, mode, eventId: event.eventId, result, reportId }));
            accepted = true;
        }
        if (!accepted) throw new Error('No noticed live theft within bounded trial');
    }
} finally {
    evidence.close(); cases.close(); decisions.close(); agents.close(); thieving.close(); source.close();
    await observer.disconnect(); await actor.disconnect();
}
