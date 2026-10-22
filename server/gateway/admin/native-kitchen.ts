import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import type { FacilityAccessGrantEvidence } from '../../../facility-capability/types.js';
import type { FacilityGrantVerifier } from '../../../facility-capability/authorization.js';
import { loadFacilityCapabilityCatalog } from '../../../facility-capability/catalog.js';
import { loadProductionWorkflowCatalog } from '../../../production-workflow/catalog.js';
import { loadNativeKitchenPolicy } from '../../../production-workflow/native-kitchen-policy.js';
import { ProductionWorkInProgressStore } from '../../../production-workflow/wip-store.js';
import { NativeKitchenResultSource } from '../../../production-workflow/native-kitchen-source.js';
import { assertNativeFoodDomainPath, assertNativeFoodPath } from '../../../food-loop/native-source.js';
import { populationNeedsBinding } from './needs-runtime.js';
import type { NativeKitchenCommand, NativeKitchenResponse } from '../../engine/src/mods/NativeKitchenStore.js';

export interface PopulationKitchenOptions { workspace: string; worldId: string; businessPath: string; checkpointPath: string }
function open(options: PopulationKitchenOptions): ProductionWorkInProgressStore {
    assertNativeFoodDomainPath({ ...options, checkpointPath: options.businessPath });
    return new ProductionWorkInProgressStore(options.businessPath,
        loadProductionWorkflowCatalog(join(options.workspace, 'config/production-workflows.json')));
}
/** Backend identity comes from the existing population member, never a posted worker or receipt. */
export function reservePopulationKitchen(options: PopulationKitchenOptions, member: AgentPopulationMember, clock: SimulationClockObservation,
    request: { operationId: string; runId: string; businessId: string; sourceStorageId: string | null; targetStorageId: string | null },
    grant: FacilityAccessGrantEvidence, verify: FacilityGrantVerifier) {
    if (member.status !== 'active' || member.characterLifecycle.status !== 'active') throw new Error('Kitchen requires an active population worker');
    const identity = populationNeedsBinding(options.worldId, member);
    if (identity.clockId !== clock.clockId || identity.clockProfileDigest !== clock.profileDigest || clock.status !== 'running') throw new Error('Kitchen population clock differs');
    const work = open(options);
    try {
        const policy = loadNativeKitchenPolicy(options.workspace), existing = work.nativeKitchen(request.runId);
        const intent = { runId: request.runId, businessId: request.businessId, actorAgentId: member.agentId, username: member.playerUsername,
            worldId: options.worldId, lifecycleId: identity.lifecycleId, clockId: identity.clockId, clockProfileDigest: identity.clockProfileDigest,
            catalogDigest: loadProductionWorkflowCatalog(join(options.workspace, 'config/production-workflows.json')).digest, policy,
            actionId: existing?.binding.intent.actionId ?? randomUUID(), inputEscrowId: existing?.binding.intent.inputEscrowId ?? randomUUID(),
            outputEscrowId: existing?.binding.intent.outputEscrowId ?? randomUUID(), batchId: `kitchen:${request.runId}`, stepId: 'cook',
            targetStorageId: request.targetStorageId, grant };
        return work.reserveNativeKitchen({ operationId: request.operationId, runId: request.runId, businessId: request.businessId,
            actorAgentId: member.agentId, workflowId: 'food.cooked-lobster', workflowVersion: '1.0.0',
            inputs: [{ itemId: 377, count: 1, storageId: request.sourceStorageId }] }, intent,
        loadFacilityCapabilityCatalog(join(options.workspace, 'config/facility-capabilities.json')), clock.simulationTime, verify);
    } finally { work.close(); }
}
/** HTTP success is status only; finalization always reopens the native source DB. Retrying a timed-out command is safe. */
export async function requestNativeKitchen(command: NativeKitchenCommand): Promise<NativeKitchenResponse> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim(); if (!token) throw new Error('Native kitchen engine channel is unavailable');
    const url = new URL('/api/internal/admin/native-kitchen', process.env.ENGINE_ADMIN_URL?.trim() ?? 'http://localhost:8888');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Native kitchen requires a local/private engine');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
        body: JSON.stringify({ commandId: randomUUID(), ...command }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as NativeKitchenResponse;
    if (!response.ok || !result.ok) throw new Error(result.ok ? 'Native kitchen request failed' : result.error);
    return result;
}
export function finalizePopulationKitchen(options: PopulationKitchenOptions, runId: string) {
    assertNativeFoodPath({ ...options, checkpointPath: options.checkpointPath });
    const work = open(options);
    let source: NativeKitchenResultSource | undefined;
    try {
        source = new NativeKitchenResultSource({ ...options, checkpointPath: options.checkpointPath });
        return work.settleNativeKitchen(runId, source);
    } finally { source?.close(); work.close(); }
}
