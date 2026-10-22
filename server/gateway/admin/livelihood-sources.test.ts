import { afterEach, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { NativeFoodConsumptionStore, FOOD_POLICY, foodDigest } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick } from '../../engine/src/mods/NativeFoodDeliveryStore.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { SimulationClockStore } from '../../../simulation-clock/store.js';
import { loadPopulationAgePolicy } from '../../../population-lifecycle/age.js';
import { loadWorldGenesisProfileCatalog } from '../../../world-genesis/config.js';
import { initializePopulationNeeds, populationNeedsOptions, populationNeedsBinding } from './needs-runtime.js';
import { createLivelihoodPorts } from './livelihood-sources.js';
import { selectLivelihoodAction } from './livelihood-policy.js';
import { BusinessManagerStore } from './business-manager.js';
import { businessManagerPathFor } from './business-agent-port.js';
import { BusinessWorkStore } from '../../../business-work/work.js';
import { createAdminAgent } from './agent-state.js';
import { PropertyStore } from '../../engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../engine/src/mods/Properties.js';
import type { GatewayBotSnapshot } from './types.js';
import { stageSurvivalConfiguration } from '../../../needs/survival-config.js';
import { type SurvivalMode } from '../../../needs/survival.js';
import { FoodNeedsPersistence } from '../../../food-loop/needs-persistence.js';
import { readBusinessFacilityGrant } from './business-facility-grant.js';
import { initializeFoodCommerce } from '../../../agent-operated-shop/native-commerce.js';
import type { LivelihoodJournalEntry } from '../../../agent-state/livelihood.js';
import { loadNativeKitchenPolicy } from '../../../production-workflow/native-kitchen-policy.js';

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(mode?: SurvivalMode) {
    const root = mkdtempSync(join(tmpdir(), 'si-a11-sources-')); roots.push(root);
    cpSync(join(import.meta.dir, '../../../config'), join(root, 'config'), { recursive: true });
    if (mode) writeFileSync(join(root, '.integration-stage.json'), JSON.stringify({ fixtureDigest: 'a'.repeat(64) }));
    const survival = mode ? stageSurvivalConfiguration(root, mode, 'gateway-day-test') : null;
    const needsPath = join(root, 'config/needs-policies.json'), needsPolicy = JSON.parse(readFileSync(needsPath, 'utf8'));
    if (!mode) { needsPolicy.policies[0].needs[0].initialValue = 7000; needsPolicy.policies[0].needs[1].initialValue = 7500; }
    writeFileSync(needsPath, JSON.stringify(needsPolicy));
    mkdirSync(join(root, '.local/economy'), { recursive: true });
    const agentPath = join(root, '.local/economy/agents.sqlite'), time = new SimulationClockStore(join(root, '.local/simulation/clock.sqlite'));
    closers.push(() => time.close()); const now = new Date(Date.now() - (mode ? mode === 'live' ? 3600000 : 300000 : 0)).toISOString();
    const start = time.create({ clockId: survival?.clock.clockId ?? 'source-clock', profile: survival?.clock.profile ?? { schemaVersion: 1, profileId: 'source-test', version: '1.0.0',
        seed: 'source-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: now, simulationTime: now });
    const shared = { store: time, clockId: start.clockId }, agents = new AgentStateStore(agentPath, shared); closers.push(() => agents.close());
    const age = loadPopulationAgePolicy(join(root, 'config/population-age-policy.json'));
    const world = loadWorldGenesisProfileCatalog(join(root, 'config/world-genesis-profiles.json')).profiles.find(p => p.profileId === 'mature-society')!;
    const bots = new Map<string, GatewayBotSnapshot>();
    const add = (name: string, food = true, admitNeeds = true) => {
        agents.createIdentity({ agentId: name, playerUsername: name, displayName: name, background: 'Readonly adapter fixture.', personalityTraits: ['steady'] }, now);
        agents.createAutonomyEnrollment(name, { status: 'desired', policyId: 'society-livelihood', policyVersion: '1.0.0' });
        agents.setSkillKnowledge(name, { id: 'procedure.food.consume-lobster', version: '1.0.0' }, 'known', null);
        agents.bindPopulationMember({ agentId: name, playerUsername: name, worldProfile: { profileId: world.profileId, version: world.version, digest: world.digest },
            lifecyclePolicy: { ...age.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: start.clockId, profileDigest: start.profileDigest },
            joinedAtSimulationTime: now, sourceResultId: 'genesis-' + 'b'.repeat(24), sourceResultDigest: 'c'.repeat(64) }, now);
        time.recordPlayerPresence(start.clockId, name, 'online', now);
        if (admitNeeds) initializePopulationNeeds(populationNeedsOptions(root), agents.getPopulationMember(name)!, shared, 'genesis');
        bots.set(name, { username: name, status: 'active', controllers: 0, lastStateReceivedAt: Date.now(),
            state: { player: { isDead: false, worldX: 3200, worldZ: 3200, level: 0 }, inventory: [
                ...(food ? [{ slot: 5, id: 379, name: 'Lobster', count: 1 }] : []), { slot: 6, id: 995, name: 'Coins', count: 600 }] } } as GatewayBotSnapshot);
        return agents.getPopulationMember(name)!;
    };
    const ports = createLivelihoodPorts({ workspace: root, agentPath, simulationClock: shared, gatewayBots: () => bots, activeSkill: () => null });
    return { root, agentPath, time, now, start, agents, bots, add, ports, survival, shared };
}

test('gateway uses the selected one-day threshold from durable needs and asks the existing skill to eat autonomously', async () => {
    for (const mode of ['live', 'accelerated-test'] as const) {
        const f = fixture(mode), member = f.add('daytest'), p = f.survival!;
        const observed = f.time.observe(f.start.clockId, new Date(Date.now()).toISOString(), 10);
        const options = populationNeedsOptions(f.root);
        const needs = new FoodNeedsPersistence(options.databasePath, p.policy, p.dynamics, p.food);
        try { needs.needs.advance({ binding: populationNeedsBinding(options.worldId, member), clock: observed,
            history: f.time.getPlayerTimeHistory(f.start.clockId, 'daytest'), playerTime: f.time.getPlayerTimeState(f.start.clockId, 'daytest'), expectedRevision: 1 }); }
        finally { needs.close(); }
        // Empty native journal with a closed watermark is a named source boundary, not a fabricated consumption.
        const path = join(f.root, 'server/engine/data/player-checkpoints.sqlite'); mkdirSync(join(path, '..'), { recursive: true });
        const checkpoint = new Database(path);
        try { new NativeFoodConsumptionStore({ db: checkpoint } as any); closeFoodDeliveryTick(checkpoint, observed); }
        finally { checkpoint.close(true); }
        const previous = process.env.PLAYER_CHECKPOINT_DATABASE;
        process.env.PLAYER_CHECKPOINT_DATABASE = 'data/player-checkpoints.sqlite';
        try {
            const s = await createLivelihoodPorts({ workspace: f.root, agentPath: f.agentPath, simulationClock: f.shared,
                gatewayBots: () => f.bots, activeSkill: () => null }).snapshot('daytest');
            expect(s.hungerThreshold).toBe(2400); expect(s.needs!.hunger).toBeGreaterThanOrEqual(2400);
            expect(selectLivelihoodAction(s)).toMatchObject({ reason: 'hunger-relief', action: { kind: 'skill',
                skill: { id: 'procedure.food.consume-lobster', version: '1.0.0' }, binding: { parameters: { slot: 5 } } } });
        } finally { if (previous === undefined) delete process.env.PLAYER_CHECKPOINT_DATABASE; else process.env.PLAYER_CHECKPOINT_DATABASE = previous; }
    }
});

test('backend snapshot derives identical food choices for four names from their own exact inventory slot and durable needs', async () => {
    const f = fixture();
    for (const name of ['sun11', 'rain22', 'snow33', 'wind44']) {
        f.add(name);
        const s = await f.ports.snapshot(name);
        expect(s.needs).toEqual({ hunger: 7000, fatigue: 7500, sleeping: false });
        expect(selectLivelihoodAction(s)).toMatchObject({ reason: 'hunger-relief', action: {
            kind: 'skill', skill: { id: 'procedure.food.consume-lobster', version: '1.0.0' }, binding: { parameters: { slot: 5 } } } });
    }
});

test('unknown physiology, stale/controller-owned avatars and native death cannot silently become healthy work candidates', async () => {
    const f = fixture(); f.add('sun11', false, false);
    expect(selectLivelihoodAction(await f.ports.snapshot('sun11')).reason).toBe('needs-source-unavailable');
    f.add('rain22'); const b = f.bots.get('rain22')!; b.controllers = 1;
    expect(selectLivelihoodAction(await f.ports.snapshot('rain22')).reason).toBe('physical-execution-blocked');
    b.controllers = 0; b.lastStateReceivedAt = Date.now() - 6000;
    expect(selectLivelihoodAction(await f.ports.snapshot('rain22')).reason).toBe('physical-execution-blocked');
    b.lastStateReceivedAt = Date.now(); b.state!.player!.isDead = true;
    expect(selectLivelihoodAction(await f.ports.snapshot('rain22')).reason).toBe('lifecycle-terminal');
});

test('rent terms come from a real player Property title/catalog; missing landlord is not invented', async () => {
    const f = fixture(); f.add('sun11', false); f.add('rain22', false);
    const path = join(f.root, '.local/admin/properties.sqlite'); mkdirSync(join(f.root, '.local/admin'), { recursive: true });
    const p = new PropertyStore(loadPropertyCatalog(join(f.root, 'config/properties.json')), path);
    try { p.assignGenesis('title-opening', 'falador.south-house', 1, { kind: 'player', id: 'rain22' }); } finally { p.close(); }
    const s = await f.ports.snapshot('sun11');
    expect(s.rent).toMatchObject({ kind: 'housing', operation: 'pay', landlordAgentId: 'rain22', bedSlotId: 'falador.south-house.bed-1' });
    // Hunger still wins over a perfectly valid rental quote; missing food is not a reason to start work or spend rent.
    expect(selectLivelihoodAction(s).reason).toBe('food-input-or-authority-required');
});

test('Business stock demand creates no free raw material; only existing raw stock, policy and employment select a cook order', async () => {
    const f = fixture(); f.add('sun11'); f.add('rain22');
    createAdminAgent({ agentId: 'business-mind', displayName: 'Kitchen mind', background: 'Business routine fixture.', personalityTraits: ['steady'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'karamja-kitchen', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 100, dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 1000 } }, f.agentPath);
    const manager = new BusinessManagerStore(businessManagerPathFor(f.agentPath));
    try {
        manager.create({ businessId: 'karamja-kitchen', name: 'Kitchen', summary: 'Finite stock.', ownerAgentId: 'rain22', propertyId: 'karamja.fishing-hut' });
        const policy = manager.proposePolicy('karamja-kitchen', { proposalId: randomUUID(), proposerAgentId: 'business-mind', objective: 'Cook bounded stock.',
            mode: 'balanced', maxRewardGp: 25, preferredSkills: [] });
        manager.resolvePolicy('karamja-kitchen', policy.proposalId, policy.revision, 'approve', 'Fixture approval');
        expect(selectLivelihoodAction(await f.ports.snapshot('business-mind'))).toEqual({ action: null, reason: 'stock-input-or-authority-required' });
        manager.hire('karamja-kitchen', { workerAgentId: 'sun11', roleDefinitionId: 'business.cook.v1', title: 'Cook', wageGp: 25,
            requiredSkill: { id: 'procedure.food.cook-lobster', version: '0.1.0' } });
        expect(selectLivelihoodAction(await f.ports.snapshot('business-mind'))).toEqual({ action: null, reason: 'stock-input-required' });
        expect(manager.listInventory('karamja-kitchen')).toEqual([]);
        manager.creditGenesisInventory('fixture-raw-opening', 'karamja-kitchen', 377, 1);
        expect(selectLivelihoodAction(await f.ports.snapshot('business-mind'))).toMatchObject({ reason: 'stock-order', action: {
            kind: 'stock', businessId: 'karamja-kitchen', policyId: 'karamja-kitchen.cook.v1' } });
        expect(manager.listInventory('karamja-kitchen')[0]?.count).toBe(1);
        const work = new BusinessWorkStore(businessManagerPathFor(f.agentPath)); try { expect(work.bindings()).toEqual([]); } finally { work.close(); }
        manager.creditGenesisInventory('fixture-cooked-opening', 'karamja-kitchen', 379, 8);
        expect(selectLivelihoodAction(await f.ports.snapshot('business-mind'))).toEqual({ action: null, reason: 'stock-satisfied' });
    } finally { manager.close(); }
});

function foodSource(f: ReturnType<typeof fixture>) {
    const path = join(f.root, 'server/engine/data/player-checkpoints.sqlite'); mkdirSync(join(f.root, 'server/engine/data'), { recursive: true });
    const db = new Database(path), store = new NativeFoodConsumptionStore({ db }); closers.push(() => db.close(true));
    const clock = () => ({ ...f.time.observe(f.start.clockId, new Date(Date.parse(f.now) + 2000).toISOString(), 2), engineTick: 2 });
    return { db, store, clock };
}

test('closed-tick needs may lag an advancing world clock within the bounded source window; stale or unclosed coverage is rejected', async () => {
    const f = fixture(); f.add('sun11'); const food = foodSource(f), c = food.clock();
    closeFoodDeliveryTick(food.db, c);
    expect((await f.ports.snapshot('sun11')).needs).toEqual({ hunger: 7000, fatigue: 7500, sleeping: false });
    f.time.observe(f.start.clockId, new Date(Date.parse(f.now) + 31000).toISOString(), 3);
    expect((await f.ports.snapshot('sun11')).needs).toBeNull();
});

test('an unapplied canonical food receipt blocks another routine even when the durable needs clock was otherwise recent', async () => {
    const f = fixture(), m = f.add('sun11'), food = foodSource(f), c = food.clock();
    const b = populationNeedsBinding(populationNeedsOptions(f.root).worldId, m);
    const action = { actionId: randomUUID(), worldId: b.worldId, actorId: b.actorId, username: b.playerId, lifecycleId: b.lifecycleId,
        itemId: 379 as const, quantity: 1 as const, slot: 5, policyDigest: foodDigest(FOOD_POLICY), clockId: b.clockId, clockProfileDigest: b.clockProfileDigest };
    food.store.admit(action);
    // Typed source fixture only; real Player/content proof is covered by NativeFoodNutrition.test.ts.
    food.db.transaction(() => food.store.finish({ action, outcome: 'consumed', receipt: { ...action, schemaVersion: 1,
        cause: 'content:consume_effect_stat', before: 1, after: 0, hpBefore: 20, hpAfter: 20, clock: c,
        checkpointId: `food:${action.actionId}`, checkpointDigest: 'a'.repeat(64), requestDigest: foodDigest(action) } }, c)).immediate();
    closeFoodDeliveryTick(food.db, c);
    expect(selectLivelihoodAction(await f.ports.snapshot('sun11')).reason).toBe('needs-source-unavailable');
});

test('standing purchase terms use approved stock prices and a real facility grant, never another avatar inventory', async () => {
    const f = fixture(); f.add('sun11', false); f.add('rain22', false);
    const manager = new BusinessManagerStore(businessManagerPathFor(f.agentPath));
    try {
        manager.create({ businessId: 'karamja-kitchen', name: 'Kitchen', summary: 'Standing terms.', ownerAgentId: 'rain22', propertyId: 'karamja.fishing-hut' });
        const policy = manager.proposePolicy('karamja-kitchen', { proposalId: randomUUID(), proposerAgentId: 'rain22', objective: 'Finite food sales.',
            mode: 'balanced', maxRewardGp: 25, preferredSkills: [] });
        manager.resolvePolicy('karamja-kitchen', policy.proposalId, policy.revision, 'approve', 'Fixture approval');
        expect((await f.ports.snapshot('sun11')).food).toBeUndefined();
        const work = new BusinessWorkStore(businessManagerPathFor(f.agentPath));
        try { work.grantEntitlement({ entitlementId: 'standing-storage', businessId: 'karamja-kitchen', propertyId: 'karamja.fishing-hut',
            facilityCapability: 'storage.secure', validFrom: f.now, validUntil: null }); } finally { work.close(); }
        expect((await f.ports.snapshot('sun11')).food).toBeUndefined();
        manager.creditGenesisInventory('standing-finite-food', 'karamja-kitchen', 379, 1);
        expect(selectLivelihoodAction(await f.ports.snapshot('sun11'))).toEqual({ action: null, reason: 'commerce-meeting-route-required' });
        const site = loadNativeKitchenPolicy(f.root).heat;
        Object.assign(f.bots.get('sun11')!.state!.player!, { worldX: site.x + 2, worldZ: site.z, level: site.level });
        Object.assign(f.bots.get('rain22')!.state!.player!, { worldX: site.x - 2, worldZ: site.z, level: site.level });
        // Both are near the facility, but the native bilateral two-tile gate still fails.
        expect((await f.ports.snapshot('sun11')).food).toBeUndefined();
        Object.assign(f.bots.get('rain22')!.state!.player!, { worldX: site.x + 1 });
        expect((await f.ports.snapshot('sun11')).food).toMatchObject({ kind: 'commerce', quote: {
            businessId: 'karamja-kitchen', workerAgentId: 'rain22', kind: 'sale', quantity: 1, unitPriceGp: 40 } });
        const enrollment = f.agents.getAutonomyEnrollment('rain22')!;
        f.agents.claimAutonomyEnrollment('rain22', enrollment.revision, 'source-test', new Date(Date.now() + 60000).toISOString());
        expect((await f.ports.snapshot('sun11')).food).toMatchObject({ kind: 'commerce', quote: { workerAgentId: 'rain22' } });
        const writer = new Database(businessManagerPathFor(f.agentPath));
        try {
            writer.transaction(() => {
                expect(readBusinessFacilityGrant(f.root, businessManagerPathFor(f.agentPath), 'karamja-kitchen',
                    'rain22', 'storage.secure', f.time.observeNow(f.start.clockId))).toMatchObject({
                    grantId: 'standing-storage', kind: 'explicit', subjectAgentId: 'rain22' });
            }).immediate();
        } finally { writer.close(true); }
        // Selection never spends stock; the SI-A09 reservation still has to authorize the finite unit.
        expect(manager.listInventory('karamja-kitchen')).toMatchObject([{ itemId: 379, count: 1 }]);
        f.bots.get('sun11')!.state!.inventory.push({ slot: 7, id: 377, name: 'Raw lobster', count: 1, optionsWithIndex: [] });
        Object.assign(f.bots.get('sun11')!.state!.player!, { worldX: site.x + 10 });
        const remoteSeller = await f.ports.snapshot('sun11');
        expect(remoteSeller.supply).toBeUndefined();
        expect(remoteSeller.supplyBlocked).toBe('commerce-meeting-route-required');
        expect(manager.listInventory('karamja-kitchen')).toMatchObject([{ itemId: 379, count: 1 }]);
        // A learned reusable route replaces the attempted remote trade, without spending/reserving stock.
        const kitchenPath = join(f.root, 'config/native-kitchen.json'), native = JSON.parse(readFileSync(kitchenPath, 'utf8'));
        native.heat = { debugName: 'loc_2728', x: 2814, z: 3161, level: 0 };
        writeFileSync(kitchenPath, JSON.stringify(native));
        f.agents.setSkillKnowledge('sun11', { id: 'procedure.travel.native-sites', version: '1.0.0' }, 'known', null);
        const routed = await f.ports.snapshot('sun11');
        expect(routed.food).toMatchObject({ kind: 'skill', skill: { id: 'procedure.travel.native-sites', version: '1.0.0' },
            binding: { sourceKind: 'approved-policy', parameters: { site: 'kitchen' } } });
        expect(routed.supply).toMatchObject({ kind: 'skill', binding: { parameters: { site: 'kitchen' } } });
        expect(routed.supplyBlocked).toBeUndefined();
        // The writer probe above advanced the clock beyond needs coverage: deriving a route cannot bypass that gate.
        expect(selectLivelihoodAction(routed)).toEqual({ action: null, reason: 'needs-source-unavailable' });
        Object.assign(f.bots.get('sun11')!.state!.player!, { worldX: 2815, worldZ: 3161, level: 0 });
        // An actor already at the site waits for the remote peer rather than repeatedly travelling to itself.
        expect((await f.ports.snapshot('sun11')).food).toBeUndefined();
        expect(manager.listInventory('karamja-kitchen')).toMatchObject([{ itemId: 379, count: 1 }]);
    } finally { manager.close(); }
});

test('self-care selects exact learned consumption versions and never invents an unknown or blocked skill', async () => {
    const f = fixture(); f.add('sun11');
    f.agents.setSkillKnowledge('sun11', { id: 'procedure.food.consume-lobster', version: '0.1.0' }, 'preferred', null);
    expect((await f.ports.snapshot('sun11')).food).toMatchObject({ skill: { version: '0.1.0' } });
    f.agents.setSkillKnowledge('sun11', { id: 'procedure.food.consume-lobster', version: '0.1.0' }, 'blocked', 1);
    expect((await f.ports.snapshot('sun11')).food).toMatchObject({ skill: { version: '1.0.0' } });
    f.agents.setSkillKnowledge('sun11', { id: 'procedure.food.consume-lobster', version: '1.0.0' }, 'blocked', 1);
    expect((await f.ports.snapshot('sun11')).food).toBeUndefined();
    expect(selectLivelihoodAction(await f.ports.snapshot('sun11')).reason).toBe('food-input-or-authority-required');
});

test('failed travel retains the submitted intent and never authorizes another physical trip from its SDK journal', async () => {
    const f = fixture(), m = f.add('sun11'), runId = randomUUID(), skill = { id: 'procedure.travel.native-sites', version: '1.0.0' };
    const runRoot = join(f.root, '.local/agent-skills/runs'); mkdirSync(runRoot, { recursive: true });
    const path = join(runRoot, `${runId}.json`), run = { runId, username: 'sun11', skill, parameters: { site: 'housing' },
        status: 'failed', reason: 'travel-ferry-unconfirmed', events: [{ runId, skill, timestamp: f.now,
            type: 'step.failed', operation: 'travel-to-site', code: 'travel-ferry-unconfirmed' }] };
    writeFileSync(path, JSON.stringify(run));
    const entry: LivelihoodJournalEntry = { actionId: 'routine.travel-uncertain', agentId: 'sun11', eventId: 'travel-event', policy: 'society-livelihood@1.0.0',
        lifecycle: populationNeedsBinding(populationNeedsOptions(f.root).worldId, m).lifecycleId,
        action: { kind: 'skill', skill, binding: { sourceKind: 'approved-policy', sourceId: 'society-livelihood:1.0.0:travel:rental', parameters: { site: 'housing' } } },
        phase: 'submitted', reason: 'skill-dispatch-intent', receipt: null, createdAt: f.now, updatedAt: f.now, revision: 1 };
    expect(await f.ports.reconcileFailedSkill!(entry, runId)).toEqual({ status: 'pending', reason: 'travel-source-reconciliation-required', source: null });
    expect(await f.ports.reconcileFailedSkill!(entry, runId)).toEqual({ status: 'pending', reason: 'travel-source-reconciliation-required', source: null });
    expect(f.agents.listSkillDispatches('sun11', 10)).toEqual([]);
    writeFileSync(path, JSON.stringify({ ...run, username: 'rain22' }));
    await expect(f.ports.reconcileFailedSkill!(entry, runId)).rejects.toThrow('run differs');
});

test('an audited commerce journal proves a rejected reservation was never admitted; missing journals remain uncertain', async () => {
    const f = fixture(), member = f.add('sun11', false);
    const entry: LivelihoodJournalEntry = { actionId: 'routine.rejected', agentId: 'sun11', eventId: randomUUID(),
        policy: 'society-livelihood@1.0.0', lifecycle: populationNeedsBinding(populationNeedsOptions(f.root).worldId, member).lifecycleId,
        action: { kind: 'commerce', operationId: 'routine.no-stock', quote: { businessId: 'karamja-kitchen', workerAgentId: 'rain22',
            kind: 'sale', quantity: 1, unitPriceGp: 40 } }, phase: 'submitted', reason: 'native-dispatch-intent', receipt: null,
        createdAt: f.now, updatedAt: f.now, revision: 1 };
    await expect(f.ports.reconcile(entry)).rejects.toThrow('actor/lifecycle');
    const path = businessManagerPathFor(f.agentPath); mkdirSync(join(path, '..'), { recursive: true });
    const db = new Database(path); try { initializeFoodCommerce(db); } finally { db.close(); }
    expect(await f.ports.reconcile(entry)).toMatchObject({ status: 'failed', reason: 'commerce-not-admitted',
        source: expect.stringContaining('commerce-non-admission:') });
    expect(f.agents.listSkillDispatches('sun11', 10)).toEqual([]);
});
