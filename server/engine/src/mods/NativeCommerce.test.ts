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
import { BusinessManagerStore } from '../../../gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../../gateway/admin/institution-treasury.js';
import { FoodCommerceCoordinator } from '../../../../agent-operated-shop/native-commerce-runtime.js';
import { commerceCatalogs, FoodCommerceSource, readCommerceResult, type FoodCommerceOptions } from '../../../../agent-operated-shop/native-commerce-source.js';
import { commerceIds, type FoodCommerceIntent } from '../../../../agent-operated-shop/native-commerce.js';
import { decideBusinessStock } from '../../../../business-stock-policy/index.js';
import { decideSaleChannel } from '../../../../sale-channel-policy/index.js';
import { loadNativeKitchenPolicy } from '../../../../production-workflow/native-kitchen-policy.js';
import { foodDigest, FOOD_POLICY, NativeFoodConsumptionStore } from './NativeFoodConsumptionStore.js';
import { NativeCommerceExecutor, type NativeCommercePorts } from './NativeCommerce.js';
import { initializeNativeCommerce, readNativeCommerce } from './NativeCommerceStore.js';
import { TradeEvidenceStore } from './TradeEvidenceStore.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';

const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], closers: Array<() => void> = [];
beforeAll(() => {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
});
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(kind: 'sale' | 'procurement' = 'sale', stock = 4, funds = 200) {
    const workspace = mkdtempSync(join(tmpdir(), 'native-commerce-')); dirs.push(workspace); mkdirSync(join(workspace, 'config'));
    for (const name of ['native-kitchen.json', 'facility-capabilities.json', 'business-stock-policies.json', 'sale-channel-policies.json', 'properties.json'])
        copyFileSync(join(root, 'config', name), join(workspace, 'config', name));
    mkdirSync(join(workspace, '.local/economy'), { recursive: true });
    const options: FoodCommerceOptions = { workspace, worldId: 'fixture-world', businessPath: join(workspace, '.local/economy/businesses.sqlite'),
        treasuryPath: join(workspace, '.local/economy/treasury.sqlite'), journalPath: join(workspace, '.local/economy/food-commerce.sqlite'),
        checkpointPath: join(workspace, 'checkpoints.sqlite'), tradePath: join(workspace, 'trades.sqlite') };
    const manager = new BusinessManagerStore(options.businessPath);
    manager.create({ businessId: 'karamja-kitchen', name: 'Kitchen', summary: 'Finite food commerce', ownerAgentId: 'actor-chef', propertyId: 'karamja.fishing-hut' });
    if (stock) manager.creditGenesisInventory('opening-cooked', 'karamja-kitchen', 379, stock); manager.close();
    const treasury = new InstitutionTreasuryStore(options.treasuryPath); treasury.setBalance('business', 'karamja-kitchen', 1, funds); treasury.close();
    const coordinator = new FoodCommerceCoordinator(options); closers.push(() => coordinator.close());
    const source = new FoodCommerceSource(options); closers.push(() => source.close());
    const market = new MarketStore(options.checkpointPath); closers.push(() => market.db.close(true));
    const trades = new TradeEvidenceStore(options.tradePath); closers.push(() => trades.close());
    const player = (username: string) => { const p = new Player(username, 2n, 2n); p.x = 2925; p.z = 3180;
        p.levels.fill(20); p.baseLevels.fill(20); p.invAdd(InvType.INV, 2347, 1); return p; };
    const worker = player('chef'), counterparty = player('buyer');
    counterparty.invAdd(InvType.INV, kind === 'sale' ? 995 : 377, kind === 'sale' ? 200 : 4);
    World.currentTick = 100;
    let wallTime = '2026-10-19T10:00:00.000Z';
    const clock = () => ({ clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), wallTime, simulationTime: '2001-01-01T00:00:01.000Z', status: 'running' as const, revision: 1, engineTick: World.currentTick });
    const identity: NativeCommercePorts['identity'] = (username, actionId, slot, tick) => ({ action: { actionId, worldId: options.worldId,
        actorId: `actor-${username}`, username, lifecycleId: `life-${username}`, itemId: 379, quantity: 1, slot,
        policyDigest: foodDigest(FOOD_POLICY), clockId: clock().clockId, clockProfileDigest: clock().profileDigest }, clock: { ...clock(), engineTick: tick } });
    const catalogs = commerceCatalogs(workspace), itemId = kind === 'sale' ? 379 : 377, policy = catalogs.stock.policies.find(p => p.itemId === itemId)!;
    const kitchen = loadNativeKitchenPolicy(workspace);
    const intent: FoodCommerceIntent = { operationId: 'food-order-1', kind, businessId: 'karamja-kitchen',
        worker: { agentId: 'actor-chef', username: 'chef', lifecycleId: 'life-chef' }, counterparty: { agentId: 'actor-buyer', username: 'buyer', lifecycleId: 'life-buyer' },
        worldId: options.worldId, clockId: clock().clockId, clockProfileDigest: clock().profileDigest, itemId, quantity: 2, unitPriceGp: kind === 'sale' ? 40 : 20,
        expiresAt: '2026-10-19T10:05:00.000Z', catalogs, decision: decideBusinessStock(policy, catalogs.stock, kind === 'sale' ? stock : 0),
        facilityPolicyDigest: foodDigest(kitchen), grant: { grantId: 'kitchen-access', kind: 'explicit', subjectAgentId: 'actor-chef', facilityId: kitchen.facilityId,
            capabilityId: 'storage.secure', status: 'active', validFrom: '2001-01-01T00:00:00.000Z', validUntil: null, sourceEvidenceId: 'owner-access' },
        channel: decideSaleChannel(catalogs.channels, { offerId: commerceIds('food-order-1').tradeId, channel: kind === 'sale' ? 'player-trade' : 'business-shop',
            sellerAgentId: kind === 'sale' ? 'actor-chef' : 'actor-buyer', acquirer: { kind: kind === 'sale' ? 'agent' : 'business', id: kind === 'sale' ? 'actor-buyer' : 'karamja-kitchen' },
            itemId, quantity: 2, assetId: null, provenanceDigest: null }, []) };
    let checkpoint = () => {};
    const engine = (extra: Partial<NativeCommercePorts> = {}) => new NativeCommerceExecutor({ market, source, trades, clock, identity, checkpoint: () => checkpoint(), ...extra });
    const prepare = () => coordinator.prepare(intent, clock(), () => true);
    const execute = (operation: 'execute' | 'cancel' = 'execute', extra: Partial<NativeCommercePorts> = {}) => engine(extra).execute({ operation, operationId: intent.operationId }, worker, counterparty);
    const count = (p: Player, id: number) => p.getInventory(InvType.INV)!.getItemCount(id);
    const saved = (p: Player) => PlayerLoading.load(p.username, new Packet(market.saved(p.username)!), null);
    const business = () => { const db = new OwnedDatabase(options.businessPath, { readonly: true });
        try { return (db.query('SELECT item_id,count FROM business_inventory WHERE business_id=?1 ORDER BY item_id').all(intent.businessId) as { item_id: number; count: number }[]); } finally { db.close(true); } };
    const account = () => { const t = new InstitutionTreasuryStore(options.treasuryPath); try { return t.get('business', intent.businessId)!; } finally { t.close(); } };
    return { options, coordinator, source, market, trades, worker, counterparty, intent, prepare, execute, count, saved, business, account, engine, clock,
        expire() { wallTime = '2026-10-19T10:06:00.000Z'; }, checkpoint(fn: () => void) { checkpoint = fn; } };
}
test('SI-B04 selected institution price reaches native exchange and a newer selection invalidates an uncommitted quote', () => {
    const select=(f:ReturnType<typeof fixture>,price:number)=>{
        const base=commerceCatalogs(f.options.workspace).stock.policies.find(p=>p.businessId==='karamja-kitchen'&&p.itemId===379)!;
        const manager=new BusinessManagerStore(f.options.businessPath);
        manager.applyInstitutionPolicy('karamja-kitchen',{proposalId:randomUUID(),proposerAgentId:'kitchen-mind',objective:'Bounded price choice',mode:'profit',maxRewardGp:25},
            randomUUID(),'a'.repeat(64),[{...base,pricing:{mode:'fixed',saleUnitPriceGp:price}}],f.clock().wallTime);manager.close();
    };
    const stale=fixture();stale.prepare();select(stale,31);
    expect(()=>stale.execute()).toThrow('stale');expect(stale.count(stale.counterparty,995)).toBe(200);
    const f=fixture();select(f,31);const catalogs=commerceCatalogs(f.options.workspace,f.options.businessPath);
    f.intent.catalogs=catalogs;f.intent.decision=decideBusinessStock(catalogs.stock.policies.find(p=>p.businessId==='karamja-kitchen'&&p.itemId===379)!,catalogs.stock,4);
    f.intent.unitPriceGp=31;f.prepare();expect(f.execute().phase).toBe('completed');f.coordinator.finalize(f.intent.operationId);
    expect(f.count(f.saved(f.counterparty),995)).toBe(138);expect(f.count(f.saved(f.counterparty),379)).toBe(2);expect(f.account().balanceGp).toBe(262);
    const reopen=new FoodCommerceCoordinator(f.options);try{reopen.finalize(f.intent.operationId);}finally{reopen.close();}
    expect(f.account().balanceGp).toBe(262);
});

test('actual bilateral BOTH_MOVEINV sale reconciles finite Business stock, buyer coins and cooked food after reopen/replay', () => {
    const f = fixture(); f.prepare(); expect(f.business()).toContainEqual({ item_id: 379, count: 2 });
    expect(f.execute().phase).toBe('completed'); expect(f.count(f.saved(f.counterparty), 379)).toBe(2); expect(f.count(f.saved(f.counterparty), 995)).toBe(120);
    expect(f.count(f.saved(f.worker), 379)).toBe(0); expect(f.count(f.saved(f.worker), 995)).toBe(0);
    expect(f.coordinator.recover()).toContainEqual({ operationId: f.intent.operationId, phase: 'completed', error: null }); expect(f.account().balanceGp).toBe(280);
    const reopened = new FoodCommerceCoordinator(f.options); try { expect(reopened.finalize(f.intent.operationId).phase).toBe('completed'); } finally { reopened.close(); }
    expect(f.execute().phase).toBe('completed'); expect(f.account().balanceGp).toBe(280); expect(f.business()).toContainEqual({ item_id: 379, count: 2 });
});
test('SI-A12 keeps an unstamped real trade unplaced and never counts sale custody as production', async () => {
    const f = fixture(); new NativeFoodConsumptionStore(f.market); f.prepare(); f.execute(); f.coordinator.finalize(f.intent.operationId);
    const { reportNativeIntegration } = await import(pathToFileURL(join(root, 'society-metrics/integration-report.ts')).href);
    const { nativeIntegrationOptions } = await import(pathToFileURL(join(root, 'society-metrics/integration-sources.ts')).href);
    const report = reportNativeIntegration({ fromSimulationTime: '2001-01-01T00:00:00.000Z', toSimulationTime: '2001-01-01T00:01:00.000Z',
        clockId: f.intent.clockId, clockProfileDigest: f.intent.clockProfileDigest, actorAgentIds: ['actor-chef', 'actor-buyer', 'actor-three', 'actor-four'] },
    { ...nativeIntegrationOptions(f.options.workspace), worldId: f.options.worldId, businessPath: f.options.businessPath,
        treasuryPath: f.options.treasuryPath, nativeFoodCheckpointPath: f.options.checkpointPath, nativeFoodTradePath: f.options.tradePath });
    expect(report.sources.commerce.status).toBe('available');
    expect(report.reconciliation.find((row: { channel: string }) => row.channel === 'commerce')).toMatchObject({ native: 'completed', domain: 'completed', status: 'native-trade-source-missing-or-mismatch' });
    expect(report.food.production).toEqual([]); expect(report.food.finalUses).toEqual([]);
    expect(report.balances.operationEquations).toEqual([]); expect(report.needs.internalHungerRelief.status).toBe('inconclusive');
    expect(f.count(f.counterparty, 379)).toBe(2); expect(f.account().balanceGp).toBe(280);
});

test('raw procurement consumes real seller food and reserved Business GP, preserves personal worker inventory', () => {
    const f = fixture('procurement'); f.prepare(); expect(f.account()).toMatchObject({ balanceGp: 200, reservedGp: 40 });
    f.execute(); expect(f.count(f.saved(f.counterparty), 377)).toBe(2); expect(f.count(f.saved(f.counterparty), 995)).toBe(40);
    expect(f.count(f.saved(f.worker), 377)).toBe(0); expect(f.count(f.saved(f.worker), 995)).toBe(0);
    f.coordinator.finalize(f.intent.operationId); expect(f.business()).toContainEqual({ item_id: 377, count: 2 }); expect(f.account()).toMatchObject({ balanceGp: 160, reservedGp: 0 });
    f.coordinator.finalize(f.intent.operationId); expect(f.account().balanceGp).toBe(160);
});
test('empty Business stock and wrong fixed price cannot reserve or mint food', () => {
    const f = fixture('sale', 0); expect(() => f.prepare()).toThrow('exceeds'); expect(f.coordinator.get(f.intent.operationId)).toBeNull();
    const g = fixture(); g.intent.unitPriceGp = 39; expect(() => g.prepare()).toThrow('exceeds'); expect(g.account().balanceGp).toBe(200);
});
test('empty buyer and empty raw seller cannot exchange or create a native completed receipt', () => {
    for (const kind of ['sale', 'procurement'] as const) { const f = fixture(kind); f.prepare(); f.counterparty.invDel(InvType.INV, kind === 'sale' ? 995 : 377, 200);
        expect(() => f.execute()).toThrow('insufficient'); expect(readNativeCommerce(f.market.db)).toHaveLength(0);
        expect(() => f.coordinator.finalize(f.intent.operationId)).toThrow('pending'); expect(f.account().balanceGp).toBe(200); }
});
test('empty treasury leaves stable unfunded outbox; funding resumes same operation without duplicate stock', () => {
    const f = fixture('procurement', 4, 0); expect(() => f.prepare()).toThrow('Insufficient'); expect(f.coordinator.get(f.intent.operationId)?.phase).toBe('prepared');
    expect(() => f.execute()).toThrow('funding'); const t = new InstitutionTreasuryStore(f.options.treasuryPath); t.setBalance('business', 'karamja-kitchen', f.account().revision, 40); t.close();
    f.prepare(); f.execute(); f.coordinator.finalize(f.intent.operationId); expect(f.account().balanceGp).toBe(0); expect(f.business()).toContainEqual({ item_id: 377, count: 2 });
});
test('explicit native refusal restores reserved sale once and permanently prevents late execution', () => {
    const f = fixture(); f.prepare(); expect(f.execute('cancel').phase).toBe('cancelled'); f.coordinator.finalize(f.intent.operationId); f.coordinator.finalize(f.intent.operationId);
    expect(f.business()).toContainEqual({ item_id: 379, count: 4 }); expect(f.execute().phase).toBe('cancelled'); expect(f.account().balanceGp).toBe(200);
});
test('procurement refusal unlocks finite treasury only with canonical no-trade proof', () => {
    const f = fixture('procurement'); f.prepare(); const t = new InstitutionTreasuryStore(f.options.treasuryPath);
    try { expect(() => t.release(commerceIds(f.intent.operationId).reservationId)).toThrow(); } finally { t.close(); }
    f.execute('cancel'); f.coordinator.finalize(f.intent.operationId); f.coordinator.finalize(f.intent.operationId); expect(f.account()).toMatchObject({ balanceGp: 200, reservedGp: 0 });
});
test('unknown transport/ACK and replay cannot finalize a merely prepared operation', () => {
    const f = fixture(); f.prepare(); initializeNativeCommerce(f.market.db); expect(() => f.coordinator.finalize(f.intent.operationId)).toThrow('pending');
    expect(f.business()).toContainEqual({ item_id: 379, count: 2 }); expect(f.account().balanceGp).toBe(200);
});
test('policy price change after reservation denies dispatch; committed exchange still settles pinned historical policy', () => {
    const f = fixture(); f.prepare(); const path = join(f.options.workspace, 'config/business-stock-policies.json'), original = readFileSync(path, 'utf8');
    const catalog = JSON.parse(original); catalog.policies.find((p: { itemId: number }) => p.itemId === 379).pricing.saleUnitPriceGp = 41; writeFileSync(path, JSON.stringify(catalog));
    expect(() => f.execute()).toThrow('stale'); writeFileSync(path, original); f.execute(); writeFileSync(path, JSON.stringify(catalog));
    expect(f.coordinator.finalize(f.intent.operationId).phase).toBe('completed'); expect(f.account().balanceGp).toBe(280);
});
test('expired quote, mismatched lifecycle and remote partner deny before native admission', () => {
    const f = fixture(); f.prepare(); f.expire(); expect(() => f.execute()).toThrow('expired');
    const g = fixture(); g.prepare(); expect(() => g.execute('execute', { identity: () => null })).toThrow('lifecycle');
    g.counterparty.x += 10; expect(() => g.execute()).toThrow('meeting'); expect(readNativeCommerce(g.market.db)).toHaveLength(0);
});
test('untrusted grant and wrong Business worker cannot reserve finite assets', () => {
    const f = fixture(); expect(() => f.coordinator.prepare(f.intent, f.clock(), () => false)).toThrow('entitlement');
    f.intent.worker.agentId = 'intruder'; f.intent.grant.subjectAgentId = 'intruder'; expect(() => f.prepare()).toThrow(); expect(f.business()).toContainEqual({ item_id: 379, count: 4 });
});
test('full destination denies before staging; no dropped ground stock or buyer payment', () => {
    const f = fixture(); f.prepare(); f.counterparty.invAdd(InvType.INV, 2347, 26); expect(() => f.execute()).toThrow('capacity');
    expect(f.count(f.counterparty, 995)).toBe(200); expect(f.trades.get(commerceIds(f.intent.operationId).tradeId)).toBeNull();
});
test('failure after native ledger commit rolls back inventories/checkpoints but leaves uncertain operation without automatic refund', () => {
    const f = fixture(); f.prepare(); let calls = 0; f.checkpoint(() => { if (++calls === 2) throw new Error('checkpoint failure'); });
    expect(() => f.execute()).toThrow('checkpoint failure'); expect(f.trades.get(commerceIds(f.intent.operationId).tradeId)).not.toBeNull();
    expect(f.count(f.counterparty, 995)).toBe(200); expect(f.count(f.saved(f.counterparty), 995)).toBe(200);
    expect(readNativeCommerce(f.market.db)[0]?.phase).toBe('admitted'); expect(() => f.coordinator.finalize(f.intent.operationId)).toThrow('uncertain');
    expect(() => f.execute('cancel')).toThrow('reconciliation'); expect(() => f.execute()).toThrow('reconciliation'); expect(f.business()).toContainEqual({ item_id: 379, count: 2 });
});
test('pre-trade partial failure rolls back escrow and both inventories; unchanged admitted checkpoint can be cancelled safely', () => {
    const f = fixture(); f.prepare(); expect(() => f.execute('execute', { trades: { get: () => null, record: () => { throw new Error('trade write failed'); } } as unknown as TradeEvidenceStore })).toThrow('trade write failed');
    expect(f.count(f.counterparty, 995)).toBe(200); expect(f.count(f.worker, 379)).toBe(0); expect(() => f.execute()).toThrow('blindly');
    f.execute('cancel'); f.coordinator.finalize(f.intent.operationId); expect(f.business()).toContainEqual({ item_id: 379, count: 4 });
});
test('stock/treasury saga forward-recovers after stock commit and before GP credit without double movement', () => {
    const f = fixture(); f.prepare(); f.execute(); const db = new OwnedDatabase(f.options.treasuryPath);
    db.run("CREATE TRIGGER fail_food_credit BEFORE INSERT ON institution_treasury_external_credit BEGIN SELECT RAISE(ABORT,'credit fault'); END");
    try { expect(() => f.coordinator.finalize(f.intent.operationId)).toThrow('credit fault'); } finally { db.run('DROP TRIGGER fail_food_credit'); db.close(true); }
    expect(f.coordinator.get(f.intent.operationId)?.phase).toBe('prepared'); expect(f.business()).toContainEqual({ item_id: 379, count: 2 });
    f.coordinator.finalize(f.intent.operationId); expect(f.account().balanceGp).toBe(280); expect(f.business()).toContainEqual({ item_id: 379, count: 2 });
});
test('audited native receipt deletion blocks settlement and cannot become a completed sale', () => {
    const f = fixture(); f.prepare(); f.execute(); f.market.db.run('DELETE FROM native_food_commerce_operation');
    expect(() => readCommerceResult(f.options, f.coordinator.get(f.intent.operationId)!.binding)).toThrow('coverage'); expect(f.account().balanceGp).toBe(200);
});
test('two buyers cannot reserve the same finite stock and incoming orders cannot overbook target capacity', () => {
    for (const kind of ['sale', 'procurement'] as const) {
        const f = fixture(kind, 2); f.prepare(); const next = structuredClone(f.intent); next.operationId = 'food-order-2'; next.quantity = kind === 'sale' ? 2 : 8;
        next.channel = decideSaleChannel(next.catalogs.channels, { ...next.channel.offer, offerId: commerceIds(next.operationId).tradeId, quantity: next.quantity }, []);
        expect(() => f.coordinator.prepare(next, f.clock(), () => true)).toThrow();
        expect(f.coordinator.get(next.operationId)).toBeNull();
    }
});
test('commerce HTTP boundary requires token and rejects uploaded identities, prices, balances and native receipts', async () => {
    const previous = process.env.ENGINE_ADMIN_TOKEN; process.env.ENGINE_ADMIN_TOKEN = 'test-commerce-token';
    try {
        const url = new URL('http://localhost/api/internal/admin/native-food-commerce');
        expect((await handleInternalAdminRequest(new Request(url, { method: 'POST' }), url))?.status).toBe(401);
        const response = await handleInternalAdminRequest(new Request(url, { method: 'POST', headers: { 'X-Engine-Admin-Token': 'test-commerce-token' },
            body: JSON.stringify({ commandId: randomUUID(), operation: 'execute', operationId: 'food-order-1', username: 'buyer', quantity: 2, receipt: { phase: 'completed' } }) }), url);
        expect(response?.status).toBe(400);
    } finally { if (previous === undefined) delete process.env.ENGINE_ADMIN_TOKEN; else process.env.ENGINE_ADMIN_TOKEN = previous; }
});
test('expired offset timestamp and expired retry cannot bind new treasury money', () => {
    const f = fixture('procurement', 4, 0); expect(() => f.prepare()).toThrow('Insufficient'); f.expire();
    expect(() => f.prepare()).toThrow('expired'); expect(f.account().reservedGp).toBe(0);
    const g = fixture(); g.intent.expiresAt = '2026-10-19T10:05:00+05:00'; expect(() => g.prepare()).toThrow('expired');
});
test('bounded recovery never dispatches pending commerce and never refunds an uncertain ledger commit', () => {
    const f = fixture(); f.prepare(); initializeNativeCommerce(f.market.db);
    expect(f.coordinator.recover(1)[0]).toMatchObject({ operationId: f.intent.operationId, phase: 'prepared' });
    expect(f.trades.get(commerceIds(f.intent.operationId).tradeId)).toBeNull();
    let calls = 0; f.checkpoint(() => { if (++calls === 2) throw new Error('fault'); }); expect(() => f.execute()).toThrow('fault');
    expect(f.coordinator.recover(1)[0]?.error).toContain('uncertain'); expect(f.business()).toContainEqual({ item_id: 379, count: 2 }); expect(f.account().balanceGp).toBe(200);
});
test('native no-trade proof cancels unfunded procurement outbox without inventing a treasury reservation', () => {
    const f = fixture('procurement', 4, 0); expect(() => f.prepare()).toThrow('Insufficient'); f.execute('cancel');
    expect(f.coordinator.finalize(f.intent.operationId).phase).toBe('cancelled'); expect(f.account()).toMatchObject({ balanceGp: 0, reservedGp: 0 });
    expect(f.business().find(row => row.item_id === 377)).toBeUndefined();
});
test('Business role ending after admission preparation denies physical exchange', () => {
    const f = fixture(), manager = new BusinessManagerStore(f.options.businessPath);
    const employment = manager.hire('karamja-kitchen', { workerAgentId: 'actor-buyer', roleDefinitionId: 'business.delivery.v1', title: 'Courier', wageGp: 0,
        requiredSkill: { id: 'trade.lumbridge.give-item', version: '1.0.0' } });
    const db = new OwnedDatabase(f.options.businessPath); db.run("UPDATE business SET owner_agent_id='different-owner' WHERE business_id='karamja-kitchen'");
    db.run("UPDATE business_employment SET worker_agent_id='actor-chef' WHERE employment_id=?1", [employment.employmentId]); db.close(true);
    f.prepare(); manager.endEmployment('karamja-kitchen', employment.employmentId, employment.revision); manager.close();
    expect(() => f.execute()).toThrow('role'); expect(f.count(f.counterparty, 995)).toBe(200);
});
