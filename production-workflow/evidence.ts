import type { Database } from 'bun:sqlite';
import { digest, hash, integer, key, object, time } from '../external-trade/policy.js';
import { check, nativeHash } from '../external-trade/source.js';
import type { BoundSimulationEventStamp } from '../simulation-clock/types.js';
import { validateProductionWorkflowCatalog } from './catalog.js';
import { compileProductionWorkflow } from './planner.js';
import type { ProductionWorkflowCatalog, CompiledProductionWorkflow } from './types.js';
import type { ProductionStepEvidence } from './wip-store.js';

export interface ProductionLotEvidence { materialId: number; itemId: number; quantity: number; before: number; after: number;
    sourceStorageId: string | null; originStepId: string | null }
export interface ProductionCommitFacts {
    schemaVersion: 1; runId: string; businessId: string; recordedActorAgentId: string; workflowId: string; workflowVersion: string;
    runRequestDigest: string; catalogDigest: string; plan: CompiledProductionWorkflow; evidence: ProductionStepEvidence;
    consumedLots: ProductionLotEvidence[]; producedLots: ProductionLotEvidence[]; recordedAt: string;
}
export interface ProductionCommit { facts: ProductionCommitFacts; factsDigest: string; simulationStamp: BoundSimulationEventStamp | null }
export type ProductionClockBinder = (facts: Readonly<ProductionCommitFacts>, factsDigest: string) => BoundSimulationEventStamp | null;
export const productionSourceId = (operationId: string) => `production:${digest(operationId)}`;
const legacyRows = (db: Database) => db.query('SELECT * FROM business_production_evidence_legacy ORDER BY operation_id').all() as any[];

/** Additive source migration. Existing step references are marked unverified, never backfilled as production receipts. */
export function initializeProductionEvidence(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS business_production_evidence_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,legacy_digest TEXT NOT NULL)');
        const schema = db.query('SELECT * FROM business_production_evidence_schema WHERE singleton=1').get() as any;
        if (schema) { check(schema.version === 1, 'Unsupported production evidence schema'); return; }
        db.run(`CREATE TABLE business_production_evidence_legacy(operation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,step_id TEXT NOT NULL,request_digest TEXT NOT NULL)`);
        db.run(`INSERT INTO business_production_evidence_legacy SELECT operation_id,run_id,step_id,request_digest FROM business_production_step`);
        db.run('INSERT INTO business_production_evidence_schema VALUES(1,1,?1)', [digest(legacyRows(db))]);
        db.run('CREATE TABLE business_production_evidence_catalog(digest TEXT PRIMARY KEY,definition_json TEXT NOT NULL)');
        db.run(`CREATE TABLE business_production_evidence(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,receipt_json TEXT NOT NULL,
            receipt_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
        const initial = digest({ version: 1, legacyDigest: digest(legacyRows(db)) });
        db.run('CREATE TABLE business_production_evidence_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,entry_hash TEXT NOT NULL)');
        db.run('INSERT INTO business_production_evidence_head VALUES(1,0,?1)', [initial]);
    }).immediate();
}
export function appendProductionEvidence(db: Database, catalog: ProductionWorkflowCatalog, facts: ProductionCommitFacts, bind?: ProductionClockBinder): void {
    const { digest: catalogDigest, ...definition } = catalog;
    db.run('INSERT OR IGNORE INTO business_production_evidence_catalog VALUES(?1,?2)', [catalogDigest, JSON.stringify(definition)]);
    const factsDigest = digest(facts);
    let simulationStamp: BoundSimulationEventStamp | null = null;
    try { simulationStamp = bind?.(Object.freeze(structuredClone(facts)), factsDigest) ?? null; }
    catch (error) { console.warn('[business-production] Clock binding unavailable; committed production remains untimed', error); }
    const receipt: ProductionCommit = { facts, factsDigest, simulationStamp }, receiptDigest = digest(receipt),
        head = db.query('SELECT * FROM business_production_evidence_head WHERE singleton=1').get() as any;
    check(head, 'Production evidence head is missing');
    const sequence = integer(head.sequence) + 1, entryHash = digest({ sequence, receiptDigest, previousHash: head.entry_hash });
    db.run('INSERT INTO business_production_evidence VALUES(?1,?2,?3,?4,?5,?6)',
        [sequence, facts.evidence.operationId, JSON.stringify(receipt), receiptDigest, head.entry_hash, entryHash]);
    db.run('UPDATE business_production_evidence_head SET sequence=?1,entry_hash=?2 WHERE singleton=1', [sequence, entryHash]);
}

/** Verifies the native source and allocation conservation. Caller supplies a single SQLite snapshot/transaction. */
export function readProductionEvidence(db: Database) {
    const schema = db.query('SELECT * FROM business_production_evidence_schema WHERE singleton=1').get() as any;
    check(schema?.version === 1, 'Unsupported production evidence schema');
    const legacy = legacyRows(db); check(digest(legacy) === schema.legacy_digest, 'Production legacy reference digest differs');
    const rows = db.query('SELECT * FROM business_production_evidence ORDER BY sequence').all() as any[],
        steps = db.query('SELECT * FROM business_production_step').all() as any[],
        runs = db.query('SELECT * FROM business_production_run').all() as any[],
        materials = db.query('SELECT * FROM business_production_material').all() as any[];
    check(Math.max(rows.length, steps.length, runs.length, materials.length, legacy.length) <= 100000, 'Production source exceeds row limit');
    check(rows.length + legacy.length === steps.length, 'Production steps lack matching evidence or legacy references');
    for (const row of legacy) check(steps.some(step => step.operation_id === row.operation_id && step.run_id === row.run_id
        && step.step_id === row.step_id && step.request_digest === row.request_digest), 'Production legacy reference changed');
    const catalogs = new Map<string, ProductionWorkflowCatalog>();
    for (const row of db.query('SELECT * FROM business_production_evidence_catalog').all() as any[]) {
        const catalog = validateProductionWorkflowCatalog(JSON.parse(row.definition_json)); check(catalog.digest === row.digest, 'Production frozen catalog differs'); catalogs.set(row.digest, catalog);
    }
    let previous = digest({ version: 1, legacyDigest: schema.legacy_digest });
    const lots = new Map<number, { runId: string; itemId: number; remaining: number; originStepId: string | null; sourceStorageId: string | null; producerOperationId: string | null }>();
    const seenSteps = new Set<string>(), seenOperations = new Set<string>();
    const receipts: ProductionCommit[] = rows.map((row, index) => {
        const receipt = JSON.parse(row.receipt_json) as ProductionCommit, f = receipt.facts;
        object(receipt, ['facts', 'factsDigest', 'simulationStamp']);
        check(f.schemaVersion === 1 && row.sequence === index + 1 && digest(f) === receipt.factsDigest && digest(receipt) === row.receipt_digest
            && row.previous_hash === previous && row.entry_hash === digest({ sequence: row.sequence, receiptDigest: row.receipt_digest, previousHash: previous }), 'Production audit chain differs');
        previous = row.entry_hash;
        key(f.runId); key(f.businessId); key(f.recordedActorAgentId); time(f.recordedAt); hash(f.runRequestDigest); hash(f.catalogDigest);
        const e = f.evidence, stepKey = JSON.stringify([f.runId,e.stepId]), native = steps.find(step => step.operation_id === row.operation_id),
            run = runs.find(run => run.run_id === f.runId), catalog = catalogs.get(f.catalogDigest);
        check(native && run && catalog && !seenSteps.has(stepKey) && !seenOperations.has(e.operationId), 'Production source row is missing/duplicated');
        seenSteps.add(stepKey); seenOperations.add(e.operationId);
        const plan = compileProductionWorkflow(catalog, f.workflowId, f.workflowVersion), step = plan.steps.find(step => step.stepId === e.stepId);
        check(step && digest(f.plan) === digest(plan) && digest(JSON.parse(run.plan_json)) === digest(plan)
            && run.run_id === f.runId && run.business_id === f.businessId && run.actor_agent_id === f.recordedActorAgentId
            && run.workflow_id === f.workflowId && run.workflow_version === f.workflowVersion && run.catalog_digest === f.catalogDigest
            && run.request_digest === f.runRequestDigest && ['running', 'completed'].includes(run.status), 'Production run/recipe binding differs');
        check(row.operation_id === e.operationId && e.runId === f.runId && e.status === 'completed' && native.run_id === f.runId && native.step_id === e.stepId
            && native.request_digest === nativeHash(e) && native.source_evidence_digest === e.sourceEvidenceDigest
            && native.completed_at === e.occurredAt && Number.isFinite(Date.parse(e.occurredAt)), 'Production native receipt differs');
        hash(e.sourceEvidenceDigest);
        const quant = (items: Array<{ itemId: number; quantity: number }>) => items.map(item => ({ itemId: integer(item.itemId, 65535), quantity: integer(item.quantity) })).sort((a, b) => a.itemId - b.itemId);
        check(digest(quant(e.inputs)) === digest(step.inputs) && digest(quant(e.outputs)) === digest(step.outputs), 'Production quantities differ from pinned recipe');
        for (const dependency of step.dependsOn) check(steps.some(other => other.run_id === f.runId && other.step_id === dependency)
            && (seenSteps.has(JSON.stringify([f.runId,dependency])) || legacy.some(other => other.run_id === f.runId && other.step_id === dependency)), 'Production prerequisite is absent');
        function allocations(values: ProductionLotEvidence[], produced: boolean) {
            check(Array.isArray(values) && values.length <= 100000 && new Set(values.map(lot => lot.materialId)).size === values.length, 'Production lot allocations are invalid');
            const totals = new Map<number, number>();
            for (const lot of values) {
                integer(lot.materialId); integer(lot.itemId, 65535); integer(lot.before); integer(lot.after); check(integer(lot.quantity) > 0, 'Production lot quantity is empty');
                const material = materials.find(material => material.material_id === lot.materialId);
                check(material && material.run_id === f.runId && material.item_id === lot.itemId && material.source_storage_id === lot.sourceStorageId
                    && material.origin_step_id === lot.originStepId, 'Production material binding differs');
                const prior = lots.get(lot.materialId);
                if (produced) check(!prior && lot.before === 0 && lot.after === lot.quantity && lot.originStepId === e.stepId && lot.sourceStorageId === null, 'Production output lot differs');
                else {
                    check(lot.before >= lot.quantity && lot.after === lot.before - lot.quantity && (!prior || prior.remaining === lot.before), 'Production input lot was overused');
                    if (lot.originStepId !== null) check(prior?.producerOperationId || legacy.some(old => old.run_id === f.runId && old.step_id === lot.originStepId), 'Production lot origin is absent');
                }
                lots.set(lot.materialId, { runId: f.runId, itemId: lot.itemId, remaining: lot.after, originStepId: lot.originStepId,
                    sourceStorageId: lot.sourceStorageId, producerOperationId: produced ? e.operationId : prior?.producerOperationId ?? null });
                totals.set(lot.itemId, integer((totals.get(lot.itemId) ?? 0) + lot.quantity));
            }
            return [...totals].sort(([a], [b]) => a - b).map(([itemId, quantity]) => ({ itemId, quantity }));
        }
        check(digest(allocations(f.consumedLots, false)) === digest(step.inputs) && digest(allocations(f.producedLots, true)) === digest(step.outputs), 'Production allocation totals differ');
        if (receipt.simulationStamp) check(receipt.simulationStamp.domain === 'business-production' && receipt.simulationStamp.sourceId === productionSourceId(e.operationId)
            && receipt.simulationStamp.sourceDigest === receipt.factsDigest && receipt.simulationStamp.wallTime === f.recordedAt, 'Production clock binding differs');
        return receipt;
    });
    for (const [materialId, lot] of lots) { const material = materials.find(row => row.material_id === materialId)!, run = runs.find(row => row.run_id === lot.runId)!;
        check(material.count === (run.status === 'completed' ? 0 : lot.remaining), 'Production material balance differs'); }
    const head = db.query('SELECT * FROM business_production_evidence_head WHERE singleton=1').get() as any;
    check(head && head.sequence === rows.length && head.entry_hash === previous, 'Production source tail differs');
    return { receipts, legacyStepCount: legacy.length, headHash: previous, entries: rows.length, snapshotDigest: digest({ receipts, legacy, head }) };
}
