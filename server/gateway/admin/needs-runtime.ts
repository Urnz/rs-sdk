import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { AgentStateStore, AgentStateSimulationClock } from '../../../agent-state/store.js';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import { FoodNeedsPersistence } from '../../../food-loop/needs-persistence.js';
import { loadFoodLoopCatalog } from '../../../food-loop/catalog.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../../../needs/config.js';
import { NeedsStore, type NeedsAdmission, type NeedsBinding, type NeedsTerminal } from '../../../needs/store.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import { populationDeathMembershipDigest } from '../../../population-lifecycle/death.js';
import { healthDigest } from '../../../population-health/policy.js';
import { PlayerHealthEvidenceStore } from '../../engine/src/mods/PlayerHealthEvidenceStore.js';
import { managedContext } from '../../control-plane/instance-context.js';
import { NativeFoodSource, assertNativeFoodPath, assertNativeFoodDomainPath } from '../../../food-loop/native-source.js';
import { NativeFoodConsumptionProjection } from '../../../food-loop/native-consumption-store.js';
import { OwnedFoodDatabase } from '../../../food-loop/owned-database.js';
import { ItemProvenanceStore } from '../../../item-provenance/store.js';
import { loadItemProvenancePolicyCatalog } from '../../../item-provenance/policy.js';
import { loadItemLifecycleCatalog } from '../../../item-lifecycle/catalog.js';
import { loadItemStatePolicyCatalog } from '../../../item-lifecycle/classification.js';
import { populationNeedsBinding } from '../../../needs/population-binding.js';
export { populationNeedsBinding } from '../../../needs/population-binding.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface PopulationNeedsOptions { workspace: string; worldId: string; databasePath: string; configDirectory: string;
    nativeFoodCheckpointPath?: string; nativeFoodTradePath?: string; nativeFoodProvenancePath?: string }
export function populationNeedsOptions(workspace: string): PopulationNeedsOptions {
    const root = resolve(workspace), managed = managedContext();
    const checkpoint = process.env.PLAYER_CHECKPOINT_DATABASE ?? process.env.GE_DATABASE;
    return { workspace: root, worldId: managed?.id ?? `local:${digest(root + sep)}`,
        databasePath: join(root, '.local/simulation/food-needs.sqlite'), configDirectory: join(root, 'config'),
        ...(checkpoint ? { nativeFoodCheckpointPath: resolve(root, 'server/engine', checkpoint) } : {}) };
}
/** Consumer-only join: an origin projection never creates another physiological application. */
export function readPopulationFoodLineage(options: PopulationNeedsOptions) {
    const nutrition = readPopulationFoodApplications(options);
    if (nutrition.status === 'unavailable') return { status: 'unavailable' as const, consumptions: null, projection: null };
    const tradePath = options.nativeFoodTradePath ?? resolve(options.workspace, 'server/engine',
        process.env.TRADE_EVIDENCE_DB ?? 'data/mods/trade-evidence.sqlite');
    if (!existsSync(tradePath)) return { status: 'unavailable' as const, consumptions: null, projection: null };
    const source = openPopulationFoodSource(options);
    let provenance: ItemProvenanceStore | undefined;
    try { return source.snapshot(() => {
        if (options.nativeFoodProvenancePath) {
            assertNativeFoodDomainPath({ workspace: options.workspace, worldId: options.worldId, checkpointPath: options.nativeFoodProvenancePath });
            const lifecycle = loadItemLifecycleCatalog(join(options.configDirectory, 'item-lifecycle.json'));
            const state = loadItemStatePolicyCatalog(join(options.configDirectory, 'item-state-policies.json'), lifecycle);
            provenance = new ItemProvenanceStore(options.nativeFoodProvenancePath,
                loadItemProvenancePolicyCatalog(join(options.configDirectory, 'item-provenance-policies.json'), state), true);
        }
        const view = source.lineage(tradePath, provenance);
        if (!view.projection) return { status: 'unavailable' as const, consumptions: null, projection: null };
        const consumptions = nutrition.applications!.filter(app => app.quantity === 1).map(app => {
            const lineage = view.projection!.consumptions.find(item => item.actionId === app.actionId);
            if (lineage && (lineage.consumer.actorId !== app.binding.actorId || lineage.consumer.lifecycleId !== app.binding.lifecycleId))
                throw new Error('Native food lineage/physiology binding differs');
            return { actionId: app.actionId, actorId: app.binding.actorId, quantity: app.quantity, hungerRelief: app.hungerRelief,
                physiology: 'verified' as const, origin: lineage?.origin ?? 'unknown',
                internalSupply: lineage?.internalSupply ?? 'unproven', lineage: lineage ?? null };
        });
        return { status: 'available' as const, consumptions, projection: view.projection };
    }); } finally { provenance?.close(); source.close(); }
}
function physicalPath(path: string): string {
    const suffix: string[] = []; let current = resolve(path);
    while (!existsSync(current)) {
        const parent = dirname(current);
        if (parent === current) throw new Error('Needs workspace is unavailable');
        suffix.unshift(relative(parent, current)); current = parent;
    }
    return resolve(realpathSync(current), ...suffix);
}
export function assertNeedsPath(options: PopulationNeedsOptions): void {
    const managed = managedContext();
    if (managed && (managed.id !== options.worldId || physicalPath(managed.workspace) !== physicalPath(options.workspace)))
        throw new Error('Needs context belongs to another managed world');
    const base = physicalPath(join(options.workspace, '.local/simulation'));
    const path = physicalPath(options.databasePath), rel = relative(base, path);
    if (!rel || rel.startsWith('..') || resolve(base, rel) !== path) throw new Error('Needs path escapes the selected world');
    const config = physicalPath(options.configDirectory);
    if (config !== physicalPath(join(options.workspace, 'config'))) throw new Error('Needs policy belongs to another world');
}
function policies(options: PopulationNeedsOptions) {
    assertNeedsPath(options);
    const policy = loadNeedsPolicyCatalog(join(options.configDirectory, 'needs-policies.json')).policies[0]!;
    const dynamics = loadNeedsDynamicsPolicyCatalog(join(options.configDirectory, 'needs-dynamics-policies.json'), policy).policies[0]!;
    return { policy, dynamics };
}
function open(options: PopulationNeedsOptions): FoodNeedsPersistence {
    const { policy, dynamics } = policies(options);
    return new FoodNeedsPersistence(options.databasePath, policy, dynamics,
        loadFoodLoopCatalog(join(options.configDirectory, 'food-loops.json')));
}
export function openPopulationFoodSource(options: PopulationNeedsOptions): NativeFoodSource {
    assertNeedsPath(options);
    const candidates = options.nativeFoodCheckpointPath ? [options.nativeFoodCheckpointPath]
        : ['player-checkpoints.sqlite', 'market.sqlite'].map(name => join(options.workspace, 'server/engine/data', name));
    const eligible = candidates.filter(checkpointPath => {
        assertNativeFoodPath({ ...options, checkpointPath });
        if (!existsSync(checkpointPath)) return false;
        const db = new Database(checkpointPath, { readonly: true, strict: true });
        try { return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_delivery_schema'").get(); }
        finally { db.close(true); }
    });
    if (eligible.length !== 1) throw new Error('Native food checkpoint authority is unavailable or ambiguous');
    return new NativeFoodSource({ ...options, checkpointPath: eligible[0]! });
}
function input(options: PopulationNeedsOptions, member: AgentPopulationMember, shared: AgentStateSimulationClock,
    confirmed?: SimulationClockObservation) {
    if (shared.clockId !== member.simulationClock.clockId) throw new Error('Needs membership clock mismatch');
    const state = shared.store.get(shared.clockId);
    if (!state || state.profileDigest !== member.simulationClock.profileDigest) throw new Error('Needs membership profile mismatch');
    const clock = confirmed ?? {
        clockId: state.clockId, profileDigest: state.profileDigest, simulationTime: state.lastSimulationTime,
        wallTime: state.lastObservedWallTime, status: state.status, revision: state.revision, engineTick: null };
    const all = shared.store.getPlayerTimeHistory(shared.clockId, member.playerUsername);
    const latest = shared.store.getPlayerTimeState(shared.clockId, member.playerUsername);
    if (JSON.stringify(all.at(-1)?.state ?? null) !== JSON.stringify(latest)) throw new Error('Needs player-time source was truncated');
    const history = all.filter(entry => entry.state.updatedWallTime <= clock.wallTime);
    return { binding: populationNeedsBinding(options.worldId, member), clock, history,
        playerTime: history.at(-1)?.state ?? null };
}
/** Explicit genesis/admission only; missing legacy state stays unknown until separately admitted. */
export function initializePopulationNeeds(options: PopulationNeedsOptions, member: AgentPopulationMember,
    shared: AgentStateSimulationClock, kind: NeedsAdmission['kind']) {
    if (member.status !== 'active' || member.characterLifecycle.status !== 'active') throw new Error('Terminal lifecycle cannot initialize needs');
    const persistence = open(options);
    try {
        const source = input(options, member, shared);
        const admission: NeedsAdmission = { kind, evidenceId: member.sourceResultId, evidenceDigest: member.sourceResultDigest };
        const current = persistence.needs.get(source.binding);
        if (current) {
            if (JSON.stringify(current.admission) !== JSON.stringify(admission)) throw new Error('Needs admission source mismatch');
            return current;
        }
        return persistence.needs.initialize({ ...source, admission });
    } finally { persistence.close(); }
}
export function readPopulationNeeds(options: PopulationNeedsOptions, member: AgentPopulationMember) {
    assertNeedsPath(options);
    if (!existsSync(options.databasePath)) return { status: 'unknown' as const, state: null };
    const { policy, dynamics } = policies(options);
    const store = new NeedsStore(options.databasePath, policy, dynamics, { readonly: true });
    try { return store.read(populationNeedsBinding(options.worldId, member)); }
    finally { store.close(); }
}
/** Read-only projection/source binding. Missing data is unavailable, never a successful zero-consumption claim. */
export function readPopulationFoodApplications(options: PopulationNeedsOptions) {
    assertNeedsPath(options);
    if (!existsSync(options.databasePath)) return { status: 'unavailable' as const, applications: null, pending: null, through: null };
    const db = new OwnedFoodDatabase(options.databasePath, { readonly: true, strict: true });
    let source: NativeFoodSource | undefined;
    try {
        db.run('PRAGMA busy_timeout=5000');
        if (!db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_apply_schema'").get())
            return { status: 'unavailable' as const, applications: null, pending: null, through: null };
        const { policy, dynamics } = policies(options);
        const needs = new NeedsStore(db, policy, dynamics, { readonly: true });
        const projection = new NativeFoodConsumptionProjection(db, needs,
            loadFoodLoopCatalog(join(options.configDirectory, 'food-loops.json')), true);
        source = openPopulationFoodSource(options);
        return source.snapshot(() => {
            let view!: { status: 'available'; applications: ReturnType<NativeFoodConsumptionProjection['list']>;
                pending: number; through: SimulationClockObservation | null };
            db.transaction(() => {
                const applications = projection.verifySource(source!);
                const snapshot = source!.current();
                view = { status: 'available', applications, pending: snapshot.entries.length - applications.length,
                    through: snapshot.watermark?.clock ?? null };
            }).deferred();
            return view;
        });
    } finally { source?.close(); db.close(true); }
}
/** Replays committed clock-mode history. Separate databases need no invented distributed ACID. */
export function runPopulationNeedsCycle(agents: AgentStateStore, shared: AgentStateSimulationClock,
    options: PopulationNeedsOptions, enginePath: string, now = new Date().toISOString()) {
    assertNeedsPath(options);
    const sourceRelative = relative(physicalPath(options.workspace), physicalPath(enginePath));
    if (!sourceRelative || sourceRelative.startsWith('..')) throw new Error('Needs engine source belongs to another world');
    const members = agents.listPopulationMembers();
    if (!members.length) return { advanced: 0, unknown: [] as string[] };
    if (!existsSync(enginePath)) throw new Error('Needs terminal authority is unavailable');
    const engine = new PlayerHealthEvidenceStore(enginePath, true);
    const resources: { persistence?: FoodNeedsPersistence; foodSource?: NativeFoodSource } = {};
    try { return engine.readSnapshot(() => {
        const confirmed = engine.confirmedThrough(now);
        if (engine.schemaVersion < 2 || !confirmed) throw new Error('Needs terminal authority is unavailable');
        const foodSource = resources.foodSource = openPopulationFoodSource(options);
        return foodSource.snapshot(() => {
        const deliveries = foodSource.current(), watermark = deliveries.watermark;
        if (!watermark) throw new Error('Native food closed-tick watermark is unavailable');
        if (Date.parse(watermark.clock.wallTime) < Date.parse(now) - 30000
            || Date.parse(watermark.clock.wallTime) > Date.parse(now) + 5000) throw new Error('Native food closed-tick watermark is stale');
        const clock = shared.store.get(shared.clockId)!;
        if (watermark.clock.clockId !== clock.clockId || watermark.clock.profileDigest !== clock.profileDigest)
            throw new Error('Native food watermark clock/profile mismatch');
        const through = confirmed < watermark.clock.wallTime ? confirmed : watermark.clock.wallTime;
        if (through < clock.anchorWallTime) return { advanced: 0, unknown: [] as string[],
            waitingFor: 'native-authorities-in-current-clock-segment' as const };
        const observation = shared.store.observeThrough(shared.clockId, through);
        const persistence = resources.persistence = open(options);
        let advanced = 0; const unknown: string[] = [];
        const terminalFor = (member: AgentPopulationMember): NeedsTerminal | undefined => {
            const death = engine.deathFor(member.playerUsername);
            const finite = engine.finiteAvatar(member.playerUsername);
            const identity = healthDigest({ agentId: member.agentId, username: member.playerUsername, worldProfile: member.worldProfile,
                lifecyclePolicy: member.lifecyclePolicy, clock: member.simulationClock, joinedAt: member.joinedAtSimulationTime,
                genesisId: member.sourceResultId, genesisDigest: member.sourceResultDigest, createdAt: member.createdAt });
            if (!finite || finite.agent_id !== member.agentId || finite.identity_digest !== identity)
                throw new Error('Needs engine lifecycle binding mismatch');
            let terminal: NeedsTerminal | undefined;
            if (death) {
                if (death.agentId !== member.agentId || death.membershipDigest !== populationDeathMembershipDigest(member)
                    || death.clock.clockId !== member.simulationClock.clockId || death.clock.profileDigest !== member.simulationClock.profileDigest)
                    throw new Error('Needs death actor/lifecycle/clock mismatch');
                terminal = { kind: 'deceased', at: death.atSimulationTime, sourceId: death.eventId, sourceDigest: death.eventDigest };
            } else if (member.characterLifecycle.status === 'deceased') throw new Error('Needs death source is missing');
            else if (member.status === 'reset') terminal = { kind: 'reset', at: member.resetAtSimulationTime!,
                sourceId: member.sourceResultId, sourceDigest: digest({ reset: member.resetAtSimulationTime, source: member.sourceResultDigest }) };
            return terminal;
        };
        persistence.nativeFood.verifySource(foodSource);
        const cursor = persistence.nativeFood.cursor()?.sequence ?? 0;
        for (const entry of deliveries.entries.filter(entry => entry.sequence > cursor && entry.sequence <= watermark.sequence)) {
            if (entry.legacy || !entry.clock) throw new Error('Legacy native food result requires explicit reconciliation');
            if (entry.clock.wallTime > through) break;
            const { result } = foodSource.delivery(entry.sequence);
            const member = members.find(member => member.agentId === result.action.actorId);
            if (!member) throw new Error('Native food actor authority is missing');
            const source = input(options, member, shared, entry.clock), current = persistence.needs.get(source.binding);
            if (!current) throw new Error('Native food needs initialization is required');
            const terminal = terminalFor(member);
            if (terminal && entry.clock.simulationTime >= terminal.at) throw new Error('Native food occurs at/after terminal lifecycle');
            persistence.nativeFood.apply(foodSource, entry.sequence, { ...source, expectedRevision: current.revision });
        }
        // Reconciliation always precedes physiology; a pending earlier receipt can never be overtaken.
        for (const member of members) {
            const source = input(options, member, shared, observation), current = persistence.needs.get(source.binding);
            if (!current) { unknown.push(member.agentId); continue; }
            const terminal = terminalFor(member);
            const next = persistence.needs.advance({ ...source, expectedRevision: current.revision, terminal });
            if (next.revision !== current.revision) advanced++;
        }
        return { advanced, unknown };
        });
    });
    } finally { resources.persistence?.close(); resources.foodSource?.close(); engine.close(); }
}
