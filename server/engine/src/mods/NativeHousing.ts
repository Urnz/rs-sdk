import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import World from '../engine/World.js';
import type { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore, type PlayerInventoryEscrowWallet } from './PlayerInventoryEscrowStore.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import type { populationFoodContext } from './PopulationDeathRuntime.js';
import type { SimulationClockStore } from '../../../../simulation-clock/store.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { initializeRentJournal, writeRentJournal, rentIds, type NativeHousingCommand, type NativeRentReceipt, type NativeRentBinding } from '../../../../housing/native-rent.js';
import { NativeRentSource, readNativeRentReceipt } from '../../../../housing/native-rent-source.js';
interface SleepWitness { id: string; operationId: string; bindingDigest: string; username: string; lifecycleId: string;
    x: number; z: number; level: number; clock: SimulationClockObservation; checkpointDigest: string }
export function initializeHousingSleep(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS native_housing_sleep(sequence INTEGER PRIMARY KEY,witness_id TEXT NOT NULL UNIQUE,json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)');
        db.run('CREATE TABLE IF NOT EXISTS native_housing_sleep_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT)');
        db.run('INSERT OR IGNORE INTO native_housing_sleep_head VALUES(1,0,NULL)'); readHousingSleep(db);
    }).immediate();
}
export function readHousingSleep(db: Database): SleepWitness[] {
    let previous: string | null = null;
    const rows = db.query('SELECT * FROM native_housing_sleep ORDER BY sequence').all() as { sequence: number; witness_id: string; json: string; previous_hash: string | null; hash: string }[];
    const records = rows.map((row, index) => { const { hash, ...facts } = row, witness = JSON.parse(row.json) as SleepWitness;
        if (row.sequence !== index + 1 || row.previous_hash !== previous || witness.id !== row.witness_id || foodDigest(facts) !== hash) throw new Error('Housing sleep witness audit differs');
        previous = hash; return witness;
    });
    const head = db.query('SELECT * FROM native_housing_sleep_head WHERE id=1').get() as { sequence: number; hash: string | null } | null;
    if (!head || head.sequence !== rows.length || head.hash !== previous) throw new Error('Housing sleep witness coverage differs'); return records;
}
export interface NativeHousingPorts { market: MarketStore; source: NativeRentSource; time: SimulationClockStore;
    clock(): SimulationClockObservation; identity: typeof populationFoodContext; checkpoint(): void }
export class NativeHousingExecutor {
    constructor(private readonly p: NativeHousingPorts) {}
    private identity(binding: NativeRentBinding, player: Player, landlord = false): void {
        const i = binding.intent, actor = landlord ? i.landlord : i.tenant;
        const context = this.p.identity(player.username, rentIds(i.operationId).escrowId, 0, World.currentTick);
        if (player.username !== actor.username || player.populationTerminal || player.levels[PlayerStat.HITPOINTS]! <= 0 || !context
            || context.action.worldId !== i.worldId || context.action.actorId !== actor.agentId || context.action.lifecycleId !== actor.lifecycleId
            || context.action.clockId !== i.clockId || context.action.clockProfileDigest !== i.clockProfileDigest) throw new Error('Housing actor/lifecycle differs');
    }
    execute(command: NativeHousingCommand, tenant: Player | null, landlord: Player | null): string {
        const p = this.p, order = p.source.order(command.operationId), b = order.binding, i = b.intent;
        let clock = p.clock();
        if (command.operation === 'wake') {
            p.time.recordPlayerRest(i.clockId, i.tenant.username, 'awake', clock.wallTime, World.currentTick); if (tenant) tenant.populationSleeping = false; return 'awake';
        }
        if (command.operation === 'sleep') {
            if (clock.status !== 'running') throw new Error('Sleep admission needs a running clock');
            if (!tenant) throw new Error('Sleep needs a live tenant'); this.identity(b, tenant);
            // Identity validation may itself observe the shared clock. Bind the
            // admission and witness after it, rather than rewinding PlayerTime.
            clock = p.clock();
            const entitlement = p.source.entitlement(command.operationId, clock), bed = i.catalogs.native.beds.find(b => b.bedSlotId === i.bedSlotId)!;
            if (tenant.activeScript || tenant.protect || tenant.target || tenant.busy() || tenant.queue.head() || tenant.weakQueue.head() || tenant.engineQueue.head()
                || tenant.level !== bed.level || Math.max(Math.abs(tenant.x - bed.x), Math.abs(tenant.z - bed.z)) > 1)
                throw new Error('Tenant is busy or outside the rented bed');
            const current = p.time.getPlayerTimeState(i.clockId, tenant.username);
            if (current?.rest === 'sleeping') {
                if (current.sleepContext?.sleepPlaceId !== i.bedSlotId || !current.sleepContext.access.evidenceId.startsWith('housing:')) throw new Error('Wake before changing sleep authority');
                this.validateSleeper(tenant.username, tenant);
                if (!tenant.populationSleeping) throw new Error('Sleep authority was invalidated'); return 'sleeping';
            }
            initializeHousingSleep(p.market.db);
            const witness: SleepWitness = { id: randomUUID(), operationId: command.operationId, bindingDigest: b.digest, username: tenant.username,
                lifecycleId: i.tenant.lifecycleId, x: tenant.x, z: tenant.z, level: tenant.level, clock, checkpointDigest: foodDigest([...tenant.save(false)]) };
            p.market.db.transaction(() => {
                p.checkpoint(); p.market.checkpoint(tenant.username, tenant.save(false), true);
                const sequence = readHousingSleep(p.market.db).length + 1;
                const previous = p.market.db.query('SELECT hash FROM native_housing_sleep_head WHERE id=1').get() as { hash: string | null };
                const facts = { sequence, witness_id: witness.id, json: JSON.stringify(witness), previous_hash: previous.hash }, hash = foodDigest(facts);
                p.market.db.run('INSERT INTO native_housing_sleep VALUES(?1,?2,?3,?4,?5)', [sequence, witness.id, facts.json, previous.hash, hash]);
                p.market.db.run('UPDATE native_housing_sleep_head SET sequence=?1,hash=?2 WHERE id=1', [sequence, hash]); readHousingSleep(p.market.db);
            }).immediate();
            p.time.startPlayerSleep(i.clockId, tenant.username, { sleeperKind: 'npc-agent', sleepPlaceId: i.bedSlotId,
                fatigueRecoveryMultiplierBasisPoints: i.catalogs.recovery.fatigueRecoveryMultiplierBasisPoints,
                access: { ...entitlement.access, evidenceId: `housing:${witness.id}`, sourceDigest: foodDigest(witness) } }, clock.wallTime, World.currentTick);
            tenant.stopAction(); tenant.clearWaypoints(); tenant.populationSleeping = true; return 'sleeping';
        }
        initializeRentJournal(p.market.db, 'native_rent'); new PlayerInventoryEscrowStore(p.market);
        const prior = readNativeRentReceipt(p.market.db, b); if (prior) return prior.phase;
        if (command.operation === 'cancel') {
            const facts = { binding: b, phase: 'cancelled' as const, clock, before: { tenant: 0, landlord: 0 }, after: { tenant: 0, landlord: 0 }, checkpoints: null };
            p.market.db.transaction(() => { writeRentJournal(p.market.db, 'native_rent', { ...facts, digest: foodDigest(facts) }); }).immediate(); return 'cancelled';
        }
        if (command.operation !== 'pay' || !tenant || !landlord) throw new Error('Rent payment needs both live actors');
        p.source.order(command.operationId, clock); this.identity(b, tenant); this.identity(b, landlord, true);
        if ([tenant, landlord].some(a => a.populationSleeping || a.activeScript || a.protect || a.target || a.busy())) throw new Error('Rent payment actor is busy');
        const wallet = (a: Player): PlayerInventoryEscrowWallet => ({ count: id => a.getInventory(InvType.INV)!.getItemCount(id),
            remove: (id, n) => a.invDel(InvType.INV, id, n), add: (id, n) => a.invAdd(InvType.INV, id, n) });
        const before = { tenant: wallet(tenant).count(995), landlord: wallet(landlord).count(995) };
        if (before.tenant < i.amountGp || before.landlord > 2147483647 - i.amountGp
            || (!before.landlord && landlord.getInventory(InvType.INV)!.freeSlotCount < 1)) throw new Error('Insufficient rent funds or landlord capacity');
        const snapshots = [tenant, landlord].map(a => { const inv = a.getInventory(InvType.INV)!; return { inv, items: inv.items.map(v => v && { ...v }) }; });
        try {
            p.market.db.transaction(() => {
                p.source.order(command.operationId, p.clock()); const escrow = new PlayerInventoryEscrowStore(p.market), id = rentIds(command.operationId).escrowId;
                escrow.mutateWithCheckpoint({ operation: 'hold', escrowId: id, username: tenant.username, assets: { gp: i.amountGp, items: [] } }, wallet(tenant),
                    { owner: tenant.username, save: () => tenant.save(false), rollback: () => {} }, clock.wallTime, b.digest);
                escrow.mutateWithCheckpoint({ operation: 'commit', escrowId: id, username: tenant.username, payeeUsername: landlord.username }, wallet(landlord),
                    { owner: landlord.username, save: () => landlord.save(false), rollback: () => {} }, clock.wallTime, b.digest);
                p.checkpoint(); for (const a of [tenant, landlord]) p.market.checkpoint(a.username, a.save(false), true);
                const facts: Omit<NativeRentReceipt, 'digest'> = { binding: b, phase: 'paid', clock, before,
                    after: { tenant: wallet(tenant).count(995), landlord: wallet(landlord).count(995) },
                    checkpoints: { tenant: foodDigest([...tenant.save(false)]), landlord: foodDigest([...landlord.save(false)]) } };
                writeRentJournal(p.market.db, 'native_rent', { ...facts, digest: foodDigest(facts) }); readNativeRentReceipt(p.market.db, b);
            }).immediate(); return 'paid';
        } catch (error) { for (const { inv, items } of snapshots) items.forEach((item, slot) => inv.set(slot, item)); throw error; }
    }
    /** Reopened sleep witness, current lease and lifecycle govern online and explicitly sleeping offline tenants. */
    validateSleeper(username: string, player: Player | null): void {
        const p = this.p, clock = p.clock(), state = p.time.getPlayerTimeState(clock.clockId, username);
        if (player) player.populationSleeping = false;
        if (state?.rest !== 'sleeping' || !state.sleepContext?.access.evidenceId.startsWith('housing:')) return;
        try {
            const witness = readHousingSleep(p.market.db).find(w => `housing:${w.id}` === state.sleepContext!.access.evidenceId);
            if (!witness || foodDigest(witness) !== state.sleepContext.access.sourceDigest || witness.username !== username) throw new Error('Missing sleep witness');
            const { order } = p.source.entitlement(witness.operationId, clock), i = order.binding.intent;
            const context = p.identity(username, witness.id, 0, World.currentTick);
            if (order.binding.digest !== witness.bindingDigest || context?.action.lifecycleId !== witness.lifecycleId || context.action.actorId !== i.tenant.agentId) throw new Error('Sleeper lifecycle changed');
            const bed = i.catalogs.native.beds.find(b => b.bedSlotId === i.bedSlotId)!;
            if (player && (player.populationTerminal || player.levels[PlayerStat.HITPOINTS]! <= 0 || player.level !== bed.level
                || Math.max(Math.abs(player.x - bed.x), Math.abs(player.z - bed.z)) > 1)) throw new Error('Sleeper left the bed');
            if (player) { player.stopAction(); player.clearWaypoints(); player.populationSleeping = true; }
        } catch { const wake = p.clock(); p.time.recordPlayerRest(wake.clockId, username, 'awake', wake.wallTime, World.currentTick); }
    }
}
