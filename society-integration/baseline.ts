import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { parsePlayerSaveBytes, levelForXp } from '../server/gateway/admin/save-reader.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { check, inspectIntegrationReferences, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';
import { integrationPaths, INTEGRATION_STATE } from './bootstrap.js';
import { readFoodLineage } from '../server/engine/src/mods/NativeFoodLineageStore.js';
import { SocietyIntegrityStore } from '../society-integrity/store.js';
import {verifyCommonFounderOpening} from './founder-state.js';

const SEAL = '.local/simulation/integration-native-seal.json';
function read<T>(root: string, path: string, work: (db: OwnedDatabase) => T): T {
    const db = new OwnedDatabase(join(root, path), { readonly: true, strict: true });
    try { let value!: T; db.transaction(() => { value = work(db); }).deferred(); return value; } finally { db.close(true); }
}
export function nativeInventory(root: string) {
    const paths = ['.local/admin/properties.sqlite', '.local/admin/fixture-bootstrap.sqlite',
        'server/engine/data/player-checkpoints.sqlite'];
    for (const base of ['.local/agent-state', '.local/economy', '.local/simulation', 'server/engine/data/mods']) {
        check(existsSync(join(root, base)), `Native baseline directory missing: ${base}`);
        for (const name of readdirSync(join(root, base)).sort()) if (name.endsWith('.sqlite')) paths.push(`${base}/${name}`);
    }
    return [...new Set(paths)].sort().map(path => read(root, path, db => {
        const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
        const snapshots = tables.map(name => {
            check(/^[a-z_][a-z0-9_]*$/i.test(name), 'Unsafe baseline table name');
            check((db.query(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n <= 100000, 'Native baseline table too large');
            const rows = db.query(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row)).sort();
            return { name, digest: digest(rows) };
        });
        return { path, schema: db.query('PRAGMA user_version').get(), tables: snapshots };
    }));
}
/** Validate native holdings against the fixture before sealing; a saved report is never an asset source. */
export function validateNativeIntegrationBaseline(root: string, fixture: IntegrationFixture) {
    validateIntegrationFixture(fixture); inspectIntegrationReferences(root, fixture);
    const runtime = JSON.parse(readFileSync(join(root, 'server/engine/data/config/world.json'), 'utf8'));
    check(runtime.node?.shopEconomyMode === 'closed-society' && runtime.node.xpRate === 1 && runtime.node.debug === false, 'Native runtime shop/XP/debug policy differs');
    const receipt = JSON.parse(readFileSync(join(root, INTEGRATION_STATE), 'utf8'));
    check(receipt.fixtureDigest === fixture.digest, 'Native baseline belongs to another fixture');
    read(root, 'server/engine/data/player-checkpoints.sqlite', db => {
        const lineage = readFoodLineage(db);
        check(lineage.entries.length === fixture.avatars.filter(a => a.cookedReserve > 0).length, 'Opening food lineage count differs');
        const integrity = new SocietyIntegrityStore(integrationPaths(root).integrityDbPath, true);
        try { for (const actor of fixture.avatars.filter(a => a.cookedReserve > 0)) {
            const fact = lineage.entries.find(e => e.fact.kind === 'opening' && e.fact.custodian.actorId === actor.agentId)?.fact;
            check(fact?.kind === 'opening' && fact.proof.origin === 'bootstrap' && fact.custodian.worldId === receipt.worldId
                && fact.custodian.username === actor.username && fact.custodian.lifecycleId === receipt.lifecycles.find((a: any) => a.agentId === actor.agentId)?.binding.lifecycleId
                && digest(fact.before) === digest({ raw: 0, cooked: 0, burnt: 0 }) && digest(fact.after) === digest({ raw: 0, cooked: actor.cookedReserve, burnt: 0 })
                && digest(integrity.foodMutationOrigin(fact.mutation)) === digest(fact.proof), 'Opening food must retain its audited bootstrap origin');
        } } finally { integrity.close(); }
        const rows = db.query('SELECT owner,save FROM accounts ORDER BY owner').all() as { owner: string; save: Uint8Array }[];
        check(rows.length === 4, 'Native baseline must contain exactly four player checkpoints');
        for (const actor of fixture.avatars) {
            const row = rows.find(row => row.owner === actor.username); check(row, 'Native baseline player missing');
            check(digest([...readFileSync(join(root, 'server/engine/data/players/main', `${actor.username}.sav`))]) === digest([...row.save]), 'Native save/checkpoint differs');
            const save = parsePlayerSaveBytes(row.save, receipt.initialSimulationTime, true);
            check(save.valid && save.coins === actor.coinsGp && save.bank.length === 0 && save.equipment.length === 0
                && digest(save.position) === digest(actor.position), `Native opening player balance/position differs: ${actor.agentId}`);
            const aggregate = (items: { id: number; count: number }[]) => [...items.reduce((map, item) => map.set(item.id, (map.get(item.id) ?? 0) + item.count), new Map<number, number>())].sort(([a], [b]) => a - b);
            const expected = [{ id: 995, count: actor.coinsGp }, ...actor.tools.map(t => ({ id: t.itemId, count: t.count })),
                ...(actor.cookedReserve ? [{ id: 379, count: actor.cookedReserve }] : [])].filter(item => item.count);
            check(digest(aggregate(save.inventory)) === digest(aggregate(expected)), `Native opening inventory differs: ${actor.agentId}`);
            for (const [name, minimum] of Object.entries(actor.personalSkills)) check(levelForXp(save.skills.find(s => s.name === name)!.experience) === minimum, `Personal skill differs: ${name}`);
            check(save.skills.find(s => s.name === 'Hitpoints')?.level === 10, 'Native starting Hitpoints differs');
        }
    });
    read(root, '.local/agent-state/agents.sqlite', db => {
        check((db.query('SELECT COUNT(*) AS n FROM agent_identity').get() as { n: number }).n === 5, 'Fixture requires four avatars and one institution');
        const members = db.query('SELECT agent_id,player_username,source_result_digest FROM agent_population_member ORDER BY agent_id').all() as any[];
        check(members.length === 4 && members.every(row => fixture.avatars.some(a => a.agentId === row.agent_id && a.username === row.player_username)
            && row.source_result_digest === receipt.resultDigest), 'Population/genesis source binding differs');
    });
    read(root, '.local/economy/institution-treasury.sqlite', db => {
        const row = db.query('SELECT * FROM institution_treasury WHERE actor_kind=\'business\' AND actor_id=?1').get(fixture.kitchen.businessId) as any;
        check(row?.balance_gp === fixture.kitchen.treasuryGp && row.reserved_gp === 0, 'Native baseline treasury differs');
    });
    read(root, '.local/economy/businesses.sqlite', db => {
        const items = db.query('SELECT item_id,count FROM business_inventory WHERE business_id=?1 AND count>0 ORDER BY item_id').all(fixture.kitchen.businessId);
        check(digest(items) === digest(fixture.kitchen.rawOpening ? [{ item_id: 377, count: fixture.kitchen.rawOpening }] : []), 'Business opening stock differs');
        const employments = db.query('SELECT worker_agent_id,wage_gp,role_definition_id,status FROM business_employment WHERE business_id=?1 ORDER BY worker_agent_id').all(fixture.kitchen.businessId) as any[];
        check(employments.length === 2 && employments.some(e => e.worker_agent_id === fixture.kitchen.cookAgentId && e.wage_gp === fixture.kitchen.cookWageGp && e.role_definition_id === 'business.cook.v1' && e.status === 'active')
            && employments.some(e => e.worker_agent_id === fixture.kitchen.courierAgentId && e.wage_gp === fixture.kitchen.deliveryWageGp && e.role_definition_id === 'business.delivery.v1' && e.status === 'active'), 'Opening wage/employment authority differs');
        check((db.query('SELECT COUNT(*) AS n FROM business_facility_entitlement WHERE business_id=?1').get(fixture.kitchen.businessId) as { n: number }).n === 2, 'Facility grants missing');
    });
    read(root, '.local/admin/properties.sqlite', db => {
        for (const [propertyId, kind, owner] of [[fixture.kitchen.propertyId, 'business', fixture.kitchen.businessId], [fixture.housing.propertyId, 'player', fixture.housing.landlordAgentId]]) {
            const row = db.query('SELECT * FROM property_state WHERE property_id=?1').get(propertyId!) as any;
            check(row?.status === 'owned' && row.owner_kind === kind && row.owner_id === owner, 'Native opening Property title differs');
        }
    });
    read(root, '.local/simulation/food-needs.sqlite', db => {
        const states = db.query('SELECT snapshot_json FROM needs_state').all() as { snapshot_json: string }[];
        check(states.length === 4 && states.every(row => { const state = JSON.parse(row.snapshot_json);
            return receipt.lifecycles.some((actor: any) => actor.agentId === state.binding.actorId && actor.needsDigest === state.state.digest && digest(actor.binding) === digest(state.binding))
                && state.state.observedAtSimulationTime === fixture.clock.initialSimulationTime && state.state.values.every((v: any) => v.remainderNumerator === 0); }), 'Initial needs/lifecycle/remainder differs');
    });
    const founder=fixture.founderBaseline?verifyCommonFounderOpening(root,fixture,receipt):null;
    return { receipt, paths: integrationPaths(root), native: nativeInventory(root),founder };
}
export function sealIntegrationBaseline(root: string, fixture: IntegrationFixture) {
    const result = validateNativeIntegrationBaseline(root, fixture), body = { schemaVersion: 1, fixtureDigest: fixture.digest, receiptDigest: digest(result.receipt), native: result.native,
        ...fixture.founderBaseline?{founder:result.founder}:{} };
    check(digest(nativeInventory(root)) === digest(result.native), 'Native baseline changed while sealing');
    const seal = { ...body, digest: digest(body) }; writeFileSync(join(root, SEAL), JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' }); return seal;
}
export function verifyNativeIntegrationSeal(root: string, fixture: IntegrationFixture) {
    const seal = JSON.parse(readFileSync(join(root, SEAL), 'utf8')), { digest: hash, ...body } = seal;
    check(body.schemaVersion === 1 && body.fixtureDigest === fixture.digest && digest(body) === hash, 'Native baseline seal differs');
    const result = validateNativeIntegrationBaseline(root, fixture);
    check(body.receiptDigest === digest(result.receipt), 'Native baseline receipt differs');
    if(fixture.founderBaseline)check(digest(body.founder)===digest(result.founder),'Founder opening seal differs');
    check(digest(result.native) === digest(body.native), 'Native baseline changed since capture; no refill/replay is permitted'); return seal;
}
