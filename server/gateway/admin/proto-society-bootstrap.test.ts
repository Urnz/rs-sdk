import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { BusinessManagerStore } from './business-manager.js';
import { FixtureBootstrapStore } from './fixture-bootstrap-store.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { applyProtoSocietyFixture, preflightProtoSocietyFixture,
    restoreProtoSocietyDatabases, restoreProtoSocietyEngineSaves,
    type FixtureBootstrapAdapters } from './proto-society-bootstrap.js';
import { fixtureDigest, validateProtoSocietyFixture, type ProtoSocietyFixture } from './proto-society-fixture.js';
import type { OfflineSaveSummary } from './offline-editor.js';

const roots: string[] = [];
const fixturePath = join(import.meta.dir, '../../..', 'config', 'fixtures', 'varrock-proto-v1.json');
const fixture = validateProtoSocietyFixture(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown);
const propertyList = { enabled: true, pendingPurchases: [], properties: [{
    propertyId: 'varrock.east-workshop', displayName: 'East workshop', description: 'Fixture workshop',
    type: 'workshop', location: { x: 3250, z: 3420, level: 0, region: 'Varrock' }, purchasePrice: 10_000,
    state: { status: 'available' as const, owner: null, acquiredAt: null,
        updatedAt: '2026-09-01T00:00:00.000Z', version: 1 }
}] };

afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function paths() {
    const root = mkdtempSync(join(tmpdir(), 'proto-fixture-')); roots.push(root);
    return { root, value: { agentPath: join(root, 'agents.sqlite'), businessPath: join(root, 'business.sqlite'),
        treasuryPath: join(root, 'treasury.sqlite'), ledgerPath: join(root, 'ledger.sqlite'),
        backupsDir: join(root, 'backups') } };
}

function initialSave(username: string): OfflineSaveSummary {
    return { savedAt: `2026-09-01T00:00:00.00${username.length}Z`, coins: 1, skills: [], inventory: [],
        equipment: [], bank: [], position: { x: 3200, z: 3200, level: 0 } };
}

function adapters(overrides: Partial<FixtureBootstrapAdapters> = {}) {
    const states = new Map(fixture.players.map(player => [player.username, initialSave(player.username)]));
    const edits: string[] = [], restores: string[] = [];
    const value: FixtureBootstrapAdapters = {
        inspectPlayer: async username => ({ editable: true, state: states.get(username) ?? null }),
        editPlayer: async (username, draft) => {
            edits.push(username);
            const after: OfflineSaveSummary = { coins: draft.coins,
                coinPlacement: draft.coinPlacement === 'inventory' ? 'inventory' : 'bank',
                skills: draft.skills.map(skill => ({ ...skill, name: skill.name.toUpperCase() })),
                inventory: draft.inventory.flatMap(item => item.id === 2349 && item.count > 1
                    ? Array.from({ length: item.count }, () => ({ id: item.id, count: 1 })) : [item]),
                equipment: draft.equipment ?? [], bank: draft.bank,
                position: draft.position ? { x: draft.position.x, z: draft.position.z, level: draft.position.level }
                    : states.get(username)!.position,
                savedAt: '2026-09-02T00:00:00.000Z' };
            states.set(username, after);
            return { backupId: `backup-${username}`, after };
        },
        restorePlayer: async (username) => {
            restores.push(username);
            const after = initialSave(username); states.set(username, after); return { after };
        },
        listProperties: async () => propertyList,
        listVerifiedSkills: async () => fixture.autonomousSkillAllowlist,
        ...overrides
    };
    return { value, states, edits, restores };
}

describe('proto-society fixture bootstrap', () => {
    test('preflight is a non-mutating exact preview and rejects unavailable verified skills', async () => {
        const location = paths(), engine = adapters({ listVerifiedSkills: async () => [] });
        const result = await preflightProtoSocietyFixture(fixture, engine.value, location.value);
        expect(result.ok).toBeFalse();
        expect(result.errors.some(error => error.includes('not shared and verified'))).toBeTrue();
        expect(result.changes).toContain('agent:vrcopper1');
        expect(result.warnings).toEqual([expect.stringContaining('not self-sustaining')]);
        expect(readdirSync(location.root)).toEqual([]);
    });

    test('applies exact saves and domain state idempotently with granular provenance', async () => {
        const location = paths(), engine = adapters();
        const first = await applyProtoSocietyFixture(fixture, engine.value, location.value,
            '2026-09-02T00:00:00.000Z');
        expect(first.application.status).toBe('completed');
        expect(engine.edits).toHaveLength(6);
        const second = await applyProtoSocietyFixture(fixture, engine.value, location.value,
            '2026-09-03T00:00:00.000Z');
        expect(second.application).toEqual(first.application);
        expect(engine.edits).toHaveLength(6);

        const agents = new AgentStateStore(location.value.agentPath);
        expect(agents.listIdentities()).toHaveLength(7);
        expect(agents.listGoals('vrcopper1')).toHaveLength(4);
        expect(agents.listEpisodes('vrcopper1')).toHaveLength(1);
        expect(agents.getAutonomyEnrollment('vrcopper1')?.status).toBe('desired');
        expect(agents.getControlProfile('vrcopper1')).toMatchObject({ decisionIntervalMs: 60_000,
            maxDecisionsPerDay: 96, dailyLlmBudgetMicros: 500_000, dailyOperationalBudgetGp: 200 });
        expect(agents.getGoalExecution('vrtrader1.run')).toMatchObject({ policy: 'recurring',
            cooldownMs: 600_000 });
        agents.close();
        const businesses = new BusinessManagerStore(location.value.businessPath);
        const business = businesses.get('varrock-forge')!;
        expect(business.employments).toHaveLength(2);
        expect(business.policyProposals.find(policy => policy.status === 'approved')?.maxRewardGp).toBe(1_000);
        businesses.close();
        const treasury = new InstitutionTreasuryStore(location.value.treasuryPath);
        expect(treasury.get('business', 'varrock-forge')?.balanceGp).toBe(10_000);
        treasury.close();
        const ledger = new FixtureBootstrapStore(location.value.ledgerPath);
        const keys = ledger.listProvenance(fixture.fixtureId).map(item => item.resourceKey);
        expect(keys).toContain('engine-save:VRCopper1:coins');
        expect(keys).toContain('engine-save:VRCopper1:equipment');
        expect(keys).toContain('property:varrock.east-workshop');
        expect(keys).toContain('treasury:business:varrock-forge');
        expect(ledger.listProvenance(fixture.fixtureId).every(item => item.baselineDigest === fixture.baselineDigest))
            .toBeTrue();
        ledger.close();
    });

    test('journals a partial apply and restores engine saves plus pre-apply SQLite state', async () => {
        const location = paths(), engine = adapters();
        const baseline = new AgentStateStore(location.value.agentPath);
        baseline.createIdentity({ agentId: 'sentinel', playerUsername: 'Sentinel', displayName: 'Sentinel',
            background: 'Pre-fixture state.', personalityTraits: ['stable'] });
        baseline.close();
        const invalid = structuredClone(fixture) as ProtoSocietyFixture;
        invalid.business.policy.approvalNote = '';
        await expect(applyProtoSocietyFixture(invalid, engine.value, location.value,
            '2026-09-02T00:00:00.000Z')).rejects.toThrow('partial and requires rollback');
        const journal = new FixtureBootstrapStore(location.value.ledgerPath);
        expect(journal.get(fixture.fixtureId)?.status).toBe('rollback-required'); journal.close();

        const engineResult = await restoreProtoSocietyEngineSaves(fixture.fixtureId, engine.value, location.value,
            '2026-09-02T01:00:00.000Z');
        expect(engineResult.rollbackPlan.engineRestored).toHaveLength(6);
        expect(engine.restores).toHaveLength(6);
        const finished = restoreProtoSocietyDatabases(fixture.fixtureId, true, location.value,
            '2026-09-02T02:00:00.000Z');
        expect(finished.status).toBe('rolled-back');
        const restored = new AgentStateStore(location.value.agentPath);
        expect(restored.listIdentities().map(identity => identity.agentId)).toEqual(['sentinel']);
        restored.close();

        const retried = await applyProtoSocietyFixture(fixture, engine.value, location.value,
            '2026-09-02T03:00:00.000Z');
        expect(retried.application.status).toBe('completed');
        const retryJournal = new FixtureBootstrapStore(location.value.ledgerPath);
        expect(retryJournal.listHistory(fixture.fixtureId)).toHaveLength(1);
        expect(retryJournal.listHistory(fixture.fixtureId)[0]).toMatchObject({ status: 'rolled-back' });
        retryJournal.close();
    });

    test('allows a new content digest only after the previous fixture application was fully rolled back', async () => {
        const location = paths(), engine = adapters();
        await applyProtoSocietyFixture(fixture, engine.value, location.value, '2026-09-02T00:00:00.000Z');
        await restoreProtoSocietyEngineSaves(fixture.fixtureId, engine.value, location.value,
            '2026-09-02T01:00:00.000Z');
        restoreProtoSocietyDatabases(fixture.fixtureId, true, location.value, '2026-09-02T02:00:00.000Z');
        const revised = structuredClone(fixture);
        revised.fixtureVersion = '1.1.1';
        revised.baselineDigest = fixtureDigest(revised);
        const applied = await applyProtoSocietyFixture(revised, engine.value, location.value,
            '2026-09-02T03:00:00.000Z');
        expect(applied.application).toMatchObject({ status: 'completed', baselineDigest: revised.baselineDigest });
        const ledger = new FixtureBootstrapStore(location.value.ledgerPath);
        expect(ledger.listHistory(fixture.fixtureId)).toEqual([
            expect.objectContaining({ status: 'rolled-back', baselineDigest: fixture.baselineDigest })
        ]);
        ledger.close();
    });
});
