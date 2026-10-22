import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { playerTimeHistoryDigest } from '../simulation-clock/store.js';
import type { PlayerTimeHistoryEntry, PlayerTimeState, SimulationClockObservation } from '../simulation-clock/types.js';
import { advanceNeedsFromClock, validateNeedsDynamicsPolicy } from './dynamics.js';
import { createInitialNeedsState, validateNeedsPolicy, validateNeedsState } from './profile.js';
import type { NeedsDynamicsPolicy, NeedsPolicy, NeedsState } from './types.js';
import { needsStateDigest } from './profile.js';
import { NativeFoodSource } from '../food-loop/native-source.js';
import { foodLoopCatalogDigest } from '../food-loop/catalog.js';
import type { FoodLoopCatalog } from '../food-loop/types.js';

export interface NeedsBinding {
    worldId: string; actorId: string; playerId: string; lifecycleId: string; clockId: string;
    clockProfileDigest: string; worldProfileDigest: string; lifecyclePolicyDigest: string;
}
export interface NeedsAdmission {
    kind: 'genesis' | 'admission' | 'legacy-explicit'; evidenceId: string; evidenceDigest: string;
}
export interface NeedsTerminal {
    kind: 'deceased' | 'reset'; at: string; sourceId: string; sourceDigest: string;
}
export interface DurableNeedsState {
    schemaVersion: 1; binding: NeedsBinding; policyDigest: string; dynamicsDigest: string;
    admission: NeedsAdmission; admissionDigest: string; revision: number; state: NeedsState;
    presence: 'online' | 'offline'; rest: 'awake' | 'sleeping'; sleepUntil: string | null;
    playerTimeRevision: number; playerTimeDigest: string | null; terminal: NeedsTerminal | null;
    sleepRecoveryBasisPoints?: number;
    lastFoodReceipt?: { sourceId: string; sequence: number; actionId: string; sourceDigest: string };
}
export interface NeedsClockInput {
    binding: NeedsBinding; clock: SimulationClockObservation;
    history: PlayerTimeHistoryEntry[]; playerTime: PlayerTimeState | null;
}
export interface InitializeNeedsInput extends NeedsClockInput { admission: NeedsAdmission }
export interface AdvanceNeedsInput extends NeedsClockInput { expectedRevision: number; terminal?: NeedsTerminal }
export type NeedsWriteCommand = { kind: 'initialize'; input: InitializeNeedsInput }
    | { kind: 'advance'; input: AdvanceNeedsInput };

const HASH = /^[0-9a-f]{64}$/;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function time(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Needs time is invalid');
    return parsed;
}
function binding(value: NeedsBinding): NeedsBinding {
    if (!value || Object.keys(value).sort().join(',') !==
        'actorId,clockId,clockProfileDigest,lifecycleId,lifecyclePolicyDigest,playerId,worldId,worldProfileDigest'
        || [value.worldId, value.actorId, value.lifecycleId, value.clockId].some(id =>
            typeof id !== 'string' || id.length < 1 || id.length > 256)
        || typeof value.playerId !== 'string' || !/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(value.playerId)
        || [value.clockProfileDigest, value.worldProfileDigest, value.lifecyclePolicyDigest].some(value => !HASH.test(value)))
        throw new Error('Needs binding is invalid');
    return { worldId: value.worldId, actorId: value.actorId, playerId: value.playerId, lifecycleId: value.lifecycleId,
        clockId: value.clockId, clockProfileDigest: value.clockProfileDigest,
        worldProfileDigest: value.worldProfileDigest, lifecyclePolicyDigest: value.lifecyclePolicyDigest };
}
function key(value: NeedsBinding): string { return hash([value.worldId, value.actorId, value.lifecycleId]); }
function validateClock(input: NeedsClockInput): void {
    binding(input.binding);
    if (input.clock.clockId !== input.binding.clockId || input.clock.profileDigest !== input.binding.clockProfileDigest
        || !['running', 'paused'].includes(input.clock.status) || !Number.isSafeInteger(input.clock.revision)
        || input.clock.revision < 1) throw new Error('Needs clock/profile mismatch');
    time(input.clock.simulationTime); time(input.clock.wallTime);
    let previous: PlayerTimeHistoryEntry | null = null;
    for (const entry of input.history) {
        const { digest, ...body } = entry;
        if (digest !== playerTimeHistoryDigest(body) || entry.previousDigest !== (previous?.digest ?? null)
            || entry.state.clockId !== input.binding.clockId || entry.state.playerId !== input.binding.playerId
            || !Number.isSafeInteger(entry.state.revision)
            || entry.state.revision < 1 || !['online', 'offline'].includes(entry.state.presence)
            || !['awake', 'sleeping'].includes(entry.state.rest)
            || (previous && (entry.state.revision !== previous.state.revision + 1
                || entry.state.playerId !== previous.state.playerId || entry.state.updatedAt < previous.state.updatedAt)))
            throw new Error('Needs player-time history mismatch');
        time(entry.state.updatedAt);
        if (entry.state.updatedAt > input.clock.simulationTime) throw new Error('Needs history is ahead of clock');
        if (entry.state.rest === 'sleeping' && !entry.state.sleepContext) throw new Error('Needs sleep access is missing');
        previous = entry;
    }
    if (JSON.stringify(previous?.state ?? null) !== JSON.stringify(input.playerTime))
        throw new Error('Needs player-time history is missing or truncated');
}

/** Domain authority. All writes use BEGIN IMMEDIATE and an optimistic revision; no wall-time physiology. */
export class NeedsStore {
    private readonly database: Database;
    private readonly ownsDatabase: boolean;
    readonly policy: NeedsPolicy;
    readonly dynamics: NeedsDynamicsPolicy;
    private readonly readOnly: boolean;
    private schemaAvailable = true;
    constructor(path: string | Database, policy: NeedsPolicy, dynamics: NeedsDynamicsPolicy, options: { readonly?: boolean } = {}) {
        const { digest: supplied, ...definition } = policy;
        this.policy = validateNeedsPolicy(definition);
        const { digest: suppliedDynamics, ...dynamicsDefinition } = dynamics;
        this.dynamics = validateNeedsDynamicsPolicy(dynamicsDefinition, this.policy);
        if (supplied !== this.policy.digest || suppliedDynamics !== this.dynamics.digest) throw new Error('Needs policy digest mismatch');
        this.ownsDatabase = typeof path === 'string';
        this.readOnly = options.readonly ?? false;
        if (typeof path === 'string' && !this.readOnly) mkdirSync(dirname(path), { recursive: true });
        this.database = typeof path === 'string' ? new Database(path, this.readOnly
            ? { readonly: true, strict: true } : { create: true, strict: true }) : path;
        try {
            this.database.run('PRAGMA busy_timeout=5000');
            if (this.readOnly) {
                this.schemaAvailable = !!this.database.query("SELECT 1 FROM sqlite_master WHERE name='needs_schema'").get();
                if (!this.schemaAvailable) {
                    if (this.database.query("SELECT 1 FROM sqlite_master WHERE name IN ('needs_state','needs_event')").get())
                        throw new Error('Incomplete needs schema');
                    return;
                }
                const versions = this.database.query('SELECT version FROM needs_schema').all() as { version: number }[];
                if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported needs schema');
                return;
            }
            this.database.run('PRAGMA foreign_keys=ON');
            this.database.transaction(() => {
                this.database.run('CREATE TABLE IF NOT EXISTS needs_schema(version INTEGER PRIMARY KEY)');
                const rows = this.database.query('SELECT version FROM needs_schema').all() as { version: number }[];
                if (rows.length && (rows.length !== 1 || rows[0]!.version !== 1)) throw new Error('Unsupported needs schema');
                if (!rows.length) {
                    if (this.database.query("SELECT 1 FROM sqlite_master WHERE name IN ('needs_state','needs_event')").get())
                        throw new Error('Incomplete needs schema');
                    this.database.run(`CREATE TABLE needs_state(state_key TEXT PRIMARY KEY,world_id TEXT NOT NULL,
                        actor_id TEXT NOT NULL,lifecycle_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
                        snapshot_json TEXT NOT NULL,snapshot_digest TEXT NOT NULL,UNIQUE(world_id,actor_id,lifecycle_id))`);
                    this.database.run(`CREATE TABLE needs_event(state_key TEXT NOT NULL REFERENCES needs_state(state_key),
                        revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,snapshot_digest TEXT NOT NULL,
                        previous_digest TEXT,PRIMARY KEY(state_key,revision))`);
                    this.database.run('CREATE TABLE needs_world(singleton INTEGER PRIMARY KEY CHECK(singleton=1),world_id TEXT NOT NULL)');
                    this.database.run('INSERT INTO needs_schema VALUES(1)');
                }
                this.database.query('SELECT world_id FROM needs_world LIMIT 0').all();
                this.database.query('SELECT state_key,revision,snapshot_json,snapshot_digest FROM needs_state LIMIT 0').all();
                this.database.query('SELECT state_key,revision,previous_digest FROM needs_event LIMIT 0').all();
            }).immediate();
        } catch (error) { if (this.ownsDatabase) this.database.close(true); throw error; }
    }
    close(): void { if (this.ownsDatabase) this.database.close(true); }
    read(raw: NeedsBinding): { status: 'unknown'; state: null } | { status: 'initialized'; state: DurableNeedsState } {
        const value = this.get(raw);
        return value ? { status: 'initialized', state: value } : { status: 'unknown', state: null };
    }
    get(raw: NeedsBinding): DurableNeedsState | null {
        let result!: DurableNeedsState | null;
        this.database.transaction(() => { result = this.readCurrent(raw); }).deferred();
        return result;
    }
    atRevision(raw: NeedsBinding, revision: number): DurableNeedsState {
        let result!: DurableNeedsState;
        this.database.transaction(() => {
            const current = this.readCurrent(raw);
            if (!current || !Number.isSafeInteger(revision) || revision < 1 || revision > current.revision)
                throw new Error('Needs audit revision is missing');
            const row = this.database.query('SELECT snapshot_json FROM needs_event WHERE state_key=?1 AND revision=?2')
                .get(key(binding(raw)), revision) as { snapshot_json: string };
            result = JSON.parse(row.snapshot_json) as DurableNeedsState;
        }).deferred();
        return result;
    }
    private readCurrent(raw: NeedsBinding): DurableNeedsState | null {
        const expected = binding(raw);
        if (!this.schemaAvailable) return null;
        const world = this.database.query('SELECT world_id FROM needs_world WHERE singleton=1').get() as { world_id: string } | null;
        if (world && world.world_id !== expected.worldId) throw new Error('Needs database belongs to another world');
        const row = this.database.query('SELECT * FROM needs_state WHERE state_key=?1').get(key(expected)) as
            { revision: number; snapshot_json: string; snapshot_digest: string } | null;
        if (!row) return null;
        const value = JSON.parse(row.snapshot_json) as DurableNeedsState;
        if (row.snapshot_digest !== hash(value) || row.revision !== value.revision
            || JSON.stringify(binding(value.binding)) !== JSON.stringify(expected)
            || value.policyDigest !== this.policy.digest || value.dynamicsDigest !== this.dynamics.digest)
            throw new Error('Needs stored binding/policy/digest mismatch');
        const { digest, ...definition } = value.state;
        if (validateNeedsState(definition, this.policy).digest !== digest
            || value.state.characterAgentId !== expected.actorId || value.state.clockId !== expected.clockId)
            throw new Error('Needs stored state mismatch');
        const events = this.database.query('SELECT * FROM needs_event WHERE state_key=?1 ORDER BY revision')
            .all(key(expected)) as { revision: number; snapshot_json: string; snapshot_digest: string; previous_digest: string | null }[];
        let previous: string | null = null;
        for (const [index, event] of events.entries()) {
            if (event.revision !== index + 1 || event.previous_digest !== previous
                || event.snapshot_digest !== hash(JSON.parse(event.snapshot_json))) throw new Error('Needs audit is corrupt');
            previous = event.snapshot_digest;
        }
        if (events.length !== value.revision || previous !== row.snapshot_digest) throw new Error('Needs audit is incomplete');
        return value;
    }
    execute(command: NeedsWriteCommand): DurableNeedsState {
        return command.kind === 'initialize' ? this.initialize(command.input) : this.advance(command.input);
    }
    initialize(input: InitializeNeedsInput): DurableNeedsState {
        if (this.readOnly) throw new Error('Needs store is read-only');
        validateClock(input);
        if (!['genesis', 'admission', 'legacy-explicit'].includes(input.admission.kind)
            || !input.admission.evidenceId || input.admission.evidenceId.length > 256
            || !HASH.test(input.admission.evidenceDigest)) throw new Error('Explicit needs admission evidence is required');
        const normalized = binding(input.binding), admissionDigest = hash({ binding: normalized,
            admission: input.admission, clock: input.clock, playerTime: input.playerTime,
            policy: this.policy.digest, dynamics: this.dynamics.digest });
        let result!: DurableNeedsState;
        this.database.transaction(() => {
            const existing = this.get(normalized);
            if (existing) {
                if (existing.admissionDigest !== admissionDigest) throw new Error('Needs admission conflicts with existing state');
                result = existing; return;
            }
            this.database.run('INSERT OR IGNORE INTO needs_world VALUES(1,?1)', [normalized.worldId]);
            const tip = input.history.at(-1);
            if (tip && tip.profileDigest !== normalized.clockProfileDigest) throw new Error('Needs admission profile mismatch');
            const value: DurableNeedsState = { schemaVersion: 1, binding: normalized, policyDigest: this.policy.digest,
                dynamicsDigest: this.dynamics.digest, admission: input.admission, admissionDigest, revision: 1,
                state: createInitialNeedsState(this.policy, { characterAgentId: normalized.actorId, clockId: normalized.clockId,
                    observedAtSimulationTime: input.clock.simulationTime }),
                presence: tip?.state.presence ?? 'offline', rest: tip?.state.rest ?? 'awake',
                sleepUntil: tip?.state.sleepContext?.access.validUntilSimulationTime ?? null,
                ...(tip?.state.sleepContext?.fatigueRecoveryMultiplierBasisPoints !== undefined ? { sleepRecoveryBasisPoints: tip.state.sleepContext.fatigueRecoveryMultiplierBasisPoints } : {}),
                playerTimeRevision: tip?.state.revision ?? 0, playerTimeDigest: tip?.digest ?? null, terminal: null };
            this.persist(value, null); result = value;
        }).immediate();
        return result;
    }
    advance(input: AdvanceNeedsInput): DurableNeedsState {
        if (this.readOnly) throw new Error('Needs store is read-only');
        validateClock(input);
        let result!: DurableNeedsState;
        this.database.transaction(() => {
            const current = this.get(input.binding);
            if (!current) throw new Error('Needs state is unknown; explicit initialization required');
            if (!Number.isSafeInteger(input.expectedRevision) || current.revision !== input.expectedRevision)
                throw new Error('Needs revision conflict');
            if (current.terminal) {
                if (input.terminal && hash(input.terminal) !== hash(current.terminal)) throw new Error('Needs terminal evidence mismatch');
                result = current; return;
            }
            if (input.clock.simulationTime < current.state.observedAtSimulationTime) throw new Error('Needs time must be monotonic');
            if (current.playerTimeRevision > 0 && !input.history.some(entry => entry.state.revision === current.playerTimeRevision
                && entry.digest === current.playerTimeDigest)) throw new Error('Needs player-time cursor was replaced or truncated');
            const next = structuredClone(current);
            let until = input.clock.simulationTime;
            if (input.terminal) {
                time(input.terminal.at);
                if (!['deceased', 'reset'].includes(input.terminal.kind) || !input.terminal.sourceId
                    || !HASH.test(input.terminal.sourceDigest) || input.terminal.at > until
                    || input.terminal.at < current.state.observedAtSimulationTime) throw new Error('Needs terminal time/evidence mismatch');
                until = input.terminal.at;
                next.terminal = input.terminal;
            }
            const advanceTo = (at: string) => {
                // Existing pure dynamics bounds one step to 366 days. Splitting preserves fixed-point remainders.
                while (next.state.observedAtSimulationTime < at) {
                    const from = time(next.state.observedAtSimulationTime);
                    let end = Math.min(time(at), from + 366 * 86_400_000);
                    if (next.rest === 'sleeping' && next.sleepUntil && time(next.sleepUntil) > from)
                        end = Math.min(end, time(next.sleepUntil));
                    const rest = next.rest === 'sleeping' && next.sleepUntil && next.sleepUntil <= next.state.observedAtSimulationTime
                        ? 'awake' : next.rest;
                    next.state = advanceNeedsFromClock(next.state, { ...input.clock, simulationTime: new Date(end).toISOString() },
                        next.presence, rest, this.policy, this.dynamics, next.sleepRecoveryBasisPoints ?? 10000).state;
                }
            };
            for (const entry of input.history.filter(item => item.state.revision > current.playerTimeRevision)) {
                if (entry.state.updatedAt > until) break;
                if (entry.profileDigest !== next.binding.clockProfileDigest
                    || entry.state.updatedAt < next.state.observedAtSimulationTime
                    || entry.state.revision !== next.playerTimeRevision + 1) throw new Error('Needs mode history has a gap or profile drift');
                advanceTo(entry.state.updatedAt);
                next.presence = entry.state.presence; next.rest = entry.state.rest;
                next.sleepUntil = entry.state.sleepContext?.access.validUntilSimulationTime ?? null;
                next.sleepRecoveryBasisPoints = entry.state.sleepContext?.fatigueRecoveryMultiplierBasisPoints ?? 10000;
                next.playerTimeRevision = entry.state.revision; next.playerTimeDigest = entry.digest;
            }
            advanceTo(until);
            if (hash(next) === hash(current)) { result = current; return; }
            next.revision++;
            this.persist(next, current); result = next;
        }).immediate();
        return result;
    }
    /** Backend-only typed receipt apply. The owning food transaction must also commit the receipt lock and event. */
    applyNativeFood(input: AdvanceNeedsInput, source: NativeFoodSource, sequence: number, catalog: FoodLoopCatalog) {
        if (this.readOnly || !this.database.inTransaction) throw new Error('Native relief requires the shared food transaction');
        const { entry, result } = source.delivery(sequence), receipt = result.receipt;
        const b = input.binding;
        if (entry.legacy || !receipt || result.outcome !== 'consumed' || !entry.clock
            || receipt.worldId !== b.worldId || receipt.actorId !== b.actorId || receipt.username !== b.playerId
            || receipt.lifecycleId !== b.lifecycleId || receipt.clockId !== b.clockId || receipt.clockProfileDigest !== b.clockProfileDigest
            || receipt.clock.simulationTime !== input.clock.simulationTime || input.terminal)
            throw new Error('Native food needs binding/outcome/time mismatch');
        const { digest, ...definition } = catalog;
        const chain = catalog.chains.find(chain => chain.foodChainId === 'lobster' && chain.cookedItem.itemId === receipt.itemId);
        if (digest !== foodLoopCatalogDigest(definition) || !chain) throw new Error('Native food catalog mismatch');
        const before = this.advance(input);
        if (before.terminal) throw new Error('Terminal needs cannot receive relief');
        const history = this.database.query('SELECT snapshot_json FROM needs_event WHERE state_key=?1').all(key(binding(b))) as
            { snapshot_json: string }[];
        if (history.some(row => (JSON.parse(row.snapshot_json) as DurableNeedsState).lastFoodReceipt?.actionId === result.action.actionId))
            throw new Error('Native food receipt already present in needs audit; projection reconciliation required');
        const next = structuredClone(before), hunger = next.state.values.find(value => value.needId === 'hunger')!;
        const hungerBefore = hunger.value;
        hunger.value = Math.max(0, hungerBefore - chain.hungerRelief);
        const { digest: oldDigest, ...stateDefinition } = next.state;
        next.state = { ...stateDefinition, digest: needsStateDigest(stateDefinition) };
        next.lastFoodReceipt = { sourceId: source.current().sourceId, sequence, actionId: result.action.actionId, sourceDigest: entry.digest };
        next.revision++;
        this.persist(next, before);
        return { before, after: next, hungerBefore, hungerAfter: hunger.value, hungerRelief: hungerBefore - hunger.value };
    }
    private persist(next: DurableNeedsState, previous: DurableNeedsState | null): void {
        const stateKey = key(next.binding), json = JSON.stringify(next), digest = hash(next);
        if (previous) {
            const update = this.database.run(`UPDATE needs_state SET revision=?2,snapshot_json=?3,snapshot_digest=?4
                WHERE state_key=?1 AND revision=?5`, [stateKey, next.revision, json, digest, previous.revision]);
            if (update.changes !== 1) throw new Error('Needs revision conflict');
        } else this.database.run('INSERT INTO needs_state VALUES(?1,?2,?3,?4,?5,?6,?7)',
            [stateKey, next.binding.worldId, next.binding.actorId, next.binding.lifecycleId, next.revision, json, digest]);
        this.database.run('INSERT INTO needs_event VALUES(?1,?2,?3,?4,?5)',
            [stateKey, next.revision, json, digest, previous ? hash(previous) : null]);
    }
}
