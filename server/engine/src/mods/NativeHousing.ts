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
import { readHousingSleep,type SleepWitness,type NativeHousingSleepObservation } from '../../../../housing/native-sleep.js';
import type {NativeOwnerBedBinding} from '../../../../housing/native-owner.js';
import type {CommerceActor} from '../../../../agent-operated-shop/native-commerce.js';
export { readHousingSleep } from '../../../../housing/native-sleep.js';
export function initializeHousingSleep(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS native_housing_sleep(sequence INTEGER PRIMARY KEY,witness_id TEXT NOT NULL UNIQUE,json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)');
        db.run('CREATE TABLE IF NOT EXISTS native_housing_sleep_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT)');
        db.run('INSERT OR IGNORE INTO native_housing_sleep_head VALUES(1,0,NULL)'); readHousingSleep(db);
    }).immediate();
}
export interface NativeHousingPorts { market: MarketStore; source: NativeRentSource; time: SimulationClockStore;
    clock(): SimulationClockObservation; identity: typeof populationFoodContext; checkpoint(): void }
export class NativeHousingExecutor {
    constructor(private readonly p: NativeHousingPorts) {}
    private identity(binding: NativeRentBinding, player: Player, landlord = false): void {
        const i = binding.intent, actor = landlord ? i.landlord : i.tenant;
        this.actorIdentity(i,actor,player);
    }
    private actorIdentity(i:{operationId:string;worldId:string;clockId:string;clockProfileDigest:string},actor:CommerceActor,player:Player){
        const context = this.p.identity(player.username, rentIds(i.operationId).escrowId, 0, World.currentTick);
        if (player.username !== actor.username || player.populationTerminal || player.levels[PlayerStat.HITPOINTS]! <= 0 || !context
            || context.action.username!==actor.username||context.action.worldId !== i.worldId || context.action.actorId !== actor.agentId || context.action.lifecycleId !== actor.lifecycleId
            || context.action.clockId !== i.clockId || context.action.clockProfileDigest !== i.clockProfileDigest) throw new Error('Housing actor/lifecycle differs');
    }
    private sleepAuthority(operationId:string,clock:SimulationClockObservation,owner:boolean){
        if(owner){const binding=this.p.source.ownerBed(operationId,clock),i=binding.intent;
            return{bindingDigest:binding.digest,intent:i,actor:i.owner,ownerBinding:binding as NativeOwnerBedBinding|undefined,
                access:{kind:'bed-entitlement' as const,evidenceId:`owner:${operationId}`,sourceDigest:binding.digest,validUntilSimulationTime:i.endsAt}};}
        const {order,access}=this.p.source.entitlement(operationId,clock);
        return{bindingDigest:order.binding.digest,intent:order.binding.intent,actor:order.binding.intent.tenant,ownerBinding:undefined as NativeOwnerBedBinding|undefined,access};
    }
    execute(command: NativeHousingCommand, tenant: Player | null, landlord: Player | null): string {
        const p = this.p,ownerCommand=command.operation==='owner-sleep'||command.operation==='owner-wake',
            binding=ownerCommand?p.source.ownerBed(command.operationId):p.source.order(command.operationId).binding,i=binding.intent,
            actor='owner' in i?i.owner:i.tenant;
        let clock = p.clock();
        if (command.operation === 'wake'||command.operation==='owner-wake') {
            p.time.recordPlayerRest(i.clockId, actor.username, 'awake', clock.wallTime, World.currentTick); if (tenant) tenant.populationSleeping = false; return 'awake';
        }
        if (command.operation === 'sleep'||command.operation==='owner-sleep') {
            if (clock.status !== 'running') throw new Error('Sleep admission needs a running clock');
            if (!tenant) throw new Error('Sleep needs a live tenant'); this.actorIdentity(i,actor,tenant);
            // Identity validation may itself observe the shared clock. Bind the
            // admission and witness after it, rather than rewinding PlayerTime.
            clock = p.clock();
            const authority=this.sleepAuthority(command.operationId,clock,ownerCommand),bed=i.catalogs.native.beds.find(b=>b.bedSlotId===i.bedSlotId)!;
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
            const witness: SleepWitness = { id: randomUUID(), operationId: command.operationId, bindingDigest: binding.digest, username: tenant.username,
                lifecycleId: actor.lifecycleId, x: tenant.x, z: tenant.z, level: tenant.level, clock, checkpointDigest: foodDigest([...tenant.save(false)]),
                ...authority.ownerBinding?{ownerBinding:authority.ownerBinding}:{} };
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
                access: { ...authority.access, evidenceId: `housing:${witness.id}`, sourceDigest: foodDigest(witness) } }, clock.wallTime, World.currentTick);
            tenant.stopAction(); tenant.clearWaypoints(); tenant.populationSleeping = true; return 'sleeping';
        }
        if(ownerCommand)throw Error('Unsupported owner housing command');
        const b=binding as NativeRentBinding;
        const rent=b.intent;
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
        if (before.tenant < rent.amountGp || before.landlord > 2147483647 - rent.amountGp
            || (!before.landlord && landlord.getInventory(InvType.INV)!.freeSlotCount < 1)) throw new Error('Insufficient rent funds or landlord capacity');
        const snapshots = [tenant, landlord].map(a => { const inv = a.getInventory(InvType.INV)!; return { inv, items: inv.items.map(v => v && { ...v }) }; });
        try {
            p.market.db.transaction(() => {
                p.source.order(command.operationId, p.clock()); const escrow = new PlayerInventoryEscrowStore(p.market), id = rentIds(command.operationId).escrowId;
                escrow.mutateWithCheckpoint({ operation: 'hold', escrowId: id, username: tenant.username, assets: { gp: rent.amountGp, items: [] } }, wallet(tenant),
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
    /** Read-only observer path. The fail-closed populationSleeping flag is never itself an entitlement. */
    observeSleeper(username:string,player:Player,clock:SimulationClockObservation):NativeHousingSleepObservation|null{
        if(clock.status!=='running'||clock.engineTick===null||!Number.isSafeInteger(clock.engineTick)||clock.engineTick<0)return null;
        const p=this.p,state=p.time.getPlayerTimeState(clock.clockId,username);
        if(!player.populationSleeping||player.populationTerminal||player.loggingOut||state?.rest!=='sleeping'||!state.sleepContext?.access.evidenceId.startsWith('housing:'))return null;
        const witness=readHousingSleep(p.market.db).find(w=>`housing:${w.id}`===state.sleepContext!.access.evidenceId);
        if(!witness||foodDigest(witness)!==state.sleepContext.access.sourceDigest||witness.username!==username)throw Error('Missing sleep observer witness');
        const authority=this.sleepAuthority(witness.operationId,clock,!!witness.ownerBinding),{intent:i,actor,access}=authority,context=p.identity(username,witness.id,0,clock.engineTick!);
        const bed=i.catalogs.native.beds.find(b=>b.bedSlotId===i.bedSlotId)!;
        if(!context||context.action.actorId!==actor.agentId||context.action.username!==username||context.action.lifecycleId!==witness.lifecycleId
            ||context.action.worldId!==i.worldId||context.action.clockId!==clock.clockId||context.action.clockProfileDigest!==clock.profileDigest
            ||context.clock.engineTick!==clock.engineTick||context.clock.status!=='running'||context.clock.simulationTime<clock.simulationTime
            ||context.clock.simulationTime>=i.endsAt
            ||authority.bindingDigest!==witness.bindingDigest||(witness.ownerBinding&&foodDigest(witness.ownerBinding)!==foodDigest(authority.ownerBinding))
            ||state.sleepContext.sleepPlaceId!==i.bedSlotId||witness.clock.simulationTime>clock.simulationTime
            ||player.levels[PlayerStat.HITPOINTS]!<=0||player.level!==bed.level||Math.max(Math.abs(player.x-bed.x),Math.abs(player.z-bed.z))>1)throw Error('Sleep observer authority/position differs');
        return{kind:'native-housing-sleep-v1',witnessId:witness.id,witnessDigest:foodDigest(witness),bindingDigest:witness.bindingDigest,
            username,lifecycleId:witness.lifecycleId,observedAtSimulationTime:clock.simulationTime,validUntilSimulationTime:access.validUntilSimulationTime};
    }
    /** Reopened sleep witness, current lease and lifecycle govern online and explicitly sleeping offline tenants. */
    validateSleeper(username: string, player: Player | null): void {
        const p = this.p, clock = p.clock(), state = p.time.getPlayerTimeState(clock.clockId, username);
        if (player) player.populationSleeping = false;
        if (state?.rest !== 'sleeping' || !state.sleepContext?.access.evidenceId.startsWith('housing:')) return;
        try {
            const witness = readHousingSleep(p.market.db).find(w => `housing:${w.id}` === state.sleepContext!.access.evidenceId);
            if (!witness || foodDigest(witness) !== state.sleepContext.access.sourceDigest || witness.username !== username) throw new Error('Missing sleep witness');
            const authority=this.sleepAuthority(witness.operationId,clock,!!witness.ownerBinding),{intent:i,actor}=authority;
            const context = p.identity(username, witness.id, 0, World.currentTick);
            if (authority.bindingDigest !== witness.bindingDigest || context?.action.lifecycleId !== witness.lifecycleId || context.action.actorId !== actor.agentId
                ||context.action.worldId!==i.worldId||context.action.clockId!==i.clockId||context.action.clockProfileDigest!==i.clockProfileDigest
                ||(witness.ownerBinding&&foodDigest(witness.ownerBinding)!==foodDigest(authority.ownerBinding))) throw new Error('Sleeper lifecycle changed');
            const bed = i.catalogs.native.beds.find(b => b.bedSlotId === i.bedSlotId)!;
            if (player && (player.populationTerminal || player.levels[PlayerStat.HITPOINTS]! <= 0 || player.level !== bed.level
                || Math.max(Math.abs(player.x - bed.x), Math.abs(player.z - bed.z)) > 1)) throw new Error('Sleeper left the bed');
            if (player) { player.stopAction(); player.clearWaypoints(); player.populationSleeping = true; }
        } catch { const wake = p.clock(); p.time.recordPlayerRest(wake.clockId, username, 'awake', wake.wallTime, World.currentTick); }
    }
}
