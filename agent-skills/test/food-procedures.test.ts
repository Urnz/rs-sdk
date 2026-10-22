import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillExecutor } from '../executor.js';
import { RsSdkSkillRuntime } from '../rs-sdk-runtime.js';
import { AgentSkillBook } from '../knowledge.js';
import { SkillRegistry } from '../registry.js';
import { validateSkillDefinition } from '../validation.js';
import { verifyAndPromoteSkill } from '../verifier.js';
import { foodTrialAuthorization, foodTrialParameters, matchesFoodTrialParameters } from '../food-trials.js';
import { FileSkillRunJournal } from '../journal.js';
import { validateSocietyFoodRequest, type SocietyFoodContext } from '../../sdk/society-food.js';
import { evaluateAuthorizationEnvelope } from '../../server/gateway/admin/authorization-envelope.js';
import { classifySkillFailure } from '../../server/gateway/admin/autonomous-skill-binding.js';

const load = (name: string) => validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir,
    `../catalog/procedure.food.${name}-lobster@0.1.0.skill.json`), 'utf8')));
const context: SocietyFoodContext = { runId: '12345678-1234-4123-a123-123456789abc', skill: { id: 'procedure.food.gather-lobster', version: '0.1.0' },
    stepId: 'gather', parametersDigest: 'a'.repeat(64) };
const args = { item: 'Raw lobster', itemId: 377, amount: 1, sourceId: 'musa-point-lobster', timeoutMs: 1000 };

describe('SI-A07 bounded food procedures', () => {
    test('corrected cooking draft admits only the two exact historical/native routes, never mixed or arbitrary coordinates', () => {
        const input = JSON.parse(readFileSync(join(import.meta.dir, '../catalog/procedure.food.cook-lobster@0.2.0.skill.json'), 'utf8'));
        expect(validateSkillDefinition(input).status).toBe('draft');
        const step = input.steps.find((s: any) => s.operation === 'food-cook');
        const args = { ...step.arguments, kitchenRunId: 'native-trial-1', batchId: 'kitchen:native-trial-1' };
        expect(validateSocietyFoodRequest({ operation: 'food-cook', args, context }).args.heatX).toBe(2814);
        for (const [x, z] of [[2814, 3180], [2926, 3161], [2815, 3161]]) {
            expect(() => validateSocietyFoodRequest({ operation: 'food-cook', args: { ...args, heatX: x, heatZ: z }, context })).toThrow();
            const bad = structuredClone(input); Object.assign(bad.steps[1].arguments, { heatX: x, heatZ: z });
            expect(() => validateSkillDefinition(bad)).toThrow();
        }
    });
    test('uses three shared bounded drafts and preserves the existing receiving, giving and travel procedures', () => {
        for (const name of ['gather', 'cook', 'consume']) {
            const draft = load(name);
            expect(draft.status).toBe('draft'); expect(draft.sharing.visibility).toBe('shared');
            expect(draft.limits.maxOperations).toBeLessThanOrEqual(2);
            expect(verifyAndPromoteSkill(draft, [], { targetVersion: '1.0.0' }).promoted).toBeUndefined();
        }
        for (const file of ['procedure.trade.receive-item@0.1.0', 'trade.lumbridge.give-item@1.0.0', 'procedure.travel-meet-return@0.1.0'])
            expect(validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir, `../catalog/${file}.skill.json`), 'utf8'))).id).toBeTruthy();
    });
    test('rejects wider items, routes, quantities, timeouts, retries and continue-on-failure', () => {
        for (const patch of [{ itemId: 995 }, { amount: 2 }, { timeoutMs: 60001 }, { sourceId: 'other' }, { receipt: {} }]) {
            expect(() => validateSocietyFoodRequest({ operation: 'food-gather', args: { ...args, ...patch }, context })).toThrow();
        }
        for (const patch of [{ maxAttempts: 2 }, { onFailure: 'continue' }]) {
            const draft = load('gather'); Object.assign(draft.steps[0]!, patch);
            expect(() => validateSkillDefinition(draft)).toThrow('one attempt');
        }
        const badRoute = load('cook'); (badRoute.steps[1] as any).arguments.heatX = 3200;
        expect(() => validateSkillDefinition(badRoute)).toThrow('exact lobster');
    });
    test('requires a verified exact version and explicit learning independently for all four actors', () => {
        const registry = new SkillRegistry(), draft = load('gather'); registry.register(draft);
        const verified = { ...draft, version: '1.0.0', status: 'verified', provenance: { ...draft.provenance, authorKind: 'system' } };
        registry.register(verified, { trusted: true });
        for (const actor of ['gatherer', 'cook', 'consumer', 'landlord']) {
            const book = new AgentSkillBook(actor);
            expect(book.inspect(verified, registry).executable).toBeFalse();
            book.learn(verified, registry); expect(book.inspect(verified, registry).executable).toBeTrue();
            expect(book.inspect(draft, registry).executable).toBeFalse();
        }
    });
    test('dispatch success without a correlated canonical outcome cannot complete a food step', async () => {
        const runtime = new RsSdkSkillRuntime({} as any, { sendSocietyFood: async () => ({ success: true, message: 'sent' }) } as any,
            foodTrialAuthorization(load('gather')));
        expect(await runtime.execute('food-gather', args, new AbortController().signal, context))
            .toMatchObject({ success: false, code: 'food-uncertain', retryable: false });
    });
    test('rechecks item and operation grants before every bounded waiting request', async () => {
        const authorization = foodTrialAuthorization(load('cook'))!, contextCook = { ...context, skill: { id: 'procedure.food.cook-lobster', version: '0.1.0' } };
        let calls = 0;
        const sdk = { sendSocietyFood: async () => { calls++; authorization.operations = []; return { success: false, message: 'waiting', data: { status: 'waiting' } }; } };
        const runtime = new RsSdkSkillRuntime({} as any, sdk as any, authorization);
        expect(await runtime.execute('food-cook', { item: 'Raw lobster', itemId: 377, amount: 1, kitchenRunId: 'cook-1',
            batchId: 'batch-1', heatX: 2926, heatZ: 3180, timeoutMs: 1000 }, new AbortController().signal, contextCook))
            .toMatchObject({ success: false, code: 'authorization-operation', retryable: false });
        expect(calls).toBe(1);
        const denied = new RsSdkSkillRuntime({} as any, sdk as any, { ...authorization, operations: ['food-gather'], itemNames: [] });
        expect(await denied.execute('food-gather', args, new AbortController().signal, context)).toMatchObject({ success: false, code: 'authorization-item' });
    });
    test('uncertain operation cannot be retried or continued into a false completed run', async () => {
        const draft = load('gather'); draft.steps = [{ kind: 'operation', id: 'uncertain', operation: 'interact-npc',
            arguments: { name: 'Fishing spot' }, maxAttempts: 2, onFailure: 'continue' }];
        let calls = 0;
        const run = await new SkillExecutor({ test: async () => true, execute: async () => {
            calls++; return { success: false, message: 'uncertain', code: 'food-uncertain', retryable: false };
        } }).execute(draft, { allowDraft: true });
        expect(run.status).toBe('failed'); expect(calls).toBe(1); expect(run.events.some(event => event.type === 'skill.completed')).toBeFalse();
    });
    test('envelope requires explicit food operations, exact items and a one-unit grant', () => {
        const draft = load('gather'), authorization = { id: draft.id, version: draft.version, risk: 'routine' as const,
            operations: ['food-gather' as const], itemNames: ['raw lobster'], maxQuantity: 1 };
        expect(evaluateAuthorizationEnvelope(authorization, draft, {}).allowed).toBeTrue();
        expect(evaluateAuthorizationEnvelope({ ...authorization, itemNames: [] }, draft, {}).allowed).toBeFalse();
        expect(evaluateAuthorizationEnvelope({ ...authorization, operations: [] }, draft, {}).allowed).toBeFalse();
        expect(evaluateAuthorizationEnvelope({ ...authorization, maxQuantity: 0 }, draft, {}).allowed).toBeFalse();
    });
    test('independent cooking trials may change only exact source-verified invocation bindings', () => {
        const draft = load('cook'), initial = { 'kitchen-run': 'run-a', 'batch-id': 'batch-a' };
        expect(foodTrialParameters(draft, initial, { 'kitchen-run': 'run-b', 'batch-id': 'batch-b' }))
            .toEqual({ 'kitchen-run': 'run-b', 'batch-id': 'batch-b' });
        expect(() => foodTrialParameters(draft, initial, { 'heat-x': 123 })).toThrow('Only exact native');
        expect(matchesFoodTrialParameters(draft, { 'kitchen-run': 'run-b', 'batch-id': 'batch-b' }, initial)).toBeTrue();
        expect(matchesFoodTrialParameters(draft, { 'kitchen-run': 'run-b', 'batch-id': 'batch-b', extra: 1 }, initial)).toBeFalse();
        const invalid = load('gather'); invalid.parameters['kitchen-run'] = draft.parameters['kitchen-run']!;
        expect(() => validateSkillDefinition(invalid)).toThrow('requires an exact food-cook');
    });
    test('uncertain food and delivery outcomes require reconciliation before another autonomous run', () => {
        expect(classifySkillFailure('food-uncertain', 'dispatch timeout')).toBe('authorization');
        expect(classifySkillFailure('trade-uncertain', 'possibly delivered')).toBe('authorization');
        expect(classifySkillFailure('food-burnt', 'burnt output')).toBe('acquire-input');
    });
    test('partial receiving uses the existing trade adapter and cannot become delivery success or a blind retry', async () => {
        let trades = 0;
        const runtime = new RsSdkSkillRuntime({ trade: async () => { trades++; return { success: true, message: 'part dropped',
            gave: [], received: [], possiblyDropped: [{ id: 379, name: 'Lobster', count: 1 }] }; } } as any,
        { getInventory: () => [] } as any, { operations: ['trade-receive-item'], itemNames: ['lobster'], partners: ['cook'],
            maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0 });
        const result = await runtime.execute('trade-receive-item', { player: 'cook', match: 'exact', item: 'Lobster',
            itemMatch: 'exact', amount: 1 }, new AbortController().signal);
        expect(result).toMatchObject({ success: false, code: 'trade-uncertain', retryable: false }); expect(trades).toBe(1);
        expect(await runtime.execute('trade-receive-item', { player: 'other', item: 'Lobster', amount: 1 }, new AbortController().signal))
            .toMatchObject({ success: false, code: 'authorization-partner' }); expect(trades).toBe(1);
    });
    test('durable run admission survives interruption without inventing a completed result', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'food-run-admission-'));
        try {
            const journal = new FileSkillRunJournal(directory), admission = { runId: context.runId, username: 'worker', skill: context.skill,
                checksum: 'c'.repeat(64), parameters: {}, parametersDigest: context.parametersDigest };
            expect(await journal.start(admission)).toBeTrue();
            expect(await new FileSkillRunJournal(directory).start(admission)).toBeFalse();
            expect(await journal.load(context.runId)).toBeNull();
            await expect(journal.start({ ...admission, parameters: { slot: 1 } })).rejects.toThrow('parameters/version differ');
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});
