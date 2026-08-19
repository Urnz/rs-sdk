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
    SkillRegistry,
    SkillValidationError,
    validateSkillDefinition,
    type SkillDefinition,
    type SkillOperationName,
    type SkillOperationResult,
    type SkillRuntime
} from '../index';

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
        const result = await new SkillExecutor(runtime).execute(skill(), { parameters: { 'bank-x': 3253 } });
        expect(result.status).toBe('completed');
        expect(result.operations).toBe(3);
        expect(runtime.operations.at(-1)).toEqual({ operation: 'walk-to', args: { x: 3253, z: 3420 } });
        expect(result.events.map(event => event.type)).toContain('step.failed');
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
