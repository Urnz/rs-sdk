import { join } from 'node:path';
import { BotSDK } from '../sdk/index.js';
import { resolveCrimeReportIntakePaths } from '../server/gateway/crime-report-paths.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import { loadWitnessAttentionPolicy } from '../thieving-procedures/witness-attention.js';
import { CrimeCaseStore } from '../crime-cases/store.js';
import { PlayerWitnessReportStore } from '../crime-cases/player-witness-report-store.js';

const [bundleId, observerFolder, offenderFolder, option] = process.argv.slice(2);
const offline = option === '--offline-check';
if (!bundleId || !observerFolder || !offenderFolder || (option !== undefined && !offline) || process.argv.length > 6)
    throw new Error(
        'Usage: bun scripts/run-phase22-witness-http-live.ts <accepted-bundle> <observer-test-bot> <offender-test-bot> [--offline-check]',
    );
const root = join(import.meta.dir, '..'),
    paths = resolveCrimeReportIntakePaths(bundleId);
async function settings(name: string) {
    if (!/^[a-z0-9]{1,12}$/i.test(name)) throw new Error('Invalid test bot');
    const text = await Bun.file(join(root, 'bots', name, 'bot.env')).text();
    const value = Object.fromEntries(
        text
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
        throw new Error('Private local test bot required');
    return value;
}
const observer = await settings(observerFolder),
    offender = await settings(offenderFolder);
if (observer.BOT_USERNAME === offender.BOT_USERNAME) throw new Error('Separate avatars required');
const source = new ThievingEvidenceStore(paths.engineEvidence!);
const thieving = new ThievingProcedureStore(paths.thieving);
const decisions = new WitnessAttentionDecisionStore(
    paths.witnessDecisions!,
    source,
    thieving,
    loadWitnessAttentionPolicy(paths.witnessPolicy!),
);
const cases = new CrimeCaseStore(paths.cases, thieving);
const reports = new PlayerWitnessReportStore(paths.playerReports!, { cases, thieving, witnessDecisions: decisions });
const sdk = new BotSDK({
    botUsername: observer.BOT_USERNAME!,
    password: observer.PASSWORD,
    gatewayUrl: observer.GATEWAY_URL,
    autoLaunchBrowser: false,
    autoReconnect: false,
    connectionMode: 'observe',
    showChat: false,
});
const checks: Record<string, boolean> = {};
try {
    if (offline) {
        const response = await fetch(
            `http://localhost:7780/crime/report/${encodeURIComponent(observer.BOT_USERNAME!)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${observer.PASSWORD}` },
                body: JSON.stringify({ caseId: 'offline-case', sourceCaseEventId: 'offline-discovery' }),
                signal: AbortSignal.timeout(25_000),
            },
        );
        const body = await response.json() as { error?: string };
        if (response.headers.get('X-Crime-Report-Acceptance-Bundle') !== bundleId || response.status !== 409
            || body.error !== 'Matching live avatar is required')
            throw new Error('Offline acceptance avatar was not rejected');
        await Bun.write(
            join(root, '.local/phase22-live', bundleId, 'http-offline-acceptance.json'),
            JSON.stringify({
                schemaVersion: 1,
                bundleId,
                passed: true,
                authenticatedOfflineAvatarRejected: true,
                status: response.status,
            }),
        );
        console.log(JSON.stringify({ passed: true, authenticatedOfflineAvatarRejected: true }));
    } else {
        await sdk.connect();
        const bundle = await Bun.file(join(root, '.local/phase22-live', bundleId, 'acceptance.json')).json();
        const noticed = bundle.attempts.find((attempt: any) => attempt.observerNoticed && attempt.observationId);
        if (!noticed) throw new Error('Bundle has no noticed observer');
        const decision = decisions.get(noticed.engineEventId, observer.BOT_USERNAME!.toLowerCase());
        if (!decision || decision.observerAgentId !== null || decision.roll >= decision.attentionBasisPoints)
            throw new Error('Exact player-only observer proof required');
        const discovery = cases.findEventByObservation('discovery-recorded', noticed.observationId)!;
        if (!discovery) throw new Error('Discovery case absent');
        const request = { caseId: discovery.caseId, sourceCaseEventId: discovery.eventId };
        const post = (name: string, password?: string, body: unknown = request) =>
            fetch(`http://localhost:7780/crime/report/${encodeURIComponent(name)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(password ? { Authorization: `Bearer ${password}` } : {}),
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(25_000),
            });
        const unauthenticated = await post(observer.BOT_USERNAME!);
        if (unauthenticated.headers.get('X-Crime-Report-Acceptance-Bundle') !== bundleId)
            throw new Error('Gateway is not in this isolated acceptance mode');
        checks.missingBearerRejected = unauthenticated.status === 401;
        checks.wrongPasswordRejected =
            (await post(observer.BOT_USERNAME!, 'invalid-acceptance-password')).status === 401;
        checks.wrongAvatarRejected = (await post(offender.BOT_USERNAME!, offender.PASSWORD)).status === 409;
        checks.forgedIdentityFieldRejected =
            (
                await post(observer.BOT_USERNAME!, observer.PASSWORD, {
                    ...request,
                    reporterUsername: offender.BOT_USERNAME,
                })
            ).status === 409;
        const reportId = await sdk.fileWitnessReport(request.caseId, request.sourceCaseEventId);
        checks.exactReplay = (await sdk.fileWitnessReport(request.caseId, request.sourceCaseEventId)) === reportId;
        checks.oneReport =
            reports.listForCase(request.caseId).length === 1 &&
            reports.get(reportId)?.reporterUsername === observer.BOT_USERNAME!.toLowerCase();
        checks.noAutomaticIdentificationOrFinding =
            cases.getState(request.caseId)!.identifications.length === 0 &&
            cases.getState(request.caseId)!.legalFinding === null;
        checks.auditsValid = reports.verifyAuditChain() && cases.verifyAuditChain() && decisions.verifyAuditChain();
        if (Object.values(checks).some((value) => !value)) throw new Error('HTTP acceptance check failed');
        await Bun.write(
            join(root, '.local/phase22-live', bundleId, 'http-acceptance.json'),
            JSON.stringify(
                {
                    schemaVersion: 1,
                    bundleId,
                    passed: true,
                    reportId,
                    caseId: request.caseId,
                    checks,
                    scope: 'real login and live-avatar HTTP notice; no identification, finding or publication',
                },
                null,
                2,
            ),
        );
        console.log(JSON.stringify({ passed: true, reportId, checks }));
    }
} finally {
    await sdk.disconnect();
    reports.close();
    cases.close();
    decisions.close();
    thieving.close();
    source.close();
}
