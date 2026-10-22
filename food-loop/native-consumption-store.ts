import type { Database } from 'bun:sqlite';
import { foodDigest, type FoodReceipt } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { AdvanceNeedsInput, NeedsBinding, NeedsStore } from '../needs/store.js';
import type { NeedsState } from '../needs/types.js';
import type { FoodLoopCatalog } from './types.js';
import { NativeFoodSource } from './native-source.js';

export interface NativeFoodApplication {
    schemaVersion: 1; sourceId: string; sourceSequence: number; sourceDigest: string;
    actionId: string; binding: NeedsBinding; outcome: 'consumed' | 'no-use'; clock: SimulationClockObservation;
    receipt: FoodReceipt | null; catalogDigest: string; policyDigest: string; dynamicsDigest: string;
    quantity: 0 | 1; hungerBefore: number | null; hungerAfter: number | null; hungerRelief: number;
    needsBefore: NeedsState | null; needsAfter: NeedsState | null; needsRevision: number | null;
    evidenceScope: 'native-physiology-without-lineage'; previousDigest: string | null; digest: string;
}
export interface NativeFoodCursor {
    worldId: string; sourceId: string; sequence: number; sourceDigest: string | null; applicationDigest: string | null;
}
export type NativeFoodApplyPhase = 'before-needs' | 'after-needs' | 'after-event' | 'after-cursor' | 'after-commit';

/** Owns receipt use, physiological consumption events and the recovery cursor in the needs connection. */
export class NativeFoodConsumptionProjection {
    constructor(private readonly db: Database, private readonly needs: NeedsStore, private readonly catalog: FoodLoopCatalog,
        readOnly = false) {
        if (readOnly) { this.assertSchema(); return; }
        db.transaction(() => {
            db.run('CREATE TABLE IF NOT EXISTS native_food_apply_schema(version INTEGER PRIMARY KEY)');
            const versions = db.query('SELECT version FROM native_food_apply_schema').all() as { version: number }[];
            if (!versions.length) {
                if (db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_food_consumption_event','native_food_recovery','native_food_receipt_use')").get())
                    throw new Error('Incomplete native food apply schema');
                db.run(`CREATE TABLE native_food_consumption_event(sequence INTEGER PRIMARY KEY,action_id TEXT UNIQUE NOT NULL,
                    application_json TEXT NOT NULL,application_digest TEXT NOT NULL)`);
                db.run(`CREATE TABLE native_food_receipt_use(action_id TEXT PRIMARY KEY,source_digest TEXT NOT NULL,
                    application_digest TEXT NOT NULL,sequence INTEGER NOT NULL UNIQUE REFERENCES native_food_consumption_event(sequence))`);
                db.run(`CREATE TABLE native_food_recovery(singleton INTEGER PRIMARY KEY CHECK(singleton=1),cursor_json TEXT NOT NULL)`);
                db.run('INSERT INTO native_food_apply_schema VALUES(1)');
            }
            this.assertSchema();
        }).immediate();
    }
    private assertSchema(): void {
        const versions = this.db.query('SELECT version FROM native_food_apply_schema').all() as { version: number }[];
        if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native food apply schema');
        this.db.query('SELECT source_digest,application_digest,sequence FROM native_food_receipt_use LIMIT 0').all();
        this.db.query('SELECT application_json,application_digest FROM native_food_consumption_event LIMIT 0').all();
        this.db.query('SELECT cursor_json FROM native_food_recovery LIMIT 0').all();
    }
    cursor(): NativeFoodCursor | null {
        const row = this.db.query('SELECT cursor_json FROM native_food_recovery WHERE singleton=1').get() as { cursor_json: string } | null;
        return row ? JSON.parse(row.cursor_json) as NativeFoodCursor : null;
    }
    list(): NativeFoodApplication[] {
        const rows = this.db.query('SELECT * FROM native_food_consumption_event ORDER BY sequence').all() as {
            sequence: number; action_id: string; application_json: string; application_digest: string }[];
        let previous: string | null = null;
        const events = rows.map((row, index) => {
            const event = JSON.parse(row.application_json) as NativeFoodApplication, { digest, ...body } = event;
            if (event.schemaVersion !== 1 || row.sequence !== index + 1 || event.sourceSequence !== row.sequence
                || event.actionId !== row.action_id || digest !== row.application_digest || digest !== foodDigest(body)
                || event.previousDigest !== previous || !['consumed', 'no-use'].includes(event.outcome)) throw new Error('Native food application audit mismatch');
            const lock = this.db.query('SELECT * FROM native_food_receipt_use WHERE action_id=?1').get(event.actionId) as {
                sequence: number; source_digest: string; application_digest: string } | null;
            if (event.outcome === 'consumed' ? (!lock || lock.sequence !== event.sourceSequence
                || lock.source_digest !== event.sourceDigest || lock.application_digest !== event.digest || !event.receipt
                || event.quantity !== 1 || event.hungerBefore! - event.hungerAfter! !== event.hungerRelief)
                : (!!lock || event.receipt !== null || event.quantity !== 0 || event.hungerRelief !== 0))
                throw new Error('Native food receipt-use audit mismatch');
            previous = digest; return event;
        });
        const cursor = this.cursor(), last = events.at(-1);
        if (last ? (!cursor || cursor.sequence !== events.length || cursor.sourceId !== last.sourceId
            || cursor.worldId !== last.binding.worldId || cursor.sourceDigest !== last.sourceDigest
            || cursor.applicationDigest !== last.digest) : cursor !== null) throw new Error('Native food recovery audit mismatch');
        const locks = (this.db.query('SELECT COUNT(*) AS count FROM native_food_receipt_use').get() as { count: number }).count;
        if (locks !== events.filter(event => event.outcome === 'consumed').length) throw new Error('Native food receipt locks are incomplete');
        return events;
    }
    verifySource(source: NativeFoodSource): NativeFoodApplication[] {
        const snapshot = source.current(), events = this.list(), cursor = this.cursor();
        const world = this.db.query('SELECT world_id FROM needs_world WHERE singleton=1').get() as { world_id: string } | null;
        if (world && world.world_id !== source.options.worldId) throw new Error('Native nutrition database belongs to another world');
        if (cursor && (cursor.sourceId !== snapshot.sourceId || snapshot.entries[cursor.sequence - 1]?.digest !== cursor.sourceDigest))
            throw new Error('Native food source was replaced or truncated');
        for (const event of events) {
            const { entry, result } = source.delivery(event.sourceSequence);
            if (event.sourceDigest !== entry.digest || event.actionId !== entry.actionId
                || foodDigest(event.receipt) !== foodDigest(result.receipt) || event.outcome !== result.outcome)
                throw new Error('Native food application source changed');
            if (event.policyDigest !== this.needs.policy.digest || event.dynamicsDigest !== this.needs.dynamics.digest
                || event.catalogDigest !== this.catalog.digest) throw new Error('Native food application policy drift');
            if (event.outcome === 'consumed') {
                const after = this.needs.atRevision(event.binding, event.needsRevision!);
                const before = this.needs.atRevision(event.binding, event.needsRevision! - 1);
                if (foodDigest(after.state) !== foodDigest(event.needsAfter) || foodDigest(before.state) !== foodDigest(event.needsBefore)
                    || before.state.values.find(value => value.needId === 'hunger')?.value !== event.hungerBefore
                    || after.state.values.find(value => value.needId === 'hunger')?.value !== event.hungerAfter)
                    throw new Error('Native food needs audit binding mismatch');
                if (after.lastFoodReceipt?.actionId !== event.actionId || after.lastFoodReceipt.sourceId !== event.sourceId
                    || after.lastFoodReceipt.sequence !== event.sourceSequence || after.lastFoodReceipt.sourceDigest !== event.sourceDigest)
                    throw new Error('Native food needs receipt anchor mismatch');
            }
        }
        const states = this.db.query('SELECT snapshot_json FROM needs_state').all() as { snapshot_json: string }[];
        for (const row of states) {
            const stored = JSON.parse(row.snapshot_json) as import('../needs/store.js').DurableNeedsState;
            const marker = this.needs.get(stored.binding)!.lastFoodReceipt;
            if (marker && !events.some(event => event.sourceId === marker.sourceId && event.actionId === marker.actionId
                && event.sourceSequence === marker.sequence && event.sourceDigest === marker.sourceDigest))
                throw new Error('Native food projection lost its needs receipt anchor');
        }
        return events;
    }
    status(source: NativeFoodSource, sequence: number) {
        const { entry, result } = source.delivery(sequence);
        const applied = this.verifySource(source).find(event => event.sourceSequence === sequence);
        return { actionId: entry.actionId, nativeOutcome: result.outcome,
            status: applied ? (applied.outcome === 'consumed' ? 'completed' as const : 'no-use' as const)
                : 'native-committed/domain-pending' as const, application: applied ?? null };
    }
    apply(source: NativeFoodSource, sequence: number, input: AdvanceNeedsInput,
        fault?: (phase: NativeFoodApplyPhase) => void): NativeFoodApplication {
        let application!: NativeFoodApplication;
        source.snapshot(() => {
            this.db.transaction(() => {
                const events = this.verifySource(source), snapshot = source.current();
                const { entry, result } = source.delivery(sequence), action = result.action, b = input.binding;
                if (action.actorId !== b.actorId || action.username !== b.playerId || action.lifecycleId !== b.lifecycleId
                    || action.worldId !== b.worldId || action.clockId !== b.clockId || action.clockProfileDigest !== b.clockProfileDigest)
                    throw new Error('Native consumption actor/lifecycle/world/clock mismatch');
                if (!this.needs.get(b)) throw new Error('Native consumption needs initialization is required');
                const replay = events.find(event => event.actionId === action.actionId);
                if (replay) {
                    if (foodDigest(replay.binding) !== foodDigest(b) || replay.catalogDigest !== this.catalog.digest
                        || replay.policyDigest !== this.needs.policy.digest || replay.dynamicsDigest !== this.needs.dynamics.digest)
                        throw new Error('Native consumption replay policy/binding mismatch');
                    application = replay; return;
                }
                const cursor = this.cursor();
                if (sequence !== (cursor?.sequence ?? 0) + 1) throw new Error('Native consumption source order mismatch');
                if (!snapshot.watermark || sequence > snapshot.watermark.sequence) throw new Error('Native food tick is not closed');
                if (entry.legacy || !entry.clock) throw new Error('Legacy native food result requires explicit reconciliation');
                if (entry.clock.simulationTime !== input.clock.simulationTime) throw new Error('Native consumption event time mismatch');
                if (this.db.query('SELECT 1 FROM food_receipt_use WHERE receipt_id IN (?1,?2)').get(action.actionId, `native:${action.actionId}`))
                    throw new Error('Native food receipt already used by a legacy closure');
                fault?.('before-needs');
                const applied = result.outcome === 'consumed' ? this.needs.applyNativeFood(input, source, sequence, this.catalog) : null;
                fault?.('after-needs');
                const body: Omit<NativeFoodApplication, 'digest'> = { schemaVersion: 1, sourceId: snapshot.sourceId,
                    sourceSequence: sequence, sourceDigest: entry.digest, actionId: action.actionId, binding: b,
                    outcome: result.outcome, clock: entry.clock, receipt: result.receipt, catalogDigest: this.catalog.digest,
                    policyDigest: this.needs.policy.digest, dynamicsDigest: this.needs.dynamics.digest,
                    quantity: applied ? 1 : 0, hungerBefore: applied?.hungerBefore ?? null, hungerAfter: applied?.hungerAfter ?? null,
                    hungerRelief: applied?.hungerRelief ?? 0, needsBefore: applied?.before.state ?? null,
                    needsAfter: applied?.after.state ?? null, needsRevision: applied?.after.revision ?? null,
                    evidenceScope: 'native-physiology-without-lineage', previousDigest: cursor?.applicationDigest ?? null };
                application = { ...body, digest: foodDigest(body) };
                this.db.run('INSERT INTO native_food_consumption_event VALUES(?1,?2,?3,?4)',
                    [sequence, action.actionId, JSON.stringify(application), application.digest]);
                if (applied) this.db.run('INSERT INTO native_food_receipt_use VALUES(?1,?2,?3,?4)',
                    [action.actionId, entry.digest, application.digest, sequence]);
                fault?.('after-event');
                const next: NativeFoodCursor = { worldId: b.worldId, sourceId: snapshot.sourceId,
                    sequence, sourceDigest: entry.digest, applicationDigest: application.digest };
                this.db.run(`INSERT INTO native_food_recovery VALUES(1,?1)
                    ON CONFLICT(singleton) DO UPDATE SET cursor_json=excluded.cursor_json`, [JSON.stringify(next)]);
                fault?.('after-cursor');
            }).immediate();
        });
        fault?.('after-commit');
        return application;
    }
}
