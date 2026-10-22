import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BusinessWorkStore, workDigest, type BusinessWorkBinding, type BusinessWorkPolicyCatalog,
    type BusinessWorkOrder, type WorkCompletionEvidence } from '../../../business-work/index.js';
import type { BusinessRoleCatalog } from '../../../business-roles/index.js';
import type { AgentPlayerActionRequest } from '../../../agent-state/types.js';
import type { SkillRunResult } from '../../../agent-skills/types.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { readNativeKitchen } from '../../engine/src/mods/NativeKitchenStore.js';
import { foodDigest } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { readNativeKitchenWip } from '../../../production-workflow/native-kitchen-wip.js';
import { readNativeTradeLedger, ZERO } from '../../../external-trade/source.js';
import { assertNativeFoodDomainPath, assertNativeFoodPath } from '../../../food-loop/native-source.js';
import { verifyFoodSkillRunSources } from './native-food-skills.js';
import { populationNeedsOptions } from './needs-runtime.js';
import { businessManagerPathFor } from './business-agent-port.js';
import { repoRoot, skillRunsDir } from './paths.js';

/** Trusted backend configuration; never populated from a player/model request body. */
export interface BusinessWorkRuntimeOptions {
    workspace?: string; worldId?: string; checkpointPath?: string; tradePath?: string; rewardPath?: string;
    runRoot?: string; catalog?: BusinessWorkPolicyCatalog; roles?: BusinessRoleCatalog;
}
/** Filter terminal history before the bounded recovery batch, retaining interrupted hold cleanup. */
export function businessWorkNeedsRecovery(order: Pick<BusinessWorkOrder, 'status' | 'wageStatus' | 'scheduledEnd'>,
    request: Pick<AgentPlayerActionRequest, 'status'> | null, held: boolean, runId: string | null, now: string): boolean {
    if (order.wageStatus === 'paid' || request?.status === 'settling') return false;
    if (request && ['failed', 'rejected', 'cancelled'].includes(request.status)) return order.status !== 'cancelled' || held;
    if (!request) return order.status !== 'cancelled' || held;
    if (request.status === 'completed') return order.wageStatus === 'earned';
    return request.status === 'running' || !!runId || now > order.scheduledEnd;
}
export function useBusinessWork<T>(agentPath: string, options: BusinessWorkRuntimeOptions,
    read: (work: BusinessWorkStore) => T): T {
    const work = new BusinessWorkStore(businessManagerPathFor(agentPath), options.catalog, options.roles);
    try { return read(work); } finally { work.close(); }
}
export function workSources(agentPath: string, options: BusinessWorkRuntimeOptions) {
    const workspace = options.workspace ?? repoRoot, worldId = options.worldId ?? populationNeedsOptions(workspace).worldId;
    return { workspace, worldId, businessPath: businessManagerPathFor(agentPath),
        checkpointPath: options.checkpointPath ?? resolve(workspace, 'server/engine', process.env.PLAYER_CHECKPOINT_DATABASE
            ?? process.env.GE_DATABASE ?? 'data/player-checkpoints.sqlite') };
}
export function workTrades(agentPath: string, options: BusinessWorkRuntimeOptions) {
    const sources = workSources(agentPath, options), path = options.tradePath
        ?? resolve(sources.workspace, 'server/engine', process.env.TRADE_EVIDENCE_DB ?? 'data/mods/trade-evidence.sqlite');
    assertNativeFoodPath({ ...sources, checkpointPath: path });
    return readNativeTradeLedger(path);
}
export function workTradeCursor(agentPath: string, options: BusinessWorkRuntimeOptions) {
    const trades = workTrades(agentPath, options); return { afterSequence: trades.length, afterHash: trades.at(-1)?.headHash ?? ZERO };
}
export function assertWorkRequest(binding: BusinessWorkBinding, request: AgentPlayerActionRequest): void {
    const expected = binding.request;
    if (request.requestId !== expected.requestId || request.requesterAgentId !== binding.requesterAgentId
        || request.assigneeAgentId !== expected.assigneeAgentId || request.rewardGp !== expected.rewardGp
        || workDigest(request.skill) !== workDigest(expected.skill) || workDigest(request.parameters) !== workDigest(expected.parameters)
        || request.objective !== expected.objective || (request.runId && request.runId !== binding.runId)
        || (request.settlementId && request.settlementId !== binding.settlementId)) throw new Error('Bound player-action request differs');
}
/** Only persisted native completion earns the existing shift claim. A process result alone earns nothing. */
export function nativeWorkCompletion(agentPath: string, binding: BusinessWorkBinding, request: AgentPlayerActionRequest,
    options: BusinessWorkRuntimeOptions): WorkCompletionEvidence {
    assertWorkRequest(binding, request);
    if (!binding.runId || !request.startedAt) throw new Error('Native work has no started request');
    const path = join(options.runRoot ?? skillRunsDir, `${binding.runId}.json`);
    if (!existsSync(path)) throw new Error('Native work terminal journal is pending; reconciliation required');
    const text = readFileSync(path, 'utf8'); if (text.length > 1_000_000) throw new Error('Native work journal exceeds limit');
    const run = JSON.parse(text) as SkillRunResult;
    if (run.runId !== binding.runId || run.username !== binding.username || run.status !== 'completed'
        || workDigest(run.skill) !== workDigest(binding.request.skill) || workDigest(run.parameters) !== workDigest(binding.request.parameters)
        || !Array.isArray(run.events) || run.events.some(e => e.runId !== run.runId || e.type === 'step.failed')
        || run.events[0]?.type !== 'skill.started' || run.events.at(-1)?.type !== 'skill.completed')
        throw new Error('Native work exact terminal run/parameters are not completed');
    const started = run.events[0]!.timestamp, finished = run.events.at(-1)!.timestamp;
    if (!Number.isFinite(Date.parse(started)) || !Number.isFinite(Date.parse(finished))
        || started < request.startedAt || finished < started) throw new Error('Native work journal interval differs');
    let evidenceId: string, completedAt: string;
    if (binding.target.kind === 'cook') {
        const sources = workSources(agentPath, options);
        if (!verifyFoodSkillRunSources(sources.workspace, run, sources)) throw new Error('Native cooking source is not verified');
        const db = new OwnedDatabase(sources.checkpointPath, { readonly: true, strict: true });
        try {
            const native = readNativeKitchen(db).find(row => row.binding.intent.runId === (binding.target as { kitchenRunId: string }).kitchenRunId);
            const intent = native?.binding.intent;
            const cookedEvents = run.events.filter(e => e.type === 'step.succeeded' && e.operation === 'food-cook');
            if (!native || native.phase !== 'returned-output' || native.receipt?.outcome !== 'cooked'
                || intent?.businessId !== useBusinessWork(agentPath, options, w => w.get(binding.workOrderId)!.businessId)
                || intent.actorAgentId !== request.assigneeAgentId || intent.username !== binding.username
                || intent.batchId !== binding.target.batchId || intent.worldId !== sources.worldId
                || run.parameters?.['kitchen-run'] !== binding.target.kitchenRunId || run.parameters?.['batch-id'] !== binding.target.batchId
                || cookedEvents.length !== 1 || workDigest(cookedEvents[0]!.data?.receipt) !== workDigest(native.receipt))
                throw new Error('Native cooking work target differs');
            evidenceId = native.receipt.action.actionId; completedAt = native.clock.wallTime;
        } finally { db.close(true); }
    } else {
        const target = binding.target, trades = workTrades(agentPath, options);
        if (target.afterSequence > trades.length || (target.afterSequence ? trades[target.afterSequence - 1]?.headHash : ZERO) !== target.afterHash)
            throw new Error('Native delivery source prefix differs');
        const matches = trades.filter(({ sequence, event: e }) => sequence > target.afterSequence && e.committedAt >= started && e.committedAt <= finished
            && ((e.fromUsername === binding.username && e.toUsername === target.recipient && e.toItems.length === 0
                && e.fromItems.length === 1 && e.fromItems[0]?.id === target.itemId && e.fromItems[0].count === target.quantity)
                || (e.toUsername === binding.username && e.fromUsername === target.recipient && e.fromItems.length === 0
                    && e.toItems.length === 1 && e.toItems[0]?.id === target.itemId && e.toItems[0].count === target.quantity)));
        if (matches.length !== 1 || !run.events.some(e => e.type === 'step.succeeded' && e.operation === 'trade-give-item'))
            throw new Error('Native delivery is missing, partial or ambiguous');
        evidenceId = matches[0]!.event.eventId; completedAt = matches[0]!.event.committedAt;
    }
    // A source-backed food retry may finish the same immutable invocation after
    // the engine committed it. Its new process journal starts later; the bound
    // request and unique kitchen/run/action evidence retain the original lower bound.
    const nativeStarted = binding.target.kind === 'cook' ? request.startedAt : started;
    if (completedAt < nativeStarted || completedAt > finished) throw new Error('Native completion lies outside its exact run');
    return { evidenceId, workOrderId: binding.workOrderId,
        businessId: useBusinessWork(agentPath, options, w => w.get(binding.workOrderId)!.businessId),
        workerAgentId: request.assigneeAgentId, skill: request.skill, status: 'completed', startedAt: request.startedAt, completedAt };
}
export function assertCookTarget(agentPath: string, options: BusinessWorkRuntimeOptions, binding: BusinessWorkBinding): void {
    const target = binding.target; if (target.kind !== 'cook') return;
    const sources = workSources(agentPath, options); assertNativeFoodDomainPath({ ...sources, checkpointPath: sources.businessPath });
    const db = new OwnedDatabase(sources.businessPath, { readonly: true, strict: true });
    try {
        const row = readNativeKitchenWip(db).find(row => row.binding.intent.runId === target.kitchenRunId), intent = row?.binding.intent;
        const order = useBusinessWork(agentPath, options, w => w.get(binding.workOrderId)!);
        if (!row || row.phase !== 'prepared' || row.revoked || intent?.batchId !== target.batchId || intent.businessId !== order.businessId
            || intent.actorAgentId !== order.workerAgentId || intent.username !== binding.username || intent.worldId !== sources.worldId)
            throw new Error('Work order requires its exact prepared native kitchen reservation');
    } finally { db.close(true); }
}
/** Reopens the engine's existing receipt table. No HTTP ACK or posted receipt can mark a shift paid. */
export function nativeWorkReward(agentPath: string, binding: BusinessWorkBinding, options: BusinessWorkRuntimeOptions) {
    const sources = workSources(agentPath, options), path = options.rewardPath ?? resolve(sources.workspace, 'server/engine/data/mods/player-action-rewards.sqlite');
    assertNativeFoodPath({ ...sources, checkpointPath: path });
    if (!existsSync(path)) return null;
    const db = new OwnedDatabase(path, { readonly: true, strict: true });
    try {
        const row = db.query('SELECT * FROM player_action_reward WHERE settlement_id=?1').get(binding.settlementId) as {
            username: string; amount: number; status: string; coins_before: number; coins_after: number } | null;
        if (!row) return null;
        const marker = db.query("SELECT 1 FROM sqlite_master WHERE name='player_action_reward_checkpoint'").get()
            ? db.query('SELECT receipt_digest FROM player_action_reward_checkpoint WHERE settlement_id=?1').get(binding.settlementId) as { receipt_digest: string } | null : null;
        if (marker && (marker.receipt_digest !== foodDigest({ username: row.username, amount: row.amount, status: row.status, coinsBefore: row.coins_before, coinsAfter: row.coins_after })
            || !existsSync(sources.checkpointPath))) throw new Error('Native wage checkpoint source is missing or differs; reconciliation required');
        if (existsSync(sources.checkpointPath)) { const checkpoint = new OwnedDatabase(sources.checkpointPath, { readonly: true, strict: true });
        try {
            if (checkpoint.query("SELECT 1 FROM sqlite_master WHERE name='player_action_reward'").get()) {
                const canonical = checkpoint.query('SELECT * FROM player_action_reward WHERE settlement_id=?1').get(binding.settlementId) as any;
                if (!canonical || canonical.status !== 'committed' || canonical.username !== row.username || canonical.amount !== row.amount
                    || canonical.coins_before !== row.coins_before || canonical.coins_after !== row.coins_after)
                    throw new Error('Native wage checkpoint proof is missing or differs; reconciliation required');
            } else if (marker) throw new Error('Native wage checkpoint proof is missing; reconciliation required');
        } finally { checkpoint.close(true); } }
        if (row.username !== binding.username || row.amount !== binding.request.rewardGp || row.status !== 'committed'
            || !Number.isSafeInteger(row.coins_before) || !Number.isSafeInteger(row.coins_after) || row.coins_before < 0
            || row.coins_after - row.coins_before !== row.amount) throw new Error('Native wage receipt is pending or differs; reconciliation required');
        return { status: 'committed' as const, coinsBefore: row.coins_before, coinsAfter: row.coins_after };
    } finally { db.close(true); }
}
