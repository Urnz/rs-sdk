// Runs in a dedicated child process: module mocks cannot affect another test.
import { mock } from 'bun:test';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import * as originalPaths from '../paths.js';

if (!process.env.RS_ADMIN_WORKFLOW_ROOT) throw new Error('An isolated fixture root is required');
const root = resolve(process.env.RS_ADMIN_WORKFLOW_ROOT);
if (!root.startsWith(resolve(tmpdir()) + sep + 'rs-admin-contract-')) throw new Error('Fixture root must be a dedicated temporary directory');
const paths = Object.fromEntries(Object.entries(originalPaths).map(([key, value]) => {
    const target = resolve(root, relative(originalPaths.repoRoot, value));
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`Fixture path escaped: ${key}`);
    return [key, target];
})) as typeof originalPaths;
// Static sources stay in the checkout; every runtime/config path stays under root.
await mkdir(root, { recursive: true });
await mkdir(join(root, 'agent-skills', 'catalog'), { recursive: true });
for (const name of ['llm-runtime.json', 'world-director.json', 'population-estate-policy.json', 'population-inheritance-policy.json', 'population-memory-transfer-policy.json']) {
    const target = join(root, 'config', name); await mkdir(dirname(target), { recursive: true });
    await copyFile(join(originalPaths.repoRoot, 'config', name), target);
}
mock.module('../paths.js', () => ({ ...paths, adminPublicDir: originalPaths.adminPublicDir }));
const actualSecrets = await import('../../../control-plane/secret-store.js');
const values = new Map<string, string>();
mock.module('../../../control-plane/secret-store.js', () => ({ ...actualSecrets, ServerSecretStore: class {
    async status(name: string) { return values.has(name); }
    async get(name: string) { return values.get(name) ?? null; }
    async set(name: string, value: string) { values.set(name, value); }
    async delete(name: string) { values.delete(name); }
} }));
if (process.env.RS_ADMIN_WORKFLOW_SCENARIO === 'world-mod') {
    await Bun.write(paths.worldModManifestPath, JSON.stringify({ schemaVersion: 1, mods: [{ id: 'fixture.signal',
        name: 'Fixture signal', version: '1.0.0', dataSchemaVersion: 1, category: 'test', description: 'Isolated signal configuration.',
        activation: 'hot-reload', hooks: ['player.login'], dependencies: [], conflicts: [],
        disablePolicy: { mode: 'stateless', description: 'No persistent game state.' },
        settings: [{ key: 'limit', label: 'Fixture limit', type: 'integer', default: 1, minimum: 1, maximum: 10, description: 'Bounded fixture value.' }] }] }));
    const engine = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
        if (request.headers.get('X-Engine-Admin-Token') !== 'synthetic-fixture-engine') return new Response('Forbidden', { status: 403 });
        if (new URL(request.url).pathname.endsWith('/reload')) return Response.json({ error: 'Synthetic activation unavailable' }, { status: 503 });
        return Response.json({ revision: 0, mods: { 'fixture.signal': { enabled: false, config: { limit: 1 }, version: '1.0.0',
            dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 0 } }, loadedAt: new Date().toISOString(), metrics: {} });
    } });
    process.env.ENGINE_ADMIN_URL = engine.url.origin; process.env.ENGINE_ADMIN_TOKEN = 'synthetic-fixture-engine';
}

const { createControlPlane } = await import('../../../control-plane/service.js');
const { controlPlaneConfig } = await import('../../../control-plane/config.js');
const { IdentityStore } = await import('../../../control-plane/identity-store.js');
const { ServerRegistry } = await import('../../../control-plane/server-registry.js');
const { handleAdminRequest } = await import('../routes.js');
const { SkillTrialStore } = await import('../../../../agent-skills/trials.js');
const { CapabilityGapStore } = await import('../../../../agent-skills/capability-gaps.js');
const { SKILL_VERIFIER_ID } = await import('../../../../agent-skills/verifier.js');
if (['commerce', 'audit'].includes(process.env.RS_ADMIN_WORKFLOW_SCENARIO || '')) {
    const { createAdminAgent } = await import('../agent-state.js');
    for (const agentId of ['contract-a', 'contract-b']) createAdminAgent({ agentId, displayName: agentId, playerUsername: agentId === 'contract-a' ? 'Contracta' : 'Contractb',
        background: 'Synthetic API/UI fixture.', personalityTraits: ['careful'] });
}

let publication: { trialId: string; reportPath: string; skillPath: string; failedTrialId: string } | undefined;
if (process.env.RS_ADMIN_WORKFLOW_SCENARIO === 'publication') {
    const gaps = new CapabilityGapStore(paths.capabilityGapsPath), trials = new SkillTrialStore(paths.skillTrialsPath);
    const { gap: initial } = await gaps.report({ agentId: 'fixture-agent', goalId: 'fixture-goal', title: 'Fixture publication', tags: ['fixture'] });
    let gap = await gaps.transition(initial.gapId, initial.revision, 'assigned', { assignedWorkerId: 'fixture-builder' });
    gap = await gaps.transition(gap.gapId, gap.revision, 'draft', { draftSkill: { id: 'fixture.walk', version: '0.1.0' } });
    gap = await gaps.transition(gap.gapId, gap.revision, 'validating');
    gap = await gaps.transition(gap.gapId, gap.revision, 'live-trial');
    let trial = await trials.create({ gapId: gap.gapId, draft: { id: 'fixture.walk', version: '0.1.0' },
        targetVersion: '1.0.0', testBotUsername: 'Fixturebot', parameters: { x: 3200 } });
    trial = await trials.transition(trial.trialId, trial.revision, 'running');
    const reportId = crypto.randomUUID(), runIds = [crypto.randomUUID(), crypto.randomUUID()];
    const checks = [{ id: 'fixture-live', passed: true, message: 'Synthetic isolated evidence for the UI contract.' }];
    trial = await trials.transition(trial.trialId, trial.revision, 'verification-passed', { runIds,
        verificationReportId: reportId, verificationChecks: checks });
    const promoted = { schemaVersion: 1, id: 'fixture.walk', version: '1.0.0', name: 'Fixture walk',
        description: 'An isolated contract fixture. Never executed in a game.', status: 'verified', tags: ['fixture'],
        parameters: { x: { type: 'number', description: 'Target X', required: true } },
        provenance: { authorKind: 'system', authorId: SKILL_VERIFIER_ID, createdAt: new Date().toISOString() },
        sharing: { visibility: 'shared' }, limits: { timeoutMs: 1000, maxOperations: 1 }, preconditions: [],
        steps: [{ kind: 'operation', id: 'walk', operation: 'walk-to', arguments: { x: { parameter: 'x' }, z: 3200 } }] };
    const reportPath = join(paths.skillVerificationsDir, `${reportId}.json`);
    await mkdir(paths.skillVerificationsDir, { recursive: true });
    await Bun.write(reportPath, JSON.stringify({ id: reportId, createdAt: new Date().toISOString(), verifierId: SKILL_VERIFIER_ID,
        draft: trial.draft, targetVersion: trial.targetVersion, passed: true, checks, evidenceRunIds: runIds,
        evidenceUsernames: ['fixturebot'], promoted }));
    let failed = await trials.create({ gapId: 'gap-bbbbbbbbbbbbbbbbbbbb', draft: { id: 'fixture.failed', version: '0.1.0' },
        targetVersion: '1.0.0', testBotUsername: 'Failurebot', parameters: {} });
    failed = await trials.transition(failed.trialId, failed.revision, 'running');
    failed = await trials.transition(failed.trialId, failed.revision, 'verification-failed', {
        verificationChecks: [{ id: 'fixture-live', passed: false, message: 'Synthetic evidence missing' }] });
    publication = { trialId: trial.trialId, reportPath, failedTrialId: failed.trialId,
        skillPath: join(paths.agentSkillsLocalDir, 'shared', 'fixture.walk@1.0.0.skill.json') };
}

const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:'), config = controlPlaneConfig({});
await identities.createAccount('contract-owner', 'synthetic contract owner password'); registry.ensureConfiguredLocal(config);
const defaults = { skills: [], destinations: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
    bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], offers: [], contracts: [], businesses: [], backups: [],
    generatedAt: new Date().toISOString(), economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
const context = { gatewayBots: () => new Map(), supervisor: { list: () => new Map() } as import('../supervisor.js').BotSupervisor };
const realPaths = new Set(['/api/admin/llm-settings', '/api/admin/experiment-parameter-profiles', '/api/admin/capability-gaps',
    '/api/admin/skill-trials', '/api/admin/world-director/templates', '/api/admin/world-director/cycles',
    '/api/admin/world-director/config', '/api/admin/world-director/preview', '/api/admin/world-mods', '/api/admin/world-mods/backups',
    '/api/admin/world-mods/fixture.signal']);
if (process.env.RS_ADMIN_WORKFLOW_SCENARIO === 'audit') for (const path of ['/api/admin/workflow-options', '/api/admin/audit',
    '/api/admin/autonomy-control', '/api/admin/agents', '/api/admin/agents/contract-a/timeline', '/api/admin/business-role-definitions', '/api/admin/experiments']) realPaths.add(path);
const app = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async (url, init) => {
    if (realPaths.has(url.pathname) || /^\/api\/admin\/skill-trials\/[^/]+\/(publication-approval|publish)$/.test(url.pathname))
        return await handleAdminRequest(new Request(url, init), url, context) || new Response('Fixture route missing', { status: 404 });
    if (process.env.RS_ADMIN_WORKFLOW_SCENARIO === 'commerce' && (['/api/admin/agents', '/api/admin/economic-contracts',
        '/api/admin/economic-offers', '/api/admin/businesses'].includes(url.pathname) || /^\/api\/admin\/economic-offers\/[0-9a-f-]{36}$/.test(url.pathname)))
        return await handleAdminRequest(new Request(url, init), url, context) || new Response('Fixture commerce route missing', { status: 404 });
    if (init.method && init.method !== 'GET') return Response.json({ error: 'Unconfigured fixture mutation' }, { status: 501 });
    if (url.pathname === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 60000, worldMapUrl: config.engineOrigin + '/mapview/' });
    if (url.pathname === '/api/admin/properties') return Response.json({ enabled: false, properties: [], pendingPurchases: [] });
    return Response.json(defaults);
}, registry) });
console.log(JSON.stringify({ url: app.url.origin, root, paths: { profiles: paths.experimentParametersDbPath,
    llm: paths.llmRuntimeOverridePath, director: paths.worldDirectorDbPath, audit: paths.auditLogPath,
    modManifest: paths.worldModManifestPath, modState: paths.worldModStatePath, modBackups: paths.worldModBackupsDir }, publication }));
