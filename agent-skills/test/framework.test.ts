import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    AgentSkillBook,
    FileSkillStore,
    FileSkillRunJournal,
    RsSdkSkillRuntime,
    SkillExecutor,
    FileSkillVerificationJournal,
    SkillLibrary,
    SkillRegistry,
    SkillValidationError,
    inspectSkillRelationship,
    verifyAndPromoteSkill,
    validateSkillDefinition,
    type SkillDefinition,
    type SkillOperationName,
    type SkillOperationResult,
    type SkillRunResult,
    type SkillRuntime
} from '../index';

function successfulRun(definition: SkillDefinition, runId: string, username = 'agentbot'): SkillRunResult {
    const timestamp = '2026-08-27T12:00:00.000Z';
    return {
        runId, username, skill: { id: definition.id, version: definition.version },
        status: 'completed', reason: 'completed', message: 'Done', operations: 3, durationMs: 1_000,
        parameters: { 'bank-x': 3253, 'bank-z': 3420 },
        events: [{
            runId, type: 'skill.completed', timestamp,
            skill: { id: definition.id, version: definition.version }, message: 'Done'
        }]
    };
}

function skill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
    return {
        schemaVersion: 1,
        id: 'resource.copper-bank',
        version: '1.0.0',
        name: 'Copper to bank',
        description: 'Mines copper until full, then deposits it.',
        status: 'verified',
        tags: ['mining', 'banking'],
        parameters: {
            'bank-x': { type: 'number', description: 'Bank X coordinate', required: true, minimum: 1 },
            'bank-z': { type: 'number', description: 'Bank Z coordinate', default: 3420 }
        },
        provenance: { authorKind: 'human', authorId: 'project', createdAt: '2026-08-19T00:00:00.000Z' },
        sharing: { visibility: 'shared' },
        limits: { timeoutMs: 60_000, maxOperations: 20 },
        preconditions: [{ condition: 'inventory-contains', arguments: { name: 'pickaxe' } }],
        steps: [
            {
                kind: 'repeat', id: 'mine-until-full', maxIterations: 3,
                until: { condition: 'inventory-full', arguments: {} },
                steps: [{
                    kind: 'operation', id: 'mine', operation: 'interact-loc',
                    arguments: { name: 'rocks', option: 'mine' }, maxAttempts: 2
                }]
            },
            {
                kind: 'operation', id: 'walk-bank', operation: 'walk-to',
                arguments: { x: { parameter: 'bank-x' }, z: { parameter: 'bank-z' } }
            }
        ],
        ...overrides
    };
}

class FakeRuntime implements SkillRuntime {
    operations: Array<{ operation: SkillOperationName; args: Record<string, unknown> }> = [];
    mineAttempts = 0;
    inventoryFull = false;
    hasPickaxe = true;

    async execute(operation: SkillOperationName, args: Record<string, unknown>): Promise<SkillOperationResult> {
        this.operations.push({ operation, args });
        if (operation === 'interact-loc') {
            this.mineAttempts++;
            if (this.mineAttempts === 1) return { success: false, message: 'Rock moved', code: 'target-moved' };
            this.inventoryFull = true;
        }
        return { success: true, message: 'ok' };
    }

    async test(condition: string): Promise<boolean> {
        if (condition === 'inventory-contains') return this.hasPickaxe;
        if (condition === 'inventory-full') return this.inventoryFull;
        return false;
    }
}

describe('skill definition validation and registry', () => {
    test('accepts the bounded declarative schema and rejects arbitrary operations', () => {
        expect(validateSkillDefinition(skill()).id).toBe('resource.copper-bank');
        const invalid = structuredClone(skill()) as any;
        invalid.steps[1].operation = 'execute-code';
        expect(() => validateSkillDefinition(invalid)).toThrow(SkillValidationError);
        const extraArgument = structuredClone(skill()) as any;
        extraArgument.steps[1].arguments.shell = 'do-not-run';
        expect(() => validateSkillDefinition(extraArgument)).toThrow('is not allowed');
    });

    test('requires agent submissions to remain drafts until a trusted verifier promotes them', () => {
        const registry = new SkillRegistry();
        const generated = skill({
            status: 'verified',
            provenance: { authorKind: 'agent', authorId: 'fisher-1', createdAt: '2026-08-19T00:00:00.000Z' }
        });
        expect(() => registry.register(generated)).toThrow('draft status');
        generated.status = 'draft';
        expect(registry.register(generated).definition.status).toBe('draft');
    });

    test('keeps versions immutable and resolves the newest semantic version', () => {
        const registry = new SkillRegistry();
        registry.register(skill(), { trusted: true });
        registry.register(skill({ version: '1.2.0', description: 'Improved route.' }), { trusted: true });
        expect(registry.getLatest('resource.copper-bank')?.definition.version).toBe('1.2.0');
        expect(() => registry.register(skill({ description: 'Changed in place.' }), { trusted: true })).toThrow('publish a new version');
    });

    test('does not resolve private skills without the owning agent context', () => {
        const registry = new SkillRegistry();
        const privateSkill = skill({ sharing: { visibility: 'private', ownerAgentId: 'agent-a' } });
        registry.register(privateSkill, { trusted: true });
        expect(registry.get(privateSkill)).toBeNull();
        expect(registry.get(privateSkill, 'agent-b')).toBeNull();
        expect(registry.get(privateSkill, 'agent-a')).not.toBeNull();
    });
});

describe('skill execution', () => {
    test('checks preconditions, retries bounded operations, resolves inputs, and emits standard events', async () => {
        const runtime = new FakeRuntime();
        runtime.execute = async (operation, args) => {
            runtime.operations.push({ operation, args });
            if (operation === 'interact-loc') {
                runtime.mineAttempts++;
                if (runtime.mineAttempts === 1) return { success: false, message: 'Rock moved', code: 'target-moved', data: { inventoryDelta: [] } };
                runtime.inventoryFull = true;
            }
            return { success: true, message: 'ok', data: { inventoryDelta: [{ id: 436, name: 'Copper ore', delta: 1 }] } };
        };
        const runId = '11111111-1111-4111-8111-111111111111';
        const result = await new SkillExecutor(runtime).execute(skill(), {
            runId, parameters: { 'bank-x': 3253 }
        });
        expect(result.runId).toBe(runId);
        expect(result.status).toBe('completed');
        expect(result.operations).toBe(3);
        expect(runtime.operations.at(-1)).toEqual({ operation: 'walk-to', args: { x: 3253, z: 3420 } });
        expect(result.events.map(event => event.type)).toContain('step.failed');
        expect(result.events.find(event => event.type === 'step.succeeded')?.data).toBeDefined();
        expect(result.events.at(-1)?.type).toBe('skill.completed');
    });

    test('fails without running actions when a precondition is missing', async () => {
        const runtime = new FakeRuntime();
        runtime.hasPickaxe = false;
        const result = await new SkillExecutor(runtime).execute(skill(), { parameters: { 'bank-x': 3253 } });
        expect(result.status).toBe('failed');
        expect(result.reason).toBe('precondition-failed');
        expect(runtime.operations).toHaveLength(0);
    });

    test('requires explicit permission for draft execution', async () => {
        const runtime = new FakeRuntime();
        const draft = skill({ status: 'draft' });
        expect((await new SkillExecutor(runtime).execute(draft, { parameters: { 'bank-x': 3253 } })).reason).toBe('draft-not-allowed');
        expect((await new SkillExecutor(runtime).execute(draft, { parameters: { 'bank-x': 3253 }, allowDraft: true })).status).toBe('completed');
    });

    test('stops at the operation budget', async () => {
        const runtime = new FakeRuntime();
        runtime.execute = async (operation, args) => {
            runtime.operations.push({ operation, args });
            return { success: true, message: 'ok' };
        };
        const result = await new SkillExecutor(runtime).execute(skill({ limits: { timeoutMs: 60_000, maxOperations: 1 } }), { parameters: { 'bank-x': 3253 } });
        expect(result.status).toBe('limit-reached');
        expect(result.reason).toBe('operation-limit');
    });

    test('composes exact skill versions and forwards typed parameters', async () => {
        const runtime = new FakeRuntime();
        runtime.execute = async (operation, args) => {
            runtime.operations.push({ operation, args });
            return { success: true, message: 'ok' };
        };
        const bankProcedure = skill({
            id: 'procedure.bank.deposit',
            parameters: {
                x: { type: 'number', description: 'Bank X', required: true },
                z: { type: 'number', description: 'Bank Z', required: true },
                item: { type: 'string', description: 'Item name', required: true }
            },
            preconditions: [],
            steps: [
                { kind: 'operation', id: 'walk', operation: 'walk-to',
                    arguments: { x: { parameter: 'x' }, z: { parameter: 'z' } } },
                { kind: 'operation', id: 'open', operation: 'open-bank', arguments: {} },
                { kind: 'operation', id: 'deposit', operation: 'deposit-item',
                    arguments: { name: { parameter: 'item' }, amount: -1 } },
                { kind: 'operation', id: 'close', operation: 'close-bank', arguments: {} }
            ]
        });
        const composed = skill({
            preconditions: [],
            steps: [{ kind: 'call', id: 'bank-copper',
                skill: { id: bankProcedure.id, version: bankProcedure.version },
                arguments: { x: { parameter: 'bank-x' }, z: { parameter: 'bank-z' }, item: 'Copper ore' } }]
        });
        const result = await new SkillExecutor(runtime, reference =>
            reference.id === bankProcedure.id && reference.version === bankProcedure.version
                ? bankProcedure : null).execute(composed, { parameters: { 'bank-x': 3253 } });
        expect(result.status).toBe('completed');
        expect(result.operations).toBe(4);
        expect(runtime.operations[0]).toEqual({ operation: 'walk-to', args: { x: 3253, z: 3420 } });
        expect(runtime.operations[2]).toEqual({ operation: 'deposit-item', args: { name: 'Copper ore', amount: -1 } });
        expect(result.events.find(event => event.operation === 'deposit-item')?.stepId).toBe('bank-copper/deposit');
    });

    test('rejects missing procedures and composition cycles before any operation', async () => {
        const runtime = new FakeRuntime();
        const missing = skill({ preconditions: [], steps: [{ kind: 'call', id: 'missing',
            skill: { id: 'procedure.missing', version: '1.0.0' }, arguments: {} }] });
        const missingResult = await new SkillExecutor(runtime, () => null).execute(missing,
            { parameters: { 'bank-x': 3253 } });
        expect(missingResult.reason).toBe('procedure-not-found');

        const first = skill({ id: 'procedure.first', preconditions: [], steps: [{ kind: 'call', id: 'second',
            skill: { id: 'procedure.second', version: '1.0.0' }, arguments: { 'bank-x': 3253 } }] });
        const second = skill({ id: 'procedure.second', preconditions: [], steps: [{ kind: 'call', id: 'first',
            skill: { id: 'procedure.first', version: '1.0.0' }, arguments: { 'bank-x': 3253 } }] });
        const definitions = new Map([[`${first.id}@${first.version}`, first], [`${second.id}@${second.version}`, second]]);
        const cycleResult = await new SkillExecutor(runtime, reference =>
            definitions.get(`${reference.id}@${reference.version}`) ?? null).execute(first,
            { parameters: { 'bank-x': 3253 } });
        expect(cycleResult.reason).toBe('procedure-cycle');
        expect(runtime.operations).toHaveLength(0);
    });

    test('nested procedures cannot bypass the root operation budget', async () => {
        const runtime = new FakeRuntime();
        runtime.execute = async (operation, args) => {
            runtime.operations.push({ operation, args });
            return { success: true, message: 'ok' };
        };
        const child = skill({ id: 'procedure.three-waits', preconditions: [], steps: [
            { kind: 'operation', id: 'one', operation: 'wait-ticks', arguments: { ticks: 1 } },
            { kind: 'operation', id: 'two', operation: 'wait-ticks', arguments: { ticks: 1 } },
            { kind: 'operation', id: 'three', operation: 'wait-ticks', arguments: { ticks: 1 } }
        ] });
        const root = skill({ preconditions: [], limits: { timeoutMs: 60_000, maxOperations: 2 },
            steps: [{ kind: 'call', id: 'bounded', skill: { id: child.id, version: child.version },
                arguments: { 'bank-x': 3253 } }] });
        const result = await new SkillExecutor(runtime, () => child).execute(root,
            { parameters: { 'bank-x': 3253 } });
        expect(result.reason).toBe('operation-limit');
        expect(result.operations).toBe(2);
    });

    test('honours a signal that was already cancelled before execution', async () => {
        const runtime = new FakeRuntime();
        const controller = new AbortController();
        controller.abort('test-stop');
        const result = await new SkillExecutor(runtime).execute(skill(), {
            parameters: { 'bank-x': 3253 }, signal: controller.signal
        });
        expect(result.status).toBe('cancelled');
        expect(runtime.operations).toHaveLength(0);
    });
});

describe('rs-sdk skill runtime', () => {
    test('reports gathering success only after inventory or XP evidence', async () => {
        let inventory: Array<{ name: string; count: number }> = [];
        const bot = {
            interactLoc: async () => ({ success: true, message: 'interaction dispatched' })
        } as any;
        const sdk = {
            getInventory: () => inventory,
            getSkillXp: () => 0,
            waitForCondition: async (predicate: () => boolean) => {
                expect(predicate()).toBe(false);
                inventory = [{ name: 'Copper ore', count: 1 }];
                expect(predicate()).toBe(true);
            }
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('gather-loc', {
            name: 'rocks copper ore', match: 'exact', option: 'mine', item: 'copper ore', skill: 'Mining'
        }, new AbortController().signal);
        expect(result).toMatchObject({ success: true, code: 'gathered' });
    });

    test('returns a stable gather-timeout code when no progress is observed', async () => {
        const bot = { interactNpc: async () => ({ success: true, message: 'interaction dispatched' }) } as any;
        const sdk = {
            getInventory: () => [],
            getSkillXp: () => 0,
            waitForCondition: async () => { throw new Error('timeout'); }
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('gather-npc', {
            name: 'fishing spot', option: 'cage', item: 'lobster', skill: 'Fishing'
        }, new AbortController().signal);
        expect(result).toMatchObject({ success: false, code: 'gather-timeout' });
    });

    test('retargets a moving fishing spot until real inventory evidence appears', async () => {
        let inventory: Array<{ name: string; count: number }> = [];
        let interactions = 0;
        const bot = {
            interactNpc: async () => {
                interactions++;
                return { success: true, message: 'Cage animation started' };
            }
        } as any;
        const sdk = {
            getInventory: () => inventory,
            getSkillXp: () => 0,
            waitForCondition: async (predicate: () => boolean) => {
                if (interactions === 1) throw new Error('spot moved');
                inventory = [{ name: 'Raw lobster', count: 1 }];
                if (!predicate()) throw new Error('evidence missing');
            }
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('gather-npc', {
            name: 'Fishing spot', option: 'Cage', item: 'Raw lobster', skill: 'Fishing', timeoutMs: 60_000
        }, new AbortController().signal);
        expect(result).toMatchObject({ success: true, code: 'gathered', data: { interactions: 2 } });
    });

    test('selects a location by coordinates when duplicate names exist', async () => {
        let selected: { x: number; z: number } | null = null;
        const bot = {
            dismissBlockingUI: async () => undefined,
            interactLoc: async (loc: { x: number; z: number }) => {
                selected = loc;
                return { success: true, message: 'crossed' };
            }
        } as any;
        const sdk = {
            getNearbyLocs: () => [
                { name: 'Gangplank', x: 3047, z: 3205, optionsWithIndex: [{ text: 'Cross', opIndex: 1 }] },
                { name: 'Gangplank', x: 3030, z: 3217, optionsWithIndex: [{ text: 'Cross', opIndex: 1 }] }
            ]
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('interact-loc', {
            name: 'Gangplank', match: 'exact', option: 'Cross', x: 3030, z: 3217
        }, new AbortController().signal);
        expect(result.success).toBe(true);
        expect(selected).toMatchObject({ x: 3030, z: 3217 });
    });

    test('waits for a coordinate-selected location option to become ready', async () => {
        let ready = false;
        let selected: { x: number; z: number; optionsWithIndex: Array<{ text: string }> } | null = null;
        const bot = {
            dismissBlockingUI: async () => undefined,
            interactLoc: async (loc: typeof selected) => {
                selected = loc;
                return { success: true, message: 'climbed' };
            }
        } as any;
        const loc = () => ({
            name: "Ship's ladder",
            x: 2954,
            z: 3141,
            optionsWithIndex: ready ? [{ text: 'Climb-up', opIndex: 1 }] : []
        });
        const sdk = {
            getNearbyLocs: () => [loc()],
            waitForCondition: async (predicate: () => boolean) => {
                ready = true;
                if (!predicate()) throw new Error('option not ready');
            }
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('interact-loc', {
            name: "Ship's ladder", match: 'exact', option: 'Climb-up', x: 2954, z: 3141, timeoutMs: 5000
        }, new AbortController().signal);
        expect(result.success).toBe(true);
        expect((selected as { optionsWithIndex: Array<{ text: string; opIndex: number }> } | null)
            ?.optionsWithIndex).toEqual([{ text: 'Climb-up', opIndex: 1 }]);
    });

    test('navigates narration safely and verifies arrival in a destination area', async () => {
        let dialogStep = 0;
        const dialogs = [
            { isOpen: true, options: [{ index: 1, text: 'Click here to continue' }] },
            { isOpen: true, options: [{ index: 1, text: 'Yes please.' }, { index: 2, text: 'No, thank you.' }] },
            { isOpen: false, options: [] }
        ];
        const clicks: string[] = [];
        const bot = {
            talkTo: async () => ({ success: true, message: 'Dialog opened' })
        } as any;
        const sdk = {
            getState: () => ({ dialog: dialogs[dialogStep], player: { worldX: 2956, worldZ: 3143 } }),
            waitForCondition: async (predicate: (state: any) => boolean) => {
                const state = { dialog: dialogs[dialogStep], player: { worldX: 2956, worldZ: 3143 } };
                if (!predicate(state)) throw new Error('condition not met');
                return state;
            },
            sendClickDialog: async () => {
                clicks.push('continue');
                dialogStep++;
                return { success: true, message: 'continued' };
            },
            clickDialogByText: async (choice: string) => {
                clicks.push(choice);
                dialogStep++;
                return { success: true, message: 'selected' };
            },
            waitForTicks: async () => undefined
        } as any;
        const runtime = new RsSdkSkillRuntime(bot, sdk);
        expect(await runtime.execute('talk-to-npc', { name: 'Captain Tobias' }, new AbortController().signal))
            .toMatchObject({ success: true });
        expect(await runtime.execute('navigate-dialog', { choices: ['Yes please.'] }, new AbortController().signal))
            .toMatchObject({ success: true, code: 'dialog-completed' });
        expect(clicks).toEqual(['continue', 'Yes please.']);
        expect(await runtime.execute('wait-for-area', { x: 2956, z: 3143, tolerance: 2 }, new AbortController().signal))
            .toMatchObject({ success: true, code: 'area-reached' });
    });

    test('refuses dialog options that were not explicitly allowed', async () => {
        const bot = {} as any;
        const state = { dialog: { isOpen: true, options: [{ index: 1, text: 'Hand over every item' }] } };
        const sdk = {
            getState: () => state,
            waitForCondition: async () => state
        } as any;
        const result = await new RsSdkSkillRuntime(bot, sdk).execute('navigate-dialog', {
            choices: ['Yes please.']
        }, new AbortController().signal);
        expect(result).toMatchObject({ success: false, code: 'dialog-choice-not-allowed' });
    });

    test('adapts production, shop, and bounded gift-trade operations', async () => {
        const calls: Array<{ name: string; args: unknown[] }> = [];
        const record = (name: string) => async (...args: unknown[]) => {
            calls.push({ name, args });
            return { success: true, message: `${name} complete` };
        };
        const bot = {
            smithAtAnvil: record('smithAtAnvil'),
            openShop: record('openShop'),
            buyFromShop: record('buyFromShop'),
            sellToShop: record('sellToShop'),
            closeShop: record('closeShop'),
            trade: record('trade')
        } as any;
        const runtime = new RsSdkSkillRuntime(bot, { getInventory: () => [] } as any);
        const signal = new AbortController().signal;

        expect((await runtime.execute('smith-at-anvil', {
            product: 'bronze dagger', bar: 'Bronze bar', timeoutMs: 12_000
        }, signal)).success).toBe(true);
        expect((await runtime.execute('open-shop', { name: 'Shop keeper', match: 'exact' }, signal)).success).toBe(true);
        expect((await runtime.execute('buy-from-shop', { name: 'Hammer', match: 'exact', amount: 2 }, signal)).success).toBe(true);
        expect((await runtime.execute('sell-to-shop', { name: 'Bronze dagger', match: 'exact', amount: -1 }, signal)).success).toBe(true);
        expect((await runtime.execute('close-shop', {}, signal)).success).toBe(true);
        expect((await runtime.execute('trade-give-item', {
            player: 'receiver1', match: 'exact', item: 'Bronze dagger', itemMatch: 'exact', amount: 1
        }, signal)).success).toBe(true);

        expect(calls.map(call => call.name)).toEqual([
            'smithAtAnvil', 'openShop', 'buyFromShop', 'sellToShop', 'closeShop', 'trade'
        ]);
        const tradeOptions = calls.at(-1)?.args[1] as any;
        expect(tradeOptions.give).toHaveLength(1);
        expect(tradeOptions.want).toEqual([]);
        expect(tradeOptions.retryOnBusy).toBe(true);
    });
});

describe('sharing and persistence', () => {
    const temporaryRoots: string[] = [];
    afterEach(async () => {
        for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
    });

    test('lets shared-library agents discover verified shared skills while isolated agents cannot', () => {
        const registry = new SkillRegistry();
        registry.register(skill(), { trusted: true });
        const shared = new AgentSkillBook('agent-b', 'shared-library');
        const isolated = new AgentSkillBook('agent-b', 'isolated-discovery');
        expect(shared.discover(registry).map(entry => entry.definition.id)).toEqual(['resource.copper-bank']);
        expect(isolated.discover(registry)).toHaveLength(0);
    });

    test('prevents an agent from learning another author draft', () => {
        const registry = new SkillRegistry();
        const draft = skill({
            status: 'draft',
            provenance: { authorKind: 'agent', authorId: 'agent-a', createdAt: '2026-08-19T00:00:00.000Z' }
        });
        registry.register(draft);
        expect(() => new AgentSkillBook('agent-b').learn(draft, registry)).toThrow('only be learned by its author');
        expect(() => new AgentSkillBook('agent-a').learn(draft, registry)).not.toThrow();
    });

    test('persists shared and private agent drafts without leaking another agent private skill', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-skills-'));
        temporaryRoots.push(root);
        const store = new FileSkillStore(root);
        const sharedDraft = skill({
            status: 'draft',
            provenance: { authorKind: 'agent', authorId: 'agent-a', createdAt: '2026-08-19T00:00:00.000Z' }
        });
        const privateDraft = skill({
            id: 'resource.private-route', status: 'draft',
            provenance: { authorKind: 'agent', authorId: 'agent-a', createdAt: '2026-08-19T00:00:00.000Z' },
            sharing: { visibility: 'private', ownerAgentId: 'agent-a' }
        });
        const sharedPath = await store.save(sharedDraft, { actorKind: 'agent', actorId: 'agent-a' });
        await store.save(privateDraft, { actorKind: 'agent', actorId: 'agent-a' });
        await expect(store.save(sharedDraft, { actorKind: 'agent', actorId: 'agent-a' })).rejects.toThrow();
        expect(JSON.parse(await readFile(sharedPath, 'utf8')).id).toBe('resource.copper-bank');
        expect((await store.loadVisibleTo('agent-a')).map(entry => entry.id).sort()).toEqual(['resource.copper-bank', 'resource.private-route']);
        expect((await store.loadVisibleTo('agent-b')).map(entry => entry.id)).toEqual(['resource.copper-bank']);
    });

    test('loads the reviewed source-controlled catalog through the library boundary', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-skills-'));
        temporaryRoots.push(root);
        const registry = new SkillRegistry();
        const { SkillLibrary } = await import('../library');
        const library = new SkillLibrary(registry, new FileSkillStore(root));
        const loaded = await library.loadReviewedCatalog(join(import.meta.dir, '..', 'catalog'));
        expect(loaded.map(entry => `${entry.definition.id}@${entry.definition.version}`))
            .toContain('mining.varrock-east.copper-to-bank@0.1.0');
        expect(registry.getLatest('mining.varrock-east.copper-to-bank')?.definition)
            .toMatchObject({ version: '1.0.0', status: 'verified' });
    });

    test('writes immutable run journals', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-skill-runs-'));
        temporaryRoots.push(root);
        const result = await new SkillExecutor(new FakeRuntime()).execute(skill(), { parameters: { 'bank-x': 3253 } });
        const journal = new FileSkillRunJournal(root);
        const path = await journal.save(result);
        expect(JSON.parse(await readFile(path, 'utf8')).runId).toBe(result.runId);
        await expect(journal.save(result)).rejects.toThrow();
    });
});

describe('automatic skill verification and promotion', () => {
    const temporaryRoots: string[] = [];
    afterEach(async () => {
        for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
    });

    test('separates registry existence, access, learned knowledge, and executability', () => {
        const registry = new SkillRegistry();
        const shared = registry.register(skill(), { trusted: true });
        const privateDraft = skill({ id: 'resource.private-route', status: 'draft',
            provenance: { authorKind: 'agent', authorId: 'agent-a', createdAt: '2026-08-19T00:00:00.000Z' },
            sharing: { visibility: 'private', ownerAgentId: 'agent-a' } });
        registry.register(privateDraft);

        expect(inspectSkillRelationship(registry, 'agent-b', shared.definition)).toMatchObject({
            exists: true, access: { state: 'accessible' }, knowledge: 'unlearned', executable: false
        });
        expect(inspectSkillRelationship(registry, 'agent-b', shared.definition, 'known')).toMatchObject({
            knowledge: 'known', executable: true
        });
        expect(inspectSkillRelationship(registry, 'agent-b', shared.definition, 'blocked')).toMatchObject({
            knowledge: 'blocked', executable: false
        });
        expect(inspectSkillRelationship(registry, 'agent-b', privateDraft)).toMatchObject({
            exists: true, access: { state: 'denied' }, executable: false
        });
        expect(inspectSkillRelationship(registry, 'agent-b', { id: 'missing.skill', version: '1.0.0' }))
            .toMatchObject({ exists: false, access: { state: 'denied' }, knowledge: 'unlearned' });
    });

    const agentDraft = () => skill({
        version: '0.1.0', status: 'draft',
        provenance: { authorKind: 'agent', authorId: 'routebot', createdAt: '2026-08-27T10:00:00.000Z' },
        sharing: { visibility: 'shared' }
    });

    test('promotes an agent draft into a new system-authored immutable version after two matching live runs', async () => {
        const draft = agentDraft();
        const evidence = [
            successfulRun(draft, '11111111-1111-4111-8111-111111111111'),
            successfulRun(draft, '22222222-2222-4222-8222-222222222222')
        ];
        const report = verifyAndPromoteSkill(draft, evidence, {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 }, now: '2026-08-27T13:00:00.000Z'
        });

        expect(report.passed).toBe(true);
        expect(report.promoted).toMatchObject({
            version: '1.0.0', status: 'verified',
            provenance: {
                authorKind: 'system', authorId: 'deterministic-skill-verifier',
                derivedFrom: { id: draft.id, version: draft.version }
            }
        });
        expect(report.checks.every(check => check.passed)).toBe(true);

        const root = await mkdtemp(join(tmpdir(), 'agent-skills-promote-'));
        temporaryRoots.push(root);
        const library = new SkillLibrary(new SkillRegistry(), new FileSkillStore(root));
        await library.submitAgentSkill(draft, 'routebot');
        const outcome = await library.promoteAgentDraft(draft, evidence, {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 }, now: '2026-08-27T13:00:00.000Z'
        });
        expect(outcome.registered?.definition.status).toBe('verified');
        await expect(library.promoteAgentDraft(draft, evidence, {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 }
        })).rejects.toThrow();

        const reloaded = new SkillLibrary(new SkillRegistry(), new FileSkillStore(root));
        await reloaded.loadAgentDrafts('anotherbot');
        expect(reloaded.registry.getLatest(draft.id)?.definition).toMatchObject({ version: '1.0.0', status: 'verified' });
    });

    test('verifies the complete bounded graph of a composed draft', () => {
        const dependency = skill({ id: 'procedure.walk-bank', parameters: {
            x: { type: 'number', description: 'Destination X', required: true }
        }, preconditions: [], steps: [{ kind: 'operation', id: 'walk', operation: 'walk-to',
            arguments: { x: { parameter: 'x' }, z: 3420 }, maxAttempts: 2 }] });
        const draft = agentDraft();
        draft.preconditions = [];
        draft.steps = [{ kind: 'call', id: 'bank', skill: { id: dependency.id, version: dependency.version },
            arguments: { x: { parameter: 'bank-x' } } }];
        const evidence = [
            successfulRun(draft, '11111111-1111-4111-8111-111111111111'),
            successfulRun(draft, '22222222-2222-4222-8222-222222222222')
        ];
        const withoutResolver = verifyAndPromoteSkill(draft, evidence, {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 }
        });
        expect(withoutResolver.checks.find(check => check.id === 'composition-graph')?.passed).toBe(false);

        const report = verifyAndPromoteSkill(draft, evidence, {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 },
            resolveDefinition: reference => reference.id === dependency.id
                && reference.version === dependency.version ? dependency : null
        });
        expect(report.checks.find(check => check.id === 'composition-graph')?.passed).toBe(true);
        expect(report.checks.find(check => check.id === 'operation-budget')?.message).toContain('2 of 20');
        expect(report.passed).toBe(true);
    });

    test('refuses duplicate, failed, mismatched, or parameterless evidence without writing a promotion', () => {
        const draft = agentDraft();
        const first = successfulRun(draft, '11111111-1111-4111-8111-111111111111');
        const duplicate = structuredClone(first);
        const report = verifyAndPromoteSkill(draft, [first, duplicate], {
            targetVersion: '1.0.0', parameters: { 'bank-x': 3253 }
        });
        expect(report.passed).toBe(false);
        expect(report.promoted).toBeUndefined();
        expect(report.checks.find(check => check.id === 'independent-runs')?.passed).toBe(false);

        const mismatch = successfulRun(draft, '22222222-2222-4222-8222-222222222222');
        mismatch.parameters = undefined;
        mismatch.status = 'failed';
        const failed = verifyAndPromoteSkill(draft, [first, mismatch], {
            targetVersion: '0.1.1', parameters: { 'bank-x': 3253 }
        });
        expect(failed.passed).toBe(false);
        expect(failed.checks.find(check => check.id === 'successful-live-runs')?.passed).toBe(false);
        expect(failed.checks.find(check => check.id === 'matching-parameters')?.passed).toBe(false);
    });

    test('persists an immutable verification report even when promotion is refused', async () => {
        const draft = agentDraft();
        const report = verifyAndPromoteSkill(draft, [
            successfulRun(draft, '11111111-1111-4111-8111-111111111111')
        ], { targetVersion: '1.0.0', parameters: { 'bank-x': 3253 } });
        const root = await mkdtemp(join(tmpdir(), 'agent-skill-verifications-'));
        temporaryRoots.push(root);
        const journal = new FileSkillVerificationJournal(root);
        const path = await journal.save(report);
        expect(JSON.parse(await readFile(path, 'utf8')).passed).toBe(false);
        await expect(journal.save(report)).rejects.toThrow();
    });

    test('does not auto-publish human, private, same-version, or under-budget drafts', () => {
        const base = agentDraft();
        const evidence = [
            successfulRun(base, '11111111-1111-4111-8111-111111111111'),
            successfulRun(base, '22222222-2222-4222-8222-222222222222')
        ];
        const verify = (draft: SkillDefinition, targetVersion = '1.0.0') => verifyAndPromoteSkill(draft,
            evidence.map(run => ({ ...run, skill: { id: draft.id, version: draft.version } })),
            { targetVersion, parameters: { 'bank-x': 3253 } });

        const human = structuredClone(base);
        human.provenance = { authorKind: 'human', authorId: 'operator', createdAt: base.provenance.createdAt };
        expect(verify(human).checks.find(check => check.id === 'agent-draft')?.passed).toBe(false);

        const privateDraft = structuredClone(base);
        privateDraft.sharing = { visibility: 'private', ownerAgentId: 'routebot' };
        expect(verify(privateDraft).checks.find(check => check.id === 'shared-visibility')?.passed).toBe(false);
        expect(verify(base, base.version).checks.find(check => check.id === 'new-version')?.passed).toBe(false);

        const underBudget = structuredClone(base);
        underBudget.limits.maxOperations = 1;
        expect(verify(underBudget).checks.find(check => check.id === 'operation-budget')?.passed).toBe(false);
    });
});
