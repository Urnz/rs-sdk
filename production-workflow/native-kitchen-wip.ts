import type { Database } from 'bun:sqlite';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { authorizeFacilityCapability, type FacilityGrantVerifier } from '../facility-capability/authorization.js';
import type { FacilityAccessGrantEvidence, FacilityCapabilityCatalog } from '../facility-capability/types.js';
import type { NativeKitchenPolicy } from './native-kitchen-policy.js';
import type { ProductionWorkflowCatalog } from './types.js';
import { compileProductionWorkflow } from './planner.js';
import { businessRoleHasPermission, resolveBusinessRole, type BusinessRoleCatalog } from '../business-roles/index.js';

export interface NativeKitchenIntent {
    runId: string; businessId: string; actorAgentId: string; username: string; worldId: string; lifecycleId: string;
    clockId: string; clockProfileDigest: string; catalogDigest: string; policy: NativeKitchenPolicy;
    actionId: string; inputEscrowId: string; outputEscrowId: string; batchId: string; stepId: string;
    targetStorageId: string | null; grant: FacilityAccessGrantEvidence;
}
export interface NativeKitchenBinding { intent: NativeKitchenIntent; runRequestDigest: string; digest: string }
export interface NativeKitchenWipRow { binding: NativeKitchenBinding; phase: 'prepared' | 'completed' | 'burnt' | 'cancelled'; revoked: boolean; nativeDigest: string | null;
    skillInvocation?: { id: string; digest: string } }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Existing WIP material is an unavailable reservation mirror while physical custody is outstanding. */
export function initializeNativeKitchenWip(db: Database): void {
    db.transaction(() => {
        const columns = db.query('PRAGMA table_info(business_production_run)').all() as { name: string }[];
        if (!columns.some(column => column.name === 'native_binding_digest')) db.run('ALTER TABLE business_production_run ADD COLUMN native_binding_digest TEXT');
        db.run('CREATE TABLE IF NOT EXISTS business_production_native_schema(version INTEGER PRIMARY KEY)');
        const versions = db.query('SELECT version FROM business_production_native_schema').all() as { version: number }[];
        if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1)) throw new Error('Unsupported native WIP schema');
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='business_production_native_operation'").get()) throw new Error('Incomplete native WIP schema');
            db.run(`CREATE TABLE business_production_native_operation(run_id TEXT PRIMARY KEY REFERENCES business_production_run(run_id),
                action_id TEXT NOT NULL UNIQUE,input_escrow_id TEXT NOT NULL UNIQUE,output_escrow_id TEXT NOT NULL UNIQUE,
                row_json TEXT NOT NULL,row_digest TEXT NOT NULL)`);
            db.run(`CREATE TABLE business_production_native_audit(sequence INTEGER PRIMARY KEY,run_id TEXT NOT NULL,
                row_json TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL)`);
            db.run('CREATE TABLE business_production_native_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT)');
            db.run('INSERT INTO business_production_native_head VALUES(1,0,NULL)');
            db.run('INSERT INTO business_production_native_schema VALUES(1)');
        }
        readNativeKitchenWip(db);
    }).immediate();
}
export function readNativeKitchenWip(db: Database): NativeKitchenWipRow[] {
    const versions = db.query('SELECT version FROM business_production_native_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native WIP schema');
    const events = db.query('SELECT * FROM business_production_native_audit ORDER BY sequence').all() as
        { sequence: number; run_id: string; row_json: string; previous_digest: string | null; digest: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, event] of events.entries()) {
        const { digest, ...facts } = event;
        if (event.sequence !== index + 1 || event.previous_digest !== previous || foodDigest(facts) !== digest) throw new Error('Native WIP audit differs');
        latest.set(event.run_id, event.row_json); previous = digest;
    }
    const head = db.query('SELECT sequence,digest FROM business_production_native_head WHERE singleton=1').get() as { sequence: number; digest: string | null } | null;
    if (!head || head.sequence !== events.length || head.digest !== previous) throw new Error('Native WIP audit tail differs');
    const rows = db.query('SELECT * FROM business_production_native_operation').all() as
        { run_id: string; action_id: string; input_escrow_id: string; output_escrow_id: string; row_json: string; row_digest: string }[];
    if (rows.length !== latest.size) throw new Error('Native WIP operation coverage differs');
    const anchors = db.query('SELECT run_id,native_binding_digest FROM business_production_run WHERE native_binding_digest IS NOT NULL').all() as
        { run_id: string; native_binding_digest: string }[];
    if (anchors.length !== rows.length || anchors.some(anchor => !rows.some(row => row.run_id === anchor.run_id
        && (JSON.parse(row.row_json) as NativeKitchenWipRow).binding.digest === anchor.native_binding_digest))) throw new Error('Native WIP reservation anchor is missing');
    const invocations = new Set<string>();
    return rows.map(row => {
        const value = JSON.parse(row.row_json) as NativeKitchenWipRow, { digest, ...binding } = value.binding;
        if (latest.get(row.run_id) !== row.row_json || foodDigest(value) !== row.row_digest || foodDigest(binding) !== digest
            || value.binding.intent.runId !== row.run_id || value.binding.intent.actionId !== row.action_id
            || value.binding.intent.inputEscrowId !== row.input_escrow_id || value.binding.intent.outputEscrowId !== row.output_escrow_id)
            throw new Error('Native WIP operation binding differs');
        const run = db.query('SELECT request_digest,catalog_digest FROM business_production_run WHERE run_id=?1').get(row.run_id) as { request_digest: string; catalog_digest: string } | null;
        if (!run || run.request_digest !== value.binding.runRequestDigest || run.catalog_digest !== value.binding.intent.catalogDigest) throw new Error('Native WIP reservation differs');
        if (!['prepared', 'completed', 'burnt', 'cancelled'].includes(value.phase)) throw new Error('Native WIP phase differs');
        if (value.skillInvocation) {
            if (!UUID.test(value.skillInvocation.id) || !/^[a-f0-9]{64}$/.test(value.skillInvocation.digest)
                || invocations.has(value.skillInvocation.id)) throw new Error('Native WIP skill invocation differs');
            invocations.add(value.skillInvocation.id);
        }
        if (value.phase === 'prepared') {
            const lots = db.query('SELECT item_id,count,origin_step_id FROM business_production_material WHERE run_id=?1 AND count>0').all(row.run_id) as
                { item_id: number; count: number; origin_step_id: string | null }[];
            if (lots.length !== 1 || lots[0]!.item_id !== 377 || lots[0]!.count !== 1 || lots[0]!.origin_step_id !== null) throw new Error('Native WIP input reservation quantity differs');
        }
        return value;
    });
}
export function writeNativeKitchenWip(db: Database, row: NativeKitchenWipRow): void {
    if (!db.inTransaction) throw new Error('Native WIP requires its reservation transaction');
    const existing = readNativeKitchenWip(db), priorRow = existing.find(value => value.binding.intent.runId === row.binding.intent.runId);
    if (priorRow?.skillInvocation && foodDigest(priorRow.skillInvocation) !== foodDigest(row.skillInvocation))
        throw new Error('Native kitchen receipt is bound to another skill run');
    if (row.skillInvocation && (!UUID.test(row.skillInvocation.id) || !/^[a-f0-9]{64}$/.test(row.skillInvocation.digest)
        || existing.some(value => value.binding.intent.runId !== row.binding.intent.runId && value.skillInvocation?.id === row.skillInvocation!.id)))
        throw new Error('Native WIP skill invocation differs');
    const json = JSON.stringify(row), intent = row.binding.intent;
    db.run(`INSERT INTO business_production_native_operation VALUES(?1,?2,?3,?4,?5,?6)
        ON CONFLICT(run_id) DO UPDATE SET row_json=excluded.row_json,row_digest=excluded.row_digest`,
    [intent.runId, intent.actionId, intent.inputEscrowId, intent.outputEscrowId, json, foodDigest(row)]);
    const prior = db.query('SELECT sequence,digest FROM business_production_native_head WHERE singleton=1').get() as { sequence: number; digest: string | null };
    const facts = { sequence: prior.sequence + 1, run_id: intent.runId, row_json: json, previous_digest: prior.digest }, digest = foodDigest(facts);
    db.run('INSERT INTO business_production_native_audit VALUES(?1,?2,?3,?4,?5)', [facts.sequence, intent.runId, json, prior.digest, digest]);
    db.run('UPDATE business_production_native_head SET sequence=?1,digest=?2 WHERE singleton=1', [facts.sequence, digest]);
    db.run('UPDATE business_production_run SET native_binding_digest=?2 WHERE run_id=?1', [intent.runId, row.binding.digest]);
}
export function prepareNativeKitchenWip(db: Database, catalog: ProductionWorkflowCatalog, facilities: FacilityCapabilityCatalog,
    intent: NativeKitchenIntent, at: string, verify: FacilityGrantVerifier): NativeKitchenBinding {
    if ([intent.actionId, intent.inputEscrowId, intent.outputEscrowId].some(id => !UUID.test(id))
        || new Set([intent.actionId, intent.inputEscrowId, intent.outputEscrowId]).size !== 3
        || !/^[a-z0-9]{1,12}$/.test(intent.username) || !intent.worldId || !intent.lifecycleId || !intent.clockId
        || !/^[a-f0-9]{64}$/.test(intent.clockProfileDigest) || intent.catalogDigest !== catalog.digest || !intent.batchId)
        throw new Error('Invalid native kitchen intent');
    const { digest: policyDigest, ...policy } = intent.policy;
    if (foodDigest(policy) !== policyDigest) throw new Error('Native kitchen policy digest differs');
    const run = db.query('SELECT * FROM business_production_run WHERE run_id=?1').get(intent.runId) as
        { actor_agent_id: string; business_id: string; workflow_id: string; workflow_version: string; status: string; request_digest: string } | null;
    if (!run || run.actor_agent_id !== intent.actorAgentId || run.business_id !== intent.businessId) throw new Error('Native kitchen worker/reservation differs');
    const plan = compileProductionWorkflow(catalog, run.workflow_id, run.workflow_version), step = plan.steps[0];
    if (plan.steps.length !== 1 || !step || step.stepId !== intent.stepId || step.batches !== 1
        || step.recipe.id !== 'food.cook-lobster' || step.recipe.version !== '1.0.0'
        || foodDigest(plan.externalInputs) !== foodDigest([{ itemId: 377, quantity: 1 }])
        || foodDigest(plan.finalOutputs) !== foodDigest([{ itemId: 379, quantity: 1 }])) throw new Error('Native kitchen requires one exact lobster batch');
    const facts = { intent: structuredClone(intent), runRequestDigest: run.request_digest };
    const binding = { ...facts, digest: foodDigest(facts) };
    const prior = readNativeKitchenWip(db).find(row => row.binding.intent.runId === intent.runId);
    if (prior) { if (prior.binding.digest !== binding.digest) throw new Error('Native kitchen run binding reused'); return prior.binding; }
    if (run.status !== 'reserved') throw new Error('Native kitchen reservation has already started');
    authorizeKitchenGrant(intent, facilities, at, verify);
    writeNativeKitchenWip(db, { binding, phase: 'prepared', revoked: false, nativeDigest: null });
    return binding;
}
export function authorizeKitchenGrant(intent: NativeKitchenIntent, facilities: FacilityCapabilityCatalog, at: string, verify: FacilityGrantVerifier): void {
    const authorization = authorizeFacilityCapability(facilities, { subjectAgentId: intent.actorAgentId, facilityId: intent.policy.facilityId,
        capabilityId: intent.policy.capabilityId, at }, [intent.grant], verify);
    if (authorization.businessId !== null && authorization.businessId !== intent.businessId) throw new Error('Kitchen facility belongs to another Business');
}
export function authorizeKitchenRole(db: Database, intent: NativeKitchenIntent, roles: BusinessRoleCatalog): void {
    const business = db.query('SELECT owner_agent_id,status FROM business WHERE business_id=?1').get(intent.businessId) as { owner_agent_id: string; status: string } | null;
    if (!business || business.status !== 'active') throw new Error('Native kitchen Business is inactive');
    if (business.owner_agent_id === intent.actorAgentId) return;
    const employment = db.query("SELECT role_definition_id FROM business_employment WHERE business_id=?1 AND worker_agent_id=?2 AND status='active'")
        .get(intent.businessId, intent.actorAgentId) as { role_definition_id: string } | null;
    if (!employment) throw new Error('Native kitchen worker role is no longer entitled');
    const role = resolveBusinessRole(roles, employment.role_definition_id);
    const lots = db.query('SELECT source_storage_id FROM business_production_material WHERE run_id=?1 AND count>0').all(intent.runId) as { source_storage_id: string | null }[];
    if (!lots.length || lots.some(lot => !businessRoleHasPermission(role, lot.source_storage_id ? 'storage' : 'inventory', lot.source_storage_id ? 'withdraw' : 'issue'))
        || !businessRoleHasPermission(role, intent.targetStorageId ? 'storage' : 'inventory', intent.targetStorageId ? 'deposit' : 'receive'))
        throw new Error('Native kitchen worker role is no longer entitled');
}
