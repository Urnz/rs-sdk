import { afterEach, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadIntegrationFixture, buildTravelIntegrationFixture, operationalSkillDigest, integrationWorldId } from '../fixture.js';
import { integrationRuntimeConfig, stageIntegrationRuntime } from '../runtime-config.js';
import { validateLlmRuntimeConfig } from '../../llm-runtime/config.js';
import { evaluateAuthorizationEnvelope } from '../../server/gateway/admin/authorization-envelope.js';
import { evaluateAutonomousSkillPolicy } from '../../server/gateway/admin/replan-runtime.js';
import { AgentStateStore } from '../../agent-state/store.js';
import { preflightIntegrationDefinition } from '../bootstrap.js';
const root = resolve(import.meta.dir, '../..'), roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
const fixture = () => loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-accelerated-test-native-sites-v1.json'));
const base = () => validateLlmRuntimeConfig(JSON.parse(readFileSync(join(root, 'config/llm-runtime.json'), 'utf8')));

test('the published travel fixture resolves all five exact pins without adding opening resources', async () => {
    const f = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'));
    const definition = JSON.parse(readFileSync(join(root, 'agent-skills/catalog/procedure.travel.native-sites@1.0.0.skill.json'), 'utf8'));
    expect(f).toEqual(buildTravelIntegrationFixture(fixture(), {
        id: definition.id, version: definition.version, definitionDigest: operationalSkillDigest(definition)
    }));
    const preflight = await preflightIntegrationDefinition(root, f);
    expect(preflight.errors).toEqual([]); expect(preflight.executableSkillsReady).toBeTrue();
    expect(preflight.verifiedSkills).toHaveLength(5);
});

test('a new travel fixture adds exact knowledge and bounded route authority without changing opening resources or physiology', () => {
    const original = fixture(), draft = JSON.parse(readFileSync(join(root, 'agent-skills/catalog/procedure.travel.native-sites@0.1.0.skill.json'), 'utf8'));
    // Pure publication boundary fixture; no candidate is saved or made executable by this test.
    const definition = { ...draft, status: 'verified', version: '1.0.0' };
    const f = buildTravelIntegrationFixture(original, { id: definition.id, version: definition.version, definitionDigest: operationalSkillDigest(definition) });
    expect(f.version).toBe('1.3.0'); expect(f.skills).toHaveLength(5); expect(integrationWorldId(f)).not.toBe(integrationWorldId(original));
    expect(f.avatars.map(({ knownSkills: _skills, ...a }) => a)).toEqual(original.avatars.map(({ knownSkills: _skills, ...a }) => a));
    expect(f.clock).toEqual(original.clock); expect(f.survival!).toEqual(original.survival!);
    expect(f.kitchen).toEqual(original.kitchen); expect(f.housing).toEqual(original.housing); expect(f.protocol).toEqual(original.protocol);
    expect(f.avatars.every(a => a.knownSkills.includes(definition.id))).toBe(true);
    const config = integrationRuntimeConfig(f, base()), choice = evaluateAutonomousSkillPolicy(config.autonomousExecution, definition);
    expect(choice.allowed).toBe(true); expect(config.enabled).toBe(false); expect(config.skillBuilder.enabled).toBe(false);
    expect(evaluateAuthorizationEnvelope(choice.authorization!, definition, { site: 'housing' })).toMatchObject({ allowed: true, reservedGp: 30 });
    expect(evaluateAuthorizationEnvelope(choice.authorization!, definition, { site: 'elsewhere' }).allowed).toBe(false);
    expect(evaluateAutonomousSkillPolicy(config.autonomousExecution, draft).allowed).toBe(false);
    // Exercise the real shared ledger: already-paid rent cannot make the route's
    // separate authorization deny an otherwise funded 30 GP journey.
    const directory = mkdtempSync(join(tmpdir(), 'si-travel-budget-')); roots.push(directory);
    const agents = new AgentStateStore(join(directory, 'agents.sqlite'));
    try {
        const identity = agents.createIdentity({ agentId: 'route-test', playerUsername: 'routetest', displayName: 'Route test',
            background: 'Paid housing and travel share one daily operational ledger.', personalityTraits: ['steady'],
            controlProfile: { role: 'player', subjectKind: 'player', subjectId: 'routetest', avatarPlayerUsername: 'routetest',
                decisionIntervalMs: 10000, maxDecisionsPerDay: 100, dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 700 } });
        for (const decisionId of ['rent-decision', 'route-decision']) agents.recordDecision(identity.agentId, agents.getControlProfile(identity.agentId)!.revision,
            { decisionId, trigger: 'event', llmCostMicros: 0, operationalBudgetGp: 0, contextDigest: 'a'.repeat(64) });
        agents.reserveDecisionOperationalBudget('rent-decision', 500, 700);
        expect(agents.reserveDecisionOperationalBudget('route-decision', 30, choice.authorization!.maxGpPerDay!).operationalBudgetGp).toBe(30);
        expect(choice.authorization!.maxGpPerDay).toBe(700);
    } finally { agents.close(); }
});

test('native integration enables only the four exact published bounded procedures while keeping providers and builders disabled', () => {
    const f = fixture(), config = integrationRuntimeConfig(f, base());
    expect(config.enabled).toBeFalse(); expect(config.automaticReplanning).toBeTrue(); expect(config.skillBuilder.enabled).toBeFalse();
    expect(config.dailyBudget.maxCostMicros).toBe(0); expect(config.autonomousExecution.allowedSkills).toHaveLength(4);
    for (const pin of f.skills) {
        const definition = JSON.parse(readFileSync(join(root, `agent-skills/catalog/${pin.id}@${pin.version}.skill.json`), 'utf8'));
        const allowed = evaluateAutonomousSkillPolicy(config.autonomousExecution, definition);
        expect(allowed.allowed).toBeTrue();
        const parameters: Record<string, string | number | boolean> = pin.id.includes('consume') ? { slot: 2 } : pin.id.includes('cook')
            ? { 'kitchen-run': 'routine-native-run', 'batch-id': 'kitchen:routine-native-run' }
            : pin.id.startsWith('trade.') ? { recipient: 'silessor', 'item-name': 'Lobster', amount: 1 } : {};
        expect(evaluateAuthorizationEnvelope(allowed.authorization!, definition, parameters).allowed).toBeTrue();
        if (pin.id.includes('consume')) expect(evaluateAuthorizationEnvelope(allowed.authorization!, definition, { slot: 28 }).allowed).toBeFalse();
        if (pin.id.startsWith('trade.')) {
            expect(evaluateAuthorizationEnvelope(allowed.authorization!, definition, { ...parameters, recipient: 'outsider' }).allowed).toBeFalse();
            expect(evaluateAuthorizationEnvelope(allowed.authorization!, definition, { ...parameters, amount: 2 }).allowed).toBeFalse();
        }
    }
    expect(base().autonomousExecution.enabled).toBeFalse();
});

test('runtime profile can only be staged once before a native world exists', () => {
    const stage = mkdtempSync(join(tmpdir(), 'si-runtime-')); roots.push(stage);
    cpSync(join(root, 'config'), join(stage, 'config'), { recursive: true });
    expect(() => stageIntegrationRuntime(stage, fixture())).toThrow('fresh unpublished');
    writeFileSync(join(stage, '.integration-stage.json'), JSON.stringify({ fixtureDigest: fixture().digest }));
    const marker = stageIntegrationRuntime(stage, fixture());
    expect(JSON.parse(readFileSync(join(stage, marker), 'utf8')).providerCalls).toBe(0);
    expect(() => stageIntegrationRuntime(stage, fixture())).toThrow('fresh unpublished');
});
