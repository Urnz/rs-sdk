import type { ItemLifecycleCatalog } from '../item-lifecycle/types.js';
import type { ItemRepairPolicyCatalog } from '../item-lifecycle/repair-policy.js';
import { integer, timestamp } from './policy.js';
import { nativeHash, requireEvidence as check, same, type LedgerData, type Row } from './sources.js';

export function toolObservations(data: LedgerData, catalog: ItemLifecycleCatalog, repairs: ItemRepairPolicyCatalog) {
    const tables = data.tables, rows = tables.item_instance!, operations = tables.item_lifecycle_operation!,
        replacements = tables.item_replacement!, repairEvidence = tables.item_repair_evidence!;
    check(operations.length === tables.audit!.length, 'Tool operations/audit count differs');
    const instances = new Map<string, { row: Row; durability: number; revision: number; at: string; retired: boolean }>();
    const transitions: Array<{ actor: string; typeId: string; instanceId: string; at: number; kind: string;
        before: number; after: number; retired: boolean; operationId: string; materials: Array<{ itemId: number; quantity: number }> }> = [];
    let replacementCount = 0, repairCount = 0;
    function create(instanceId: string, at: string, operationId: string) {
        const row = rows.find(item => item.item_instance_id === instanceId);
        check(row && !instances.has(instanceId), 'Missing/duplicate tool creation');
        const definition = catalog.items.find(item => item.lifecycleTypeId === row.lifecycle_type_id);
        check(definition && definition.itemId === row.item_id && definition.maxDurability === row.max_durability
            && row.created_at === at && /^[0-9a-f]{64}$/.test(row.provenance_digest), 'Tool definition differs');
        const state = { row, durability: definition.maxDurability, revision: 1, at, retired: false };
        instances.set(instanceId, state);
        transitions.push({ actor: row.owner_actor_id, typeId: definition.lifecycleTypeId, instanceId, at: timestamp(at),
            kind: 'created', before: 0, after: state.durability, retired: false, operationId, materials: [] });
        return state;
    }
    const seen = new Set<string>();
    for (const audit of tables.audit!) {
        check(!seen.has(audit.operationId), 'Duplicate tool audit'); seen.add(audit.operationId);
        const operation = operations.find(item => item.operation_id === audit.operationId), detail = audit.detail;
        check(operation && operation.item_instance_id === audit.instanceId && operation.kind === audit.kind
            && operation.occurred_at === audit.at && same(JSON.parse(operation.detail_json), detail)
            && operation.request_digest === (detail.requestDigest ?? nativeHash(detail)), 'Tool operation/audit differs');
        if (audit.kind === 'created') {
            const state = create(audit.instanceId, audit.at, audit.operationId);
            check(detail.provenanceDigest === state.row.provenance_digest, 'Tool provenance differs'); continue;
        }
        const state = instances.get(audit.instanceId);
        check(state && !state.retired && timestamp(state.at) <= timestamp(audit.at), 'Invalid tool operation order');
        const definition = catalog.items.find(item => item.lifecycleTypeId === state.row.lifecycle_type_id)!;
        let materials: Array<{ itemId: number; quantity: number }> = [];
        const before = state.durability;
        if (audit.kind === 'replaced') {
            check(before === 0, 'Only broken tool can be replaced');
            const replacement = replacements.find(item => item.operation_id === audit.operationId);
            const next = create(detail.replacementItemInstanceId, audit.at, audit.operationId);
            check(replacement && same(replacement, { operation_id: audit.operationId, replaced_item_instance_id: audit.instanceId,
                replacement_item_instance_id: detail.replacementItemInstanceId, owner_actor_id: state.row.owner_actor_id,
                evidence_digest: detail.evidenceDigest, occurred_at: audit.at }) && next.row.owner_actor_id === state.row.owner_actor_id
                && next.row.lifecycle_type_id === state.row.lifecycle_type_id
                && next.row.provenance_digest === detail.provenanceDigest, 'Tool replacement binding differs');
            state.retired = true; replacementCount++;
            materials = [{ itemId: definition.itemId, quantity: 1 }];
        } else {
            const amount = integer(detail.amount);
            check(amount > 0 && detail.before === before, 'Invalid tool delta');
            if (audit.kind === 'used') check(before > 0 && detail.after === Math.max(0, before - definition.wearPerUse * amount), 'Invalid wear delta');
            else {
                check(audit.kind === 'repaired' && definition.repairable && detail.after > before
                    && detail.after === Math.min(definition.maxDurability, before + amount), 'Invalid repair delta');
                const evidence = detail.evidenceDetail, policy = repairs.policies.find(item => item.policyId === evidence?.policyId);
                check(policy && evidence.policyDigest === repairs.digest && policy.lifecycleTypeId === definition.lifecycleTypeId
                    && amount === policy.restoredDurability && before === 0
                    && repairEvidence.some(item => item.operation_id === audit.operationId && item.material_receipt_id === evidence.materialReceiptId
                        && item.receipt_digest === evidence.inputReceiptDigest), 'Repair input/policy binding differs');
                // Consumption time and actual input lots were not persisted; this is associated policy demand only.
                materials = policy.materials; repairCount++;
            }
            state.durability = integer(detail.after);
        }
        state.at = audit.at; state.revision++;
        transitions.push({ actor: state.row.owner_actor_id, typeId: definition.lifecycleTypeId, instanceId: audit.instanceId,
            at: timestamp(audit.at), kind: audit.kind, before, after: state.durability, retired: state.retired,
            operationId: audit.operationId, materials });
    }
    check(instances.size === rows.length && replacementCount === replacements.length && repairCount === repairEvidence.length,
        'Tool ledger has unmatched rows');
    for (const state of instances.values()) check(state.row.durability === state.durability && state.row.revision === state.revision
        && state.row.updated_at === state.at && state.row.status === (state.durability === 0 ? 'broken' : 'usable'), 'Tool current state differs from replay');
    return transitions;
}
