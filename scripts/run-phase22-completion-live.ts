import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { BotSDK } from '../sdk/index.js';
import { BotActions } from '../sdk/actions.js';
import { assertPhase22CompletionSeed } from './lib/phase22-acceptance.js';

const [bundleId, actor, playerObserver, agentObserver, resume] = process.argv.slice(2);
if (!bundleId || !/^[a-zA-Z0-9-]{2,100}$/.test(bundleId)
    || actor !== 'rKFXWHZFk' || playerObserver !== 'YJLhy3Vpb' || agentObserver !== 'ZUgnsbd3A'
    || process.argv.length > 7 || (resume !== undefined && resume !== '--resume-procedures'))
    throw new Error('This acceptance orchestrator is limited to the three dedicated Phase22 test avatars');
const root = resolve(import.meta.dir, '..'), output = join(root, '.local/phase22-live', bundleId);
mkdirSync(output, { recursive: true });
assertPhase22CompletionSeed(output, bundleId);
const bun = process.execPath;
const runTag = new Date().toISOString().replace(/[:.]/g, '-');
const pwsh = Bun.which('pwsh');
if (!pwsh) throw new Error('PowerShell 7 (pwsh) must be available on PATH');
const env: Record<string, string | undefined> = { ...process.env, ENGINE_ADMIN_TOKEN: randomUUID(), LOGIN_SERVER: 'false',
    CRIME_REPORT_ACCEPTANCE_BUNDLE: bundleId,
    PROPERTY_STATE_DB: join(output, 'engine-properties.sqlite') };
for (const key of ['BOT_USERNAME', 'PASSWORD', 'SERVER', 'GATEWAY_URL']) delete env[key];
let sequence = 0;
async function run(args: string[], label: string, cwd = root) {
    const log = join(output, `completion-${runTag}-${++sequence}-${label}`);
    // Background services can inherit pipe handles on Windows. Await the command,
    // not EOF on a pipe that remains open in a spawned engine/logger process.
    const child = Bun.spawn(args, { cwd, env, stdout: Bun.file(`${log}.out.log`), stderr: Bun.file(`${log}.err.log`) });
    const code = await child.exited;
    if (code !== 0) throw new Error(`Acceptance ${label} failed (exit ${code}); see ignored bundle log`);
    console.log(JSON.stringify({ stage: label, passed: true }));
}
const stop = () => run([pwsh, '-NoProfile', '-File', 'scripts/stop-local.ps1'], 'stop-stack');
async function start() {
    await run([pwsh, '-NoProfile', '-File', 'scripts/start-local.ps1', '-NoBot',
        '-GatewayLoginAuthentication', '-EnableThievingProcessor'], 'start-stack');
    if (env.CRIME_REPORT_ACCEPTANCE_BUNDLE) {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const status = await fetch('http://localhost:7780/status').then(response => response.json()) as any;
            if (status.authentication?.enabled && status.authentication.loginServerConnected) return;
            await Bun.sleep(250);
        }
        throw new Error('Authenticated gateway login channel did not become ready');
    }
}
const clients: ReturnType<typeof Bun.spawn>[] = [];
async function settings(name: string) {
    const value = Object.fromEntries((await Bun.file(join(root, 'bots', name, 'bot.env')).text())
        .split(/\r?\n/).filter(line => line.includes('=') && !line.startsWith('#'))
        .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
    if (value.SERVER !== 'localhost:8888' || value.GATEWAY_URL !== 'ws://localhost:7780'
        || value.BOT_USERNAME?.toLowerCase() !== name.toLowerCase() || !value.PASSWORD) throw new Error('Local test credentials required');
    return value;
}
async function spawnClients(names: string[]) {
    for (const name of names) {
        const clientEnv = { ...env }; delete clientEnv.ENGINE_ADMIN_TOKEN;
        const child = Bun.spawn([bun, 'src/lite/runner.ts', name], { cwd: join(root, 'server/webclient'),
            env: clientEnv, stdout: Bun.file(join(output, `client-${name}.out.log`)),
            stderr: Bun.file(join(output, `client-${name}.err.log`)) });
        clients.push(child);
        const config = await settings(name);
        const sdk = new BotSDK({ botUsername: config.BOT_USERNAME!, password: config.PASSWORD,
            gatewayUrl: config.GATEWAY_URL, autoLaunchBrowser: false, autoReconnect: false, showChat: false });
        try {
            await sdk.connect();
            // A newly launched client resets its tick counter; cached session ticks
            // cannot be a waitForTicks baseline. Require actual new state packets.
            await sdk.waitForStateUpdate(); await sdk.waitForStateUpdate();
            const state = sdk.getState();
            if (!state?.inGame || !state.player || sdk.getStateAge() > 5000) throw new Error('Live client not ready');
            const player = state.player;
            if (player.worldX >= 3090 && player.worldX <= 3150 && player.worldZ >= 3090 && player.worldZ <= 3150) {
                const result = await new BotActions(sdk).skipTutorial({ randomizeAppearance: false });
                if (!result.success) throw new Error(`Tutorial setup failed for ${name}: ${result.message}`);
            }
        } finally { await sdk.disconnect(); }
    }
}
async function stopClients() {
    const hadClients = clients.length > 0;
    for (const child of clients.splice(0)) { child.kill(); await child.exited; }
    if (hadClients) {
        for (const name of [actor!, playerObserver!, agentObserver!])
            await admin('player-logout', { commandId: randomUUID(), username: name.toLowerCase() });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const states = await Promise.all([actor!, playerObserver!, agentObserver!].map(name =>
                admin(`offline-backups/${name.toLowerCase()}`)));
            if (states.every(value => value.readiness.editable && value.state)) return;
            await Bun.sleep(250);
        }
        throw new Error('Dedicated avatar logout/save did not become durably offline');
    }
}
async function admin(path: string, body?: unknown) {
    const response = await fetch(`http://localhost:8888/api/internal/admin/${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'X-Engine-Admin-Token': env.ENGINE_ADMIN_TOKEN!,
            'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    const value = await response.json() as any;
    if (!response.ok) throw new Error(`Admin acceptance ${path}: ${value.error ?? response.status}`);
    return value;
}
async function placeOffline(name: string, x: number, z: number) {
    const summary = await admin(`offline-backups/${name.toLowerCase()}`);
    if (!summary.readiness.editable || !summary.state) throw new Error('Test avatar is not offline/editable');
    const state = summary.state;
    const result = await admin('offline-edit', { commandId: randomUUID(), username: name.toLowerCase(), draft: {
        expectedSavedAt: state.savedAt, coins: state.coins, coinPlacement: 'preserve', skills: state.skills,
        inventory: state.inventory, bank: state.bank, equipment: state.equipment, position: { x, z, level: 0 } } });
    if (!result.ok) throw new Error('Audited isolated trial placement failed');
    await Bun.write(join(output, `completion-placement-${name}-${x}-${z}.json`), JSON.stringify(result));
}
try {
    await stop(); await start();
    await spawnClients([actor, playerObserver, agentObserver]); await stopClients();
    await run([bun, 'scripts/prepare-phase22-live-avatars.ts', actor, playerObserver, agentObserver], 'audited-avatar-setup');
    await spawnClients([actor, playerObserver, agentObserver]);
    const properties = await admin('properties');
    const property = properties.properties.find((value: any) => value.propertyId === 'varrock.east-workshop');
    if (!property) throw new Error('Isolated property missing');
    if (property.state.owner === null) {
        const owner = await admin('properties/purchase', { commandId: randomUUID(), username: playerObserver.toLowerCase(), propertyId: 'varrock.east-workshop' });
        if (!owner.ok) throw new Error('Isolated property setup purchase failed');
        await Bun.write(join(output, 'completion-property-setup.json'), JSON.stringify(owner));
    } else if (property.state.owner.kind !== 'player' || property.state.owner.id !== playerObserver.toLowerCase())
        throw new Error('Isolated property belongs to an unexpected owner');
    if (resume) {
        for (const observer of [playerObserver, agentObserver]) {
            const accepted = await Bun.file(join(output, `recognition-${observer.toLowerCase()}.json`)).json();
            if (!accepted.passed || accepted.bundleId !== bundleId) throw new Error('Resume requires accepted live recognition');
            // Revalidate through authenticated HTTP and all audited sources; a file alone is not proof.
            await run([bun, 'scripts/run-phase22-recognition-live.ts', bundleId, actor, observer, 'replay'], `resume-${observer}`);
        }
    } else {
        for (const [observer, mode] of [[playerObserver, 'player'], [agentObserver, 'agent']] as const)
            await run([bun, 'scripts/run-phase22-recognition-live.ts', bundleId, actor, observer, mode], `recognition-${mode}`);
    }
    await stopClients(); await stop(); await start();
    await spawnClients([actor, playerObserver, agentObserver]);
    for (const observer of [playerObserver, agentObserver])
        await run([bun, 'scripts/run-phase22-recognition-live.ts', bundleId, actor, observer, 'replay'], `restart-${observer}`);
    // Audited test placement is setup; each tested effect must still be real gameplay.
    env.PHASE22_PROCEDURE_BUNDLE = bundleId; env.PHASE22_PROCEDURE_OBSERVER = agentObserver;
    for (const [kind, name, x, z, level] of [ ['lockpick-door','Door',2674,3305,1],
        ['container-theft','Tea stall',3269,3410,5], ['property-burglary','Property door',3248,3411,20] ] as const) {
        await stopClients();
        await placeOffline(actor, x - 1, z);
        // Property entry ends south of this door. The west-side wall is opaque:
        // put the dedicated witness on the actual entry side, never bypass LOS.
        await placeOffline(agentObserver, kind === 'property-burglary' ? x : x - 1,
            kind === 'property-burglary' ? z - 2 : z - 1);
        await spawnClients([actor, playerObserver, agentObserver]);
        await run([bun, 'scripts/run-phase22-procedures-live.ts', actor, kind, name, String(x), String(z), String(level), '12'], kind);
    }
    await stopClients(); await stop(); await start();
    await spawnClients([actor, playerObserver, agentObserver]);
    const observerSettings = await settings(agentObserver);
    const observerSdk = new BotSDK({ botUsername: observerSettings.BOT_USERNAME!, password: observerSettings.PASSWORD,
        gatewayUrl: observerSettings.GATEWAY_URL, autoLaunchBrowser: false, autoReconnect: false, showChat: false });
    try {
        await observerSdk.connect(); await observerSdk.waitForStateUpdate();
        for (const kind of ['container-theft', 'property-burglary']) {
            const acceptance = await Bun.file(join(output, `${kind}-acceptance.json`)).json();
            if (!acceptance.passed) throw new Error('Loc restart requires previously accepted actual event');
            const accepted = acceptance.attempts.find((value: any) => value.recognition && value.reportId && value.commandId);
            if (!accepted) throw new Error('Loc restart has no recorded recognition/report');
            const recognition = await observerSdk.recognizeWitness(accepted.engineEventId, accepted.targetPlayerSlot, accepted.commandId);
            const reportId = await observerSdk.fileWitnessReport(recognition.caseId, recognition.sourceCaseEventId);
            if (JSON.stringify(recognition) !== JSON.stringify(accepted.recognition) || reportId !== accepted.reportId)
                throw new Error('Full process restart changed loc recognition/report receipt');
            await Bun.write(join(output, `${kind}-restart.json`), JSON.stringify({ passed: true,
                eventId: accepted.engineEventId, recognition, reportId, engineAndGatewayRestart: true }));
        }
    } finally { await observerSdk.disconnect(); }
    await Bun.write(join(output, 'completion-live.json'), JSON.stringify({ passed: true, bundleId,
        recognition: ['player-only', 'agent'], engineAndGatewayRestartReplay: true,
        actualProcedures: ['pickpocket', 'lockpick-door', 'container-theft', 'property-burglary'], propertyStateIsolated: true }));
    console.log(JSON.stringify({ passed: true, bundleId }));
} finally {
    try { await stopClients(); } finally {
        await stop();
        delete env.LOGIN_SERVER; delete env.CRIME_REPORT_ACCEPTANCE_BUNDLE; delete env.PROPERTY_STATE_DB;
        delete env.PHASE22_PROCEDURE_BUNDLE; delete env.PHASE22_PROCEDURE_OBSERVER;
        await start(); // Restore the normal authenticated no-bot stack, including the production processor.
    }
}
