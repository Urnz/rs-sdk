import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { assertNativeFoodPath, assertNativeFoodDomainPath } from '../../../food-loop/native-source.js';
import { foodDigest, readFoodResult, assertFoodSchema, type FoodResult } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { assertFoodProductionSchema, readFoodProductionReceipt, type FoodProductionReceipt } from '../../engine/src/mods/NativeFoodProductionStore.js';
import { readNativeKitchen, type NativeKitchenRecord } from '../../engine/src/mods/NativeKitchenStore.js';
import { NativeKitchenReservationSource } from '../../../production-workflow/native-kitchen-source.js';
import { finalizePopulationKitchen, requestNativeKitchen } from './native-kitchen.js';
import { populationNeedsBinding, populationNeedsOptions } from './needs-runtime.js';
import { validateSocietyFoodRequest, type SocietyFoodRequest } from '../../../sdk/society-food.js';
import type { ActionResult } from '../../../sdk/types.js';
import type { NeedsBinding } from '../../../needs/store.js';
import type { NativeFoodSkillCommand } from '../../../sdk/society-food.js';
import type { SkillRunResult } from '../../../agent-skills/types.js';
import { readNativeKitchenWip } from '../../../production-workflow/native-kitchen-wip.js';
import { ProductionWorkInProgressStore } from '../../../production-workflow/wip-store.js';
import { loadProductionWorkflowCatalog } from '../../../production-workflow/catalog.js';
import { readFoodSkillAttempts } from '../../engine/src/mods/NativeFoodSkillAttemptStore.js';

interface Intent { schemaVersion: 1; actionId: string; request: SocietyFoodRequest; binding: NeedsBinding; digest: string }
export interface NativeFoodSkillOptions {
    workspace: string; worldId: string; checkpointPath: string; businessPath: string;
    binding(username: string): NeedsBinding;
    dispatch(command: NativeFoodSkillCommand): Promise<unknown>;
    kitchen?: typeof requestNativeKitchen;
}
export function foodSkillActionId(request: SocietyFoodRequest): string {
    const hash = createHash('sha256').update(`${request.context.runId}:${request.context.stepId}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const pending = new Map<string, Promise<ActionResult>>();
/** Same explicit path precedence as the shared engine escrow/checkpoint authority, including a fresh food history. */
export function foodSkillCheckpointPath(workspace: string, worldId: string, environment: Record<string, string | undefined> = process.env): string {
    const path = resolve(workspace, 'server/engine', environment.PLAYER_CHECKPOINT_DATABASE ?? environment.GE_DATABASE ?? 'data/player-checkpoints.sqlite');
    assertNativeFoodPath({ workspace, worldId, checkpointPath: path });
    if (!existsSync(path)) throw new Error('Native food Player checkpoint authority is unavailable');
    const db = new OwnedDatabase(path, { readonly: true, strict: true });
    try { if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get())
        throw new Error('Native food source is not a Player checkpoint authority'); } finally { db.close(true); }
    return path;
}
/** Backend-owned admission precedes dispatch; process exit and posted receipts never create success. */
export async function executeFoodSkillRequest(options: NativeFoodSkillOptions, username: string, raw: SocietyFoodRequest): Promise<ActionResult> {
    const request = validateSocietyFoodRequest(raw), actionId = foodSkillActionId(request);
    assertNativeFoodPath(options);
    const directory = join(options.workspace, '.local/agent-skills/food-operations'), path = join(directory, `${actionId}.json`);
    assertNativeFoodDomainPath({ ...options, checkpointPath: path });
    // Serializes same-operation requests in this gateway; exclusive file creation handles other processes.
    const key = resolve(path), existing = pending.get(key);
    if (existing) { await existing; return executeFoodSkillRequest(options, username, request); }
    const task = execute(); pending.set(key, task);
    try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
    async function execute(): Promise<ActionResult> {
        const binding = options.binding(username);
        if (binding.worldId !== options.worldId || binding.playerId !== username) throw new Error('Food skill selected identity differs');
        const base = { schemaVersion: 1 as const, actionId, request, binding }, intent = { ...base, digest: foodDigest(base) };
        mkdirSync(directory, { recursive: true }); let fresh = false;
        try { writeFileSync(path, JSON.stringify(intent), { encoding: 'utf8', flag: 'wx' }); fresh = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const persisted = JSON.parse(readFileSync(path, 'utf8')) as Intent;
        if (foodDigest(persisted) !== foodDigest(intent)) throw new Error('Food skill run/parameters/actor binding differs');
        const data = { context: request.context, actionId, parametersDigest: request.context.parametersDigest };
        const uncertain = (): ActionResult => ({ success: false, message: 'Native outcome is uncertain; reconcile this same run before another action',
            reason: 'food-uncertain', phase: 'observation', data: { ...data, status: 'uncertain' } });
        const proof = (): ActionResult | null => {
            if (!existsSync(options.checkpointPath)) return null;
            const db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
            try {
                let result: FoodResult | FoodProductionReceipt | null = null;
                db.transaction(() => {
                    const table = request.operation === 'food-consume' ? 'native_food_schema' : 'native_food_production_schema';
                    if (!db.query('SELECT 1 FROM sqlite_master WHERE name=?1').get(table)) return;
                    if (request.operation === 'food-consume') { assertFoodSchema(db); result = readFoodResult(db, actionId); }
                    else { assertFoodProductionSchema(db); result = readFoodProductionReceipt(db, actionId); }
                }).deferred();
                if (!result) {
                    if (request.operation === 'food-gather' && db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_skill_schema'").get()) {
                        const attempt = readFoodSkillAttempts(db).find(row => row.actionId === actionId);
                        if (attempt) {
                            const stored = db.query('SELECT action_json FROM native_food_production_actions WHERE action_id=?1').get(actionId) as { action_json: string };
                            const action = JSON.parse(stored.action_json);
                            if (action.username !== binding.playerId || action.actorId !== binding.actorId || action.worldId !== binding.worldId
                                || action.lifecycleId !== binding.lifecycleId || action.clockId !== binding.clockId || action.clockProfileDigest !== binding.clockProfileDigest
                                || action.kind !== 'gather' || action.source.sourceId !== request.args.sourceId)
                                throw new Error('Food preparation source actor/lifecycle differs');
                        }
                        if (attempt?.phase === 'waiting') return { success: false, message: 'Native fishing preparation is waiting', reason: 'food-waiting',
                            phase: 'observation', data: { ...data, status: 'waiting', attempt } };
                        if (attempt?.phase === 'attempted') return { success: false, message: 'Native fishing attempt ended without an output', reason: 'food-no-output',
                            phase: 'completion', data: { ...data, status: 'terminal', receipt: attempt, receiptDigest: foodDigest(attempt) } };
                    }
                    return null;
                }
                const receipt = result as FoodResult | FoodProductionReceipt, action = receipt.action;
                if (action.actionId !== actionId || action.worldId !== binding.worldId || action.actorId !== binding.actorId
                    || action.username !== binding.playerId || action.lifecycleId !== binding.lifecycleId
                    || action.clockId !== binding.clockId || action.clockProfileDigest !== binding.clockProfileDigest
                    || (request.operation === 'food-consume' ? !('itemId' in action) || action.itemId !== 379 || action.slot !== request.args.slot
                        : !('kind' in action) || action.kind !== 'gather' || action.source.sourceId !== request.args.sourceId))
                    throw new Error('Food skill native receipt correlation differs');
                const success = receipt.outcome === 'consumed' || receipt.outcome === 'raw-gained';
                return { success, message: `Native food outcome: ${receipt.outcome}`, reason: `food-${receipt.outcome}`, phase: 'completion',
                    data: { ...data, status: 'terminal', receipt, receiptDigest: foodDigest(receipt) } };
            } finally { db.close(true); }
        };
        if (request.operation !== 'food-cook') {
            const prior = proof(); if (prior && prior.data?.status !== 'waiting') return prior;
            if (!fresh && prior?.data?.status !== 'waiting') return uncertain(); // Only an audited native preparation can resume.
            let dispatchError: string | null = null;
            try { await options.dispatch({ operation: request.operation === 'food-consume' ? 'consume' : 'gather',
                actionId, username, slot: request.operation === 'food-consume' ? Number(request.args.slot) : 0,
                sourceId: request.operation === 'food-gather' ? String(request.args.sourceId) : null }); }
            catch (error) { dispatchError = (error instanceof Error ? error.message : String(error)).slice(0, 300); }
            const canonical = proof();
            if (canonical) return canonical;
            const result = uncertain();
            // Diagnostic only: rejection/transport text never proves rollback or
            // allows another action. Keep the exact intent for reconciliation.
            return dispatchError ? { ...result, data: { ...result.data, dispatchError } } : result;
        }
        const reservations = new NativeKitchenReservationSource({ ...options, checkpointPath: options.businessPath });
        try {
            const kitchenRunId = String(request.args.kitchenRunId), kitchenBinding = reservations.read(kitchenRunId), kitchen = kitchenBinding.intent;
            if (kitchen.username !== username || kitchen.actorAgentId !== binding.actorId || kitchen.lifecycleId !== binding.lifecycleId
                || kitchen.worldId !== binding.worldId || kitchen.clockId !== binding.clockId || kitchen.clockProfileDigest !== binding.clockProfileDigest
                || kitchen.batchId !== request.args.batchId || kitchen.policy.heat.x !== request.args.heatX || kitchen.policy.heat.z !== request.args.heatZ)
                throw new Error('Food skill kitchen run/batch/worker/route differs');
            const work = new ProductionWorkInProgressStore(options.businessPath,
                loadProductionWorkflowCatalog(join(options.workspace, 'config/production-workflows.json')));
            try { work.bindNativeKitchenSkill(kitchenRunId, actionId, intent.digest); } finally { work.close(); }
            const current = () => {
                if (!existsSync(options.checkpointPath)) return null;
                const db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
                try { let row = null as NativeKitchenRecord | null;
                    db.transaction(() => { if (db.query("SELECT 1 FROM sqlite_master WHERE name='native_kitchen_schema'").get())
                        row = readNativeKitchen(db).find(entry => entry.binding.intent.runId === kitchenRunId) ?? null; }).deferred();
                    if (row && row.binding.digest !== kitchenBinding.digest) throw new Error('Food skill native kitchen binding differs');
                    return row;
                } finally { db.close(true); }
            };
            const dispatch = options.kitchen ?? requestNativeKitchen;
            let row = current();
            try {
                if (!row) { await dispatch({ operation: 'issue', runId: kitchenRunId }); row = current(); }
                if (row && ['issued', 'waiting'].includes(row.phase)) { await dispatch({ operation: 'process', runId: kitchenRunId }); row = current(); }
                if (row?.phase === 'processed') { await dispatch({ operation: 'return', runId: kitchenRunId }); row = current(); }
            } catch { row = current(); }
            if (row?.phase === 'returned-output') {
                const settled = finalizePopulationKitchen(options, kitchenRunId), receipt = row.receipt!;
                return { success: receipt.outcome === 'cooked' && settled.status === 'completed',
                    message: `Native kitchen outcome: ${receipt.outcome}`, reason: `food-${receipt.outcome}`, phase: 'completion',
                    data: { ...data, status: 'terminal', kitchenRunId, batchId: kitchen.batchId, receipt, receiptDigest: foodDigest(receipt), custody: receipt.custody } };
            }
            if (row && ['issued', 'waiting', 'processed'].includes(row.phase)) return { success: false, message: 'Native kitchen is waiting',
                reason: 'food-waiting', phase: 'observation', data: { ...data, status: 'waiting', kitchenRunId, batchId: kitchen.batchId } };
            return uncertain();
        } finally { reservations.close(); }
    }
}

async function dispatchLocalFood(command: NativeFoodSkillCommand): Promise<unknown> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim(); if (!token) throw new Error('Local native food engine channel is unavailable');
    const url = new URL('/api/internal/admin/native-food-skill', process.env.ENGINE_ADMIN_URL ?? 'http://localhost:8888');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Food skills require the local/private engine');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
        body: JSON.stringify({ commandId: randomUUID(), ...command }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || result.ok !== true) throw new Error(typeof result.error === 'string'
        ? result.error.slice(0, 300) : 'Native food engine dispatch failed');
    return result;
}

/** Read-only verifier capability. It never dispatches, migrates, settles or accepts a posted receipt as authority. */
export function verifyFoodSkillRunSources(workspace: string, run: SkillRunResult,
    selected?: { worldId: string; checkpointPath: string; businessPath: string }): boolean {
    const needs = populationNeedsOptions(workspace);
    let options = selected;
    if (!options) options = { worldId: needs.worldId, checkpointPath: foodSkillCheckpointPath(workspace, needs.worldId),
        businessPath: join(workspace, '.local/economy/businesses.sqlite') };
    assertNativeFoodPath({ workspace, ...options });
    const events = run.events.filter(event => event.type === 'step.succeeded' && event.operation?.startsWith('food-'));
    if (!events.length || !run.username || !run.parameters) return false;
    const parametersDigest = createHash('sha256').update(JSON.stringify(Object.entries(run.parameters)
        .sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
    const db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
    try {
        let verified = true;
        db.transaction(() => { for (const event of events) {
            const data = event.data, context = data?.context as SocietyFoodRequest['context'];
            if (!context || context.runId !== run.runId || context.stepId !== event.stepId || context.parametersDigest !== parametersDigest
                || foodDigest(context.skill) !== foodDigest(run.skill)) { verified = false; continue; }
            const actionId = foodSkillActionId({ context } as SocietyFoodRequest), path = join(workspace, '.local/agent-skills/food-operations', `${actionId}.json`);
            assertNativeFoodDomainPath({ workspace, ...options, checkpointPath: path });
            const intent = JSON.parse(readFileSync(path, 'utf8')) as Intent;
            const { digest, ...base } = intent;
            validateSocietyFoodRequest(intent.request);
            if (digest !== foodDigest(base) || intent.schemaVersion !== 1 || intent.actionId !== actionId || data!.actionId !== actionId
                || intent.request.operation !== event.operation || foodDigest(intent.request.context) !== foodDigest(context)
                || intent.binding.playerId !== run.username || intent.binding.worldId !== options!.worldId) { verified = false; continue; }
            let canonical: FoodResult | FoodProductionReceipt | null;
            if (event.operation === 'food-cook') {
                const row = readNativeKitchen(db).find(row => row.binding.intent.runId === intent.request.args.kitchenRunId);
                if (!row || row.phase !== 'returned-output' || row.receipt?.outcome !== 'cooked'
                    || row.binding.intent.batchId !== intent.request.args.batchId || row.binding.intent.username !== run.username) { verified = false; continue; }
                assertNativeFoodDomainPath({ workspace, ...options!, checkpointPath: options!.businessPath });
                const business = new OwnedDatabase(options!.businessPath, { readonly: true, strict: true });
                try { const work = readNativeKitchenWip(business).find(work => work.binding.digest === row.binding.digest);
                    if (work?.phase !== 'completed' || work.nativeDigest !== row.digest || work.skillInvocation?.id !== actionId
                        || work.skillInvocation.digest !== intent.digest) { verified = false; continue; }
                } finally { business.close(true); }
                canonical = row.receipt;
            } else if (event.operation === 'food-consume') {
                assertFoodSchema(db); canonical = readFoodResult(db, actionId);
                if (canonical?.outcome !== 'consumed' || canonical.action.slot !== intent.request.args.slot) { verified = false; continue; }
            } else {
                assertFoodProductionSchema(db); canonical = readFoodProductionReceipt(db, actionId);
                if (canonical?.outcome !== 'raw-gained' || canonical.action.source.sourceId !== intent.request.args.sourceId) { verified = false; continue; }
            }
            if (!canonical || foodDigest(canonical) !== foodDigest(data!.receipt) || foodDigest(canonical) !== data!.receiptDigest
                || canonical.action.worldId !== intent.binding.worldId || canonical.action.actorId !== intent.binding.actorId
                || canonical.action.lifecycleId !== intent.binding.lifecycleId || canonical.action.username !== run.username
                || canonical.action.clockId !== intent.binding.clockId || canonical.action.clockProfileDigest !== intent.binding.clockProfileDigest)
                verified = false;
        } }).deferred();
        return verified;
    } finally { db.close(true); }
}
/** Called only after the SDK session/controller gate, using its authenticated target username. */
export async function executeLocalFoodSkill(username: string, request: SocietyFoodRequest): Promise<ActionResult> {
    const workspace = resolve(import.meta.dir, '../../..'), needs = populationNeedsOptions(workspace);
    const checkpointPath = foodSkillCheckpointPath(workspace, needs.worldId);
    return executeFoodSkillRequest({ workspace, worldId: needs.worldId, checkpointPath,
        businessPath: join(workspace, '.local/economy/businesses.sqlite'), dispatch: dispatchLocalFood,
        binding: username => {
            const agents = new AgentStateStore(join(workspace, '.local/agent-state/agents.sqlite'), undefined, true);
            try {
                const members = agents.listPopulationMembers().filter(member => member.playerUsername === username);
                if (members.length !== 1 || members[0]!.status !== 'active' || members[0]!.characterLifecycle.status !== 'active')
                    throw new Error('Food skill requires one active population avatar');
                return populationNeedsBinding(needs.worldId, members[0]!);
            } finally { agents.close(); }
        } }, username, request);
}
