import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import NpcType from '../cache/config/NpcType.js';
import LocType from '../cache/config/LocType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import VarNpcType from '../cache/config/VarNpcType.js';
import VarBitType from '../cache/config/VarBitType.js';
import ParamType from '../cache/config/ParamType.js';
import EnumType from '../cache/config/EnumType.js';
import StructType from '../cache/config/StructType.js';
import SeqType from '../cache/config/SeqType.js';
import DbRowType from '../cache/config/DbRowType.js';
import DbTableType from '../cache/config/DbTableType.js';
import DbTableIndex from '../cache/config/DbTableIndex.js';
import FontType from '../cache/config/FontType.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import Player from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import Packet from '../io/Packet.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { OwnedDatabase } from '../io/OwnedDatabase.js';
import { PropertyStore } from './PropertyStore.js';
import { loadPropertyCatalog } from './Properties.js';
import { PropertyRuntime } from './PropertyRuntime.js';
import { registerHousingTenantAccess } from './HousingAccess.js';
import { NativeHousingExecutor } from './NativeHousing.js';
import { NativeRentCoordinator } from '../../../../housing/native-rent-runtime.js';
import { NativeRentSource, openNativeRentReceipt } from '../../../../housing/native-rent-source.js';
import { nativeHousingCatalogs, rentIds, type NativeRentIntent, type HousingNativeOptions } from '../../../../housing/native-rent.js';
import { HousingTenancyStore } from '../../../../housing/tenancy-store.js';
import { SimulationClockStore } from '../../../../simulation-clock/store.js';
import { foodDigest, FOOD_POLICY, NativeFoodConsumptionStore } from './NativeFoodConsumptionStore.js';
import { NeedsStore, type NeedsBinding } from '../../../../needs/store.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../../../../needs/config.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';
import { AgentStateStore } from '../../../../agent-state/store.js';
import type { LivelihoodJournalEntry } from '../../../../agent-state/livelihood.js';
const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], closers: Array<() => void> = [];
beforeAll(() => {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
});
afterEach(() => { registerHousingTenantAccess(() => false); for (const close of closers.splice(0).reverse()) close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(funds = 1000, recovery = 10000, identityStep = 0) {
    const workspace = mkdtempSync(join(tmpdir(), 'native-housing-')); dirs.push(workspace); mkdirSync(join(workspace, 'config'));
    for (const name of ['native-housing.json', 'housing-units.json', 'housing-tier-policies.json', 'housing-effect-policies.json', 'properties.json', 'needs-policies.json', 'needs-dynamics-policies.json'])
        copyFileSync(join(root, 'config', name), join(workspace, 'config', name));
    if (recovery !== 10000) { const path = join(workspace, 'config/housing-effect-policies.json'), v = JSON.parse(readFileSync(path, 'utf8'));
        v.policies[0].effects.find((e: { tierId: string }) => e.tierId === 'rented-room').fatigueRecoveryMultiplierBasisPoints = recovery; writeFileSync(path, JSON.stringify(v)); }
    mkdirSync(join(workspace, '.local/economy'), { recursive: true }); mkdirSync(join(workspace, '.local/admin'), { recursive: true });
    const options: HousingNativeOptions = { workspace, worldId: 'fixture-world', housingPath: join(workspace, '.local/economy/housing.sqlite'),
        propertyPath: join(workspace, '.local/admin/properties.sqlite'), checkpointPath: join(workspace, 'checkpoints.sqlite') };
    const properties = loadPropertyCatalog(join(workspace, 'config/properties.json')), property = new PropertyStore(properties, options.propertyPath);
    property.assignGenesis('housing-opening', 'falador.south-house', 1, { kind: 'player', id: 'landlord' }); closers.push(() => property.close());
    const coordinator = new NativeRentCoordinator(options); closers.push(() => coordinator.close());
    const source = new NativeRentSource(options); closers.push(() => source.close());
    const market = new MarketStore(options.checkpointPath); closers.push(() => market.db.close(true));
    const clockPath = join(workspace, '.local/clock.sqlite'), time = new SimulationClockStore(clockPath); closers.push(() => time.close());
    let wall = Date.parse('2026-10-19T12:00:00.000Z'), dead = false;
    time.create({ clockId: 'fixture-clock', profile: { schemaVersion: 1, profileId: 'fixture', version: '1.0.0', seed: 'housing-seed',
        rate: { simulationMilliseconds: 60, wallMilliseconds: 1 } }, wallTime: new Date(wall).toISOString(), simulationTime: '2001-01-01T00:00:00.000Z' });
    const clock = () => time.observe('fixture-clock', new Date(wall).toISOString(), World.currentTick);
    const player = (name: string) => { const p = new Player(name, 2n, 2n); p.x = 2970; p.z = 3330; p.levels.fill(20); p.baseLevels.fill(20); return p; };
    const tenant = player('tenant'), landlord = player('landlord'); if (funds) tenant.invAdd(InvType.INV, 995, funds); landlord.invAdd(InvType.INV, 995, 100); World.currentTick = 100;
    time.recordPlayerPresence('fixture-clock', 'tenant', 'online', new Date(wall).toISOString());
    const identity: ConstructorParameters<typeof NativeHousingExecutor>[0]['identity'] = (username, actionId, slot) => {
        wall += identityStep;
        if (dead && username === tenant.username) throw new Error('deceased');
        return { action: { actionId, username, actorId: `actor-${username}`, lifecycleId: `life-${username}`, worldId: options.worldId,
            clockId: clock().clockId, clockProfileDigest: clock().profileDigest, itemId: 379, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY) }, clock: clock() };
    };
    const catalogs = nativeHousingCatalogs(workspace), unit = catalogs.units.units[0]!, start = clock();
    const intent: NativeRentIntent = { operationId: 'rent-order-1', worldId: options.worldId, clockId: start.clockId, clockProfileDigest: start.profileDigest,
        tenant: { agentId: 'actor-tenant', username: 'tenant', lifecycleId: 'life-tenant' }, landlord: { agentId: 'actor-landlord', username: 'landlord', lifecycleId: 'life-landlord' },
        housingUnitId: unit.housingUnitId, bedSlotId: unit.bedSlots[0]!.bedSlotId, catalogs, amountGp: unit.rentGpPerPeriod, propertyVersion: 2,
        startsAt: start.simulationTime, endsAt: new Date(Date.parse(start.simulationTime) + unit.rentPeriodSimulationMinutes * 60000).toISOString(), expiresAt: new Date(wall + 300000).toISOString() };
    let checkpoint = () => {};
    const engine = () => new NativeHousingExecutor({ market, source, time, clock, identity, checkpoint: () => checkpoint() });
    const command = (operation: 'pay' | 'cancel' | 'sleep' | 'wake') => engine().execute({ operation, operationId: intent.operationId }, tenant, landlord);
    const prepare = () => coordinator.reserve(intent, clock());
    const count = (p: Player) => p.getInventory(InvType.INV)!.getItemCount(995);
    const saved = (p: Player) => PlayerLoading.load(p.username, new Packet(market.saved(p.username)!), null);
    const policy = loadNeedsPolicyCatalog(join(workspace, 'config/needs-policies.json')).policies[0]!, dynamics = loadNeedsDynamicsPolicyCatalog(join(workspace, 'config/needs-dynamics-policies.json'), policy).policies[0]!;
    const needsPath = join(workspace, '.local/needs.sqlite'), needs = new NeedsStore(needsPath, policy, dynamics); closers.push(() => needs.close());
    const binding: NeedsBinding = { worldId: options.worldId, actorId: 'actor-tenant', playerId: 'tenant', lifecycleId: 'life-tenant', clockId: start.clockId,
        clockProfileDigest: start.profileDigest, worldProfileDigest: 'b'.repeat(64), lifecyclePolicyDigest: 'c'.repeat(64) };
    const input = () => ({ binding, clock: clock(), playerTime: time.getPlayerTimeState(start.clockId, 'tenant'), history: time.getPlayerTimeHistory(start.clockId, 'tenant') });
    needs.initialize({ ...input(), admission: { kind: 'genesis', evidenceId: 'opening', evidenceDigest: 'd'.repeat(64) } });
    const advanceNeeds = () => needs.advance({ ...input(), expectedRevision: needs.get(binding)!.revision });
    const lease = () => { prepare(); command('pay'); return coordinator.finalize(intent.operationId); };
    return { workspace, options, source, coordinator, property, properties, market, tenant, landlord, intent, clock, time, clockPath, engine, command, prepare, count, saved, lease,
        needs, needsPath, binding, policy, dynamics, input, advanceNeeds, identity,
        advance(ms: number) { wall += ms; }, death() { dead = true; }, checkpoint(fn: () => void) { checkpoint = fn; } };
}
test('housing observes identity before binding sleep and invalidation on a progressing clock', () => {
    const f = fixture(1000, 10000, 1); f.lease();
    expect(f.command('sleep')).toBe('sleeping');
    expect(f.time.getPlayerTimeState(f.intent.clockId, f.tenant.username)?.rest).toBe('sleeping');
    f.tenant.x += 10; f.engine().validateSleeper(f.tenant.username, f.tenant);
    expect(f.time.getPlayerTimeState(f.intent.clockId, f.tenant.username)?.rest).toBe('awake');
    expect(f.tenant.populationSleeping).toBeFalse();
});

test('actual rent escrow atomically debits payer, credits landlord and activates exactly one prepaid tenancy after reopen', () => {
    const f = fixture(); f.prepare(); expect(() => f.command('sleep')).toThrow('inactive'); expect(f.command('pay')).toBe('paid');
    expect(f.count(f.saved(f.tenant))).toBe(500); expect(f.count(f.saved(f.landlord))).toBe(600);
    expect(f.coordinator.finalize(f.intent.operationId).phase).toBe('active');
    const reopen = new NativeRentCoordinator(f.options); try { expect(reopen.finalize(f.intent.operationId).phase).toBe('active'); } finally { reopen.close(); }
    expect(f.command('pay')).toBe('paid'); expect(f.count(f.tenant)).toBe(500); expect(f.source.entitlement(f.intent.operationId, f.clock()).access.validUntilSimulationTime).toBe(f.intent.endsAt);
});

test('SI-A12 readonly report separates native payment from domain activation and binds physical sleep to PlayerTime', async () => {
    const f = fixture(); new NativeFoodConsumptionStore(f.market); f.prepare(); f.command('pay');
    const { reportNativeIntegration } = await import(pathToFileURL(join(root, 'society-metrics/integration-report.ts')).href);
    const { nativeIntegrationOptions } = await import(pathToFileURL(join(root, 'society-metrics/integration-sources.ts')).href);
    const options = { ...nativeIntegrationOptions(f.workspace), worldId: f.options.worldId, housingPath: f.options.housingPath,
        nativeFoodCheckpointPath: f.options.checkpointPath, clockPath: f.clockPath };
    const scope = { fromSimulationTime: '2000-12-31T23:59:59.000Z', toSimulationTime: '2001-01-01T00:01:00.000Z',
        clockId: f.intent.clockId, clockProfileDigest: f.intent.clockProfileDigest, actorAgentIds: ['actor-tenant', 'actor-landlord', 'actor-three', 'actor-four'] };
    const pending = reportNativeIntegration(scope, options);
    expect(pending.sources.rent).toMatchObject({ status: 'available' });
    expect(pending.reconciliation.find((row: { channel: string }) => row.channel === 'rent')).toMatchObject({ native: 'paid', domain: 'reserved', status: 'native-domain-mismatch' });
    expect(pending.balances.operationEquations).toHaveLength(2);
    expect(pending.balances.operationEquations.every((row: { residual: string }) => row.residual === '0')).toBeTrue();
    f.coordinator.finalize(f.intent.operationId); f.command('sleep');
    const active = reportNativeIntegration(scope, options);
    expect(active.reconciliation.find((row: { channel: string }) => row.channel === 'rent').status).toBe('reconciled');
    expect(active.sleep[0].status).toBe('native-and-player-time-bound');
    expect(active.needs.internalHungerRelief.status).toBe('inconclusive');
    expect(f.count(f.tenant)).toBe(500); expect(f.count(f.landlord)).toBe(600);
});
test('full room/tenant conflict reserves no money and cannot displace the first admission', () => {
    const f = fixture(); f.prepare(); const second = { ...f.intent, operationId: 'rent-order-2', tenant: { agentId: 'actor-other', username: 'other', lifecycleId: 'life-other' } };
    expect(() => f.coordinator.reserve(second, f.clock())).toThrow('reserved'); expect(f.count(f.tenant)).toBe(1000); expect(f.coordinator.get(second.operationId)).toBeNull();
});
test('failed payment has no active entitlement; exact cancellation frees slot and denies late payment', () => {
    const f = fixture(0); f.prepare(); expect(() => f.command('pay')).toThrow('funds'); expect(() => f.source.entitlement(f.intent.operationId, f.clock())).toThrow('inactive');
    expect(f.command('cancel')).toBe('cancelled'); f.coordinator.finalize(f.intent.operationId); expect(f.command('pay')).toBe('cancelled'); expect(f.count(f.landlord)).toBe(100);
});
test('checkpoint fault restores both GP wallets and rolls back escrow; retry reuses original payment ID', () => {
    const f = fixture(); f.prepare(); f.checkpoint(() => { throw new Error('checkpoint fault'); });
    expect(() => f.command('pay')).toThrow('checkpoint fault'); expect(f.count(f.tenant)).toBe(1000); expect(f.count(f.landlord)).toBe(100);
    expect(openNativeRentReceipt(f.options, f.coordinator.get(f.intent.operationId)!.binding)).toBeNull(); f.checkpoint(() => {});
    f.command('pay'); f.coordinator.finalize(f.intent.operationId); expect(f.count(f.tenant)).toBe(500);
});
test('paid entitlement pending survives domain projection fault and finalizes without another rent charge', () => {
    const f = fixture(); f.prepare(); f.command('pay'); const db = new OwnedDatabase(f.options.housingPath);
    db.run("CREATE TRIGGER fail_entitlement BEFORE INSERT ON housing_prepaid_period BEGIN SELECT RAISE(ABORT,'entitlement fault'); END");
    try { expect(() => f.coordinator.finalize(f.intent.operationId)).toThrow('entitlement fault'); } finally { db.run('DROP TRIGGER fail_entitlement'); db.close(true); }
    expect(f.coordinator.get(f.intent.operationId)?.phase).toBe('reserved'); expect(f.count(f.tenant)).toBe(500);
    expect(f.coordinator.finalize(f.intent.operationId).phase).toBe('active'); expect(f.count(f.landlord)).toBe(600);
});
test('sleep requires the physical assigned floor/bed and wakes when the Player leaves it', () => {
    const f = fixture(); f.lease(); f.tenant.x += 10; expect(() => f.command('sleep')).toThrow('outside'); f.tenant.x -= 10;
    expect(f.command('sleep')).toBe('sleeping'); expect(f.tenant.populationSleeping).toBe(true); f.tenant.level = 1;
    f.engine().validateSleeper('tenant', f.tenant); expect(f.time.getPlayerTimeState('fixture-clock', 'tenant')?.rest).toBe('awake'); expect(f.tenant.populationSleeping).toBe(false);
});
test('real Player sleeping blocks physical execution and waking restores it without changing clock rate', () => {
    const f = fixture(); f.lease(); const rate = f.time.get('fixture-clock')!.profile; f.command('sleep'); expect(f.tenant.processMovement()).toBe(false);
    f.command('wake'); expect(f.tenant.populationSleeping).toBe(false); expect(f.time.get('fixture-clock')!.profile).toEqual(rate);
});
test('housing effect and explicit offline sleep feed durable SI-A03 fatigue history exactly once', () => {
    const f = fixture(1000, 12500); f.advance(60000); expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(400);
    const clock = f.clock(); f.intent.startsAt = clock.simulationTime; f.intent.endsAt = new Date(Date.parse(clock.simulationTime) + 86400000).toISOString(); f.intent.expiresAt = new Date(Date.parse(clock.wallTime) + 300000).toISOString();
    f.lease(); f.command('sleep'); f.advance(6000); expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(275);
    f.time.recordPlayerPresence('fixture-clock', 'tenant', 'offline', f.clock().wallTime); f.advance(6000); f.engine().validateSleeper('tenant', null);
    expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(150);
    const reopened = new NeedsStore(f.needsPath, f.policy, f.dynamics); try { expect(reopened.get(f.binding)?.state.values.find(v => v.needId === 'fatigue')!.value).toBe(150); } finally { reopened.close(); }
    f.command('wake'); f.advance(6000); expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(175);
    expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(175);
});
test('logout alone is awake offline time, not a sleep admission', () => {
    const f = fixture(); f.time.recordPlayerPresence('fixture-clock', 'tenant', 'offline', f.clock().wallTime); f.advance(60000);
    expect(f.advanceNeeds().state.values.find(v => v.needId === 'fatigue')!.value).toBe(250); expect(f.time.getPlayerTimeState('fixture-clock', 'tenant')?.sleepContext).toBeNull();
});
test('expiry, early tenancy end and death remove physical sleep and bed access without a new GP charge', () => {
    const f = fixture(); f.lease(); f.command('sleep'); f.advance(86400000 / 60); f.engine().validateSleeper('tenant', f.tenant);
    expect(f.tenant.populationSleeping).toBe(false); expect(() => f.source.entitlement(f.intent.operationId, f.clock())).toThrow('expired');
    const g = fixture(); g.lease(); g.command('sleep'); g.death(); g.engine().validateSleeper('tenant', g.tenant); expect(g.tenant.populationSleeping).toBe(false); expect(() => g.command('sleep')).toThrow('deceased');
    const h = fixture(); h.lease(); h.command('sleep'); const tenancies = new HousingTenancyStore(h.options.housingPath, h.intent.catalogs.units);
    const id = rentIds(h.intent.operationId).tenancyId; tenancies.end(id, tenancies.get(id)!.revision, h.clock().simulationTime); tenancies.close();
    h.engine().validateSleeper('tenant', h.tenant); expect(h.tenant.populationSleeping).toBe(false); expect(h.count(h.tenant)).toBe(500);
});
test('Property title transfer and stale terms refuse payment before mutation', () => {
    const f = fixture(); f.prepare(); f.property.transferOwnership('housing-transfer', 'falador.south-house', 2, { kind: 'player', id: 'landlord' }, { kind: 'player', id: 'other' });
    expect(() => f.command('pay')).toThrow('authority'); expect(f.count(f.tenant)).toBe(1000);
    const g = fixture(); g.prepare(); g.advance(300001); expect(() => g.command('pay')).toThrow('expired'); expect(g.count(g.landlord)).toBe(100);
});
test('missing native paid receipt fails closed even after tenancy projection was activated', () => {
    const f = fixture(); f.lease(); f.market.db.run('DELETE FROM native_rent_operation'); expect(() => f.command('sleep')).toThrow('coverage'); expect(f.count(f.tenant)).toBe(500);
});
test('rent entitlement grants only visitor entry to exact Property and stops on lease expiry', () => {
    const f = fixture(); f.lease(); const runtime = new PropertyRuntime(f.properties, f.property);
    registerHousingTenantAccess((propertyId, username) => { if (propertyId !== 'falador.south-house' || username !== 'tenant') return false;
        try { f.source.entitlement(f.intent.operationId, f.clock()); return true; } catch { return false; } });
    const property = runtime.list().find(p => p.propertyId === 'falador.south-house')!; expect(runtime.canPlayerEnter(property, 'tenant')).toBe(true);
    expect(runtime.canPlayerEnter(property, 'stranger')).toBe(false); f.advance(86400000 / 60); expect(runtime.canPlayerEnter(property, 'tenant')).toBe(false);
});
test('prepaid period expires without assessing the same rent a second time', () => {
    const f = fixture(); f.lease(); const tenancy = new HousingTenancyStore(f.options.housingPath, f.intent.catalogs.units);
    try { expect(tenancy.assessRent(rentIds(f.intent.operationId).tenancyId, f.intent.endsAt)).toMatchObject({ status: 'expired', arrearsGp: 0 }); }
    finally { tenancy.close(); }
});
test('housing HTTP route requires token and exact commands, rejecting uploaded rent/payment/location evidence', async () => {
    const previous = process.env.ENGINE_ADMIN_TOKEN; process.env.ENGINE_ADMIN_TOKEN = 'housing-test-token';
    try {
        const url = new URL('http://localhost/api/internal/admin/native-housing'); expect((await handleInternalAdminRequest(new Request(url, { method: 'POST' }), url))?.status).toBe(401);
        const response = await handleInternalAdminRequest(new Request(url, { method: 'POST', headers: { 'X-Engine-Admin-Token': 'housing-test-token' },
            body: JSON.stringify({ commandId: randomUUID(), operation: 'sleep', operationId: 'rent-order-1', amountGp: 0, paid: true, x: 2970 }) }), url);
        expect(response?.status).toBe(400);
    } finally { if (previous === undefined) delete process.env.ENGINE_ADMIN_TOKEN; else process.env.ENGINE_ADMIN_TOKEN = previous; }
});
test('concurrent independent admissions serialize on one finite bed reservation', async () => {
    const f = fixture(); const requestPath = join(f.workspace, 'rent-race.json');
    writeFileSync(requestPath, JSON.stringify({ options: f.options, intent: f.intent, clock: f.clock() }));
    const moduleUrl = pathToFileURL(resolve(root, 'housing/native-rent-runtime.ts')).href;
    const children = [1, 2, 3].map(n => Bun.spawn([process.execPath, '-e', `
        import {readFileSync} from 'node:fs'; const {NativeRentCoordinator} = await import(${JSON.stringify(moduleUrl)});
        const f = JSON.parse(readFileSync(${JSON.stringify(requestPath)},'utf8')); const s = new NativeRentCoordinator(f.options);
        try { s.reserve({...f.intent,operationId:'race-order-${n}',tenant:{agentId:'actor-race-${n}',username:'race${n}',lifecycleId:'life-${n}'}},f.clock); console.log('RESERVED'); }
        catch(e) { if(!String(e).includes('reserved')) throw e; console.log('FULL'); } finally {s.close();}
    `], { stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(children.map(async c => { const [out, err, exit] = await Promise.all([new Response(c.stdout).text(), new Response(c.stderr).text(), c.exited]);
        expect(err).toBe(''); expect(exit).toBe(0); return out.trim(); }));
    expect(results.filter(r => r === 'RESERVED')).toHaveLength(1); expect(results.filter(r => r === 'FULL')).toHaveLength(2);
}, 30000);
test('legacy tenancy creation cannot take a native pending slot or bypass prepaid admission', () => {
    const f = fixture(); f.prepare(); const tenancy = new HousingTenancyStore(f.options.housingPath, f.intent.catalogs.units);
    try {
        const terms = { housingUnitId: f.intent.housingUnitId, bedSlotId: f.intent.bedSlotId, tenantAgentId: 'intruder', startsAtSimulationTime: f.intent.startsAt, periodCount: 1 };
        expect(() => tenancy.create({ ...terms, tenancyId: 'legacy-conflict' })).toThrow('reserved');
        expect(() => tenancy.create({ ...terms, tenancyId: rentIds(f.intent.operationId).tenancyId })).toThrow('paid admission');
    } finally { tenancy.close(); }
});
test('sleep checkpoint failure creates no PlayerTime sleep and witness tampering wakes a sleeper', () => {
    const f = fixture(); f.lease(); f.checkpoint(() => { throw new Error('sleep checkpoint fault'); }); expect(() => f.command('sleep')).toThrow('sleep checkpoint fault');
    expect(f.time.getPlayerTimeState('fixture-clock', 'tenant')?.rest).toBe('awake'); f.checkpoint(() => {}); f.command('sleep');
    f.market.db.run('DELETE FROM native_housing_sleep'); f.engine().validateSleeper('tenant', f.tenant);
    expect(f.time.getPlayerTimeState('fixture-clock', 'tenant')?.rest).toBe('awake'); expect(f.tenant.populationSleeping).toBe(false);
});
test('deleted tenancy audit tail denies paid access after reopening the source', () => {
    const f = fixture(); f.lease(); const db = new OwnedDatabase(f.options.housingPath); db.run('DELETE FROM housing_tenancy_audit WHERE sequence=(SELECT MAX(sequence) FROM housing_tenancy_audit)'); db.close(true);
    expect(() => f.command('sleep')).toThrow('coverage'); expect(f.count(f.tenant)).toBe(500);
});
test('paused world preserves explicit sleep and freezes fatigue without changing its rate', () => {
    const f = fixture(); f.lease(); f.command('sleep'); const clock = f.time.get('fixture-clock')!;
    f.time.pause('fixture-clock', clock.revision, f.clock().wallTime); f.advance(60000); f.engine().validateSleeper('tenant', f.tenant);
    expect(f.tenant.populationSleeping).toBe(true); expect(f.clock().simulationTime).toBe(f.intent.startsAt); expect(f.time.get('fixture-clock')!.profile).toEqual(clock.profile);
});
test('legacy sleep state cannot masquerade as a witnessed native tenancy sleep', () => {
    const f = fixture(); f.lease(); f.time.startPlayerSleep('fixture-clock', 'tenant', { sleeperKind: 'npc-agent', sleepPlaceId: f.intent.bedSlotId,
        access: { kind: 'bed-entitlement', evidenceId: 'unrelated-legacy', sourceDigest: 'a'.repeat(64), validUntilSimulationTime: f.intent.endsAt } }, f.clock().wallTime);
    expect(() => f.command('sleep')).toThrow('Wake'); expect(f.tenant.populationSleeping).toBe(false);
    f.command('wake'); expect(f.command('sleep')).toBe('sleeping');
});

test('SI-A11 supervisor reopens canonical rent proof after lost ACK, then sleeps and wakes without a provider or duplicate payment', async () => {
    // Runtime integration across two TS projects; keep gateway-only build dependencies in their owning project.
    const { createGatewayAgentReplanCoordinator } = await import(pathToFileURL(join(root, 'server/gateway/admin/replan-runtime.ts')).href);
    const { GatewayAgentAutonomySupervisor } = await import(pathToFileURL(join(root, 'server/gateway/admin/autonomy-supervisor.ts')).href);
    const f = fixture(); f.prepare();
    const agentPath = join(f.workspace, '.local/agents.sqlite'), inbox = join(f.workspace, '.local/inbox.sqlite');
    const use = <T>(read: (s: AgentStateStore) => T) => { const s = new AgentStateStore(agentPath); try { return read(s); } finally { s.close(); } };
    use(s => { s.createIdentity({ agentId: 'actor-tenant', playerUsername: 'tenant', displayName: 'Tenant',
        background: 'Isolated native supervisor integration.', personalityTraits: ['steady'] });
        s.createAutonomyEnrollment('actor-tenant', { status: 'desired', policyId: 'society-livelihood', policyVersion: '1.0.0' }); });
    let fatigue = 8000, commands = 0;
    const proof = async (entry: LivelihoodJournalEntry): Promise<{ status: 'completed' | 'failed'; reason: string; source: string | null }> => {
        const a = entry.action;
        if (a?.kind !== 'housing') throw new Error('Housing only');
        if (a.operation === 'pay') {
            const order = f.coordinator.finalize(a.operationId);
            return { status: order.phase === 'active' ? 'completed' : 'failed', reason: 'rent-source-proof', source: order.nativeDigest };
        }
        const t = f.time.getPlayerTimeState('fixture-clock', 'tenant')!;
        if (t.rest !== (a.operation === 'sleep' ? 'sleeping' : 'awake')) throw new Error('Native player-time proof differs');
        return { status: 'completed', reason: `native-${a.operation}`, source: `player-time:${t.revision}` };
    };
    const ports = {
        snapshot: async () => ({ lifecycle: 'life-tenant', alive: true, role: 'player' as const, clockRunning: true,
            physicalAllowed: !f.tenant.populationSleeping, needs: { hunger: 0, fatigue, sleeping: f.tenant.populationSleeping },
            ...(f.coordinator.get(f.intent.operationId)?.phase === 'active'
                ? { rest: { kind: 'housing' as const, operation: 'sleep' as const, operationId: f.intent.operationId },
                    wake: { kind: 'housing' as const, operation: 'wake' as const, operationId: f.intent.operationId } }
                : { rent: { kind: 'housing' as const, operation: 'pay' as const, operationId: f.intent.operationId } }) }),
        execute: async (entry: LivelihoodJournalEntry) => {
            if (entry.action?.kind !== 'housing') throw new Error('Housing only');
            commands++; f.command(entry.action.operation);
            if (entry.action.operation === 'pay') throw new Error('Lost ACK after native commit');
            return proof(entry);
        }, reconcile: proof
    };
    const make = () => createGatewayAgentReplanCoordinator(() => new Map(), {}, async () => {},
        { agentPath, replanInboxPath: inbox, livelihoodPorts: ports, llmConfigPath: join(f.workspace, 'provider-must-never-open.json') });
    const supervisor = new GatewayAgentAutonomySupervisor(make(), { agentPath, leaseOwner: 'gateway:native-test' });
    expect((await supervisor.tick())[0]?.record?.outcome?.status).toBe('bounded-wait');
    expect(f.count(f.tenant)).toBe(500); expect(f.count(f.landlord)).toBe(600);
    const next = async () => {
        use(s => { const e = s.getAutonomyEnrollment('actor-tenant')!, now = new Date().toISOString();
            const desired = s.setAutonomyEnrollment(e.agentId, e.revision, { ...e, status: 'desired', nextWakeupAt: now, leaseOwner: null, leaseExpiresAt: null });
            s.claimAutonomyEnrollment(e.agentId, desired.revision, 'gateway:native-test', new Date(Date.now() + 60000).toISOString(), now); });
        return make().submit({ eventId: randomUUID(), agentId: 'actor-tenant', type: 'goal-changed',
            sourceKey: `native-test:${randomUUID()}`, occurredAt: new Date().toISOString(), summary: 'Trusted source changed.' });
    };
    expect((await next()).outcome?.status).toBe('completed'); expect(commands).toBe(1);
    expect((await next()).outcome?.status).toBe('completed'); expect(f.tenant.populationSleeping).toBe(true);
    fatigue = 1000;
    expect((await next()).outcome?.status).toBe('completed'); expect(f.tenant.populationSleeping).toBe(false);
    expect(commands).toBe(3); expect(f.count(f.tenant)).toBe(500);
    expect(use(s => s.listLivelihoodJournal('actor-tenant').filter(e => e.phase === 'completed'))).toHaveLength(3);
});
