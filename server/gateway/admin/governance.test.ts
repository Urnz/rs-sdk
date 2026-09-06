import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { GovernanceStore } from './governance.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-'));
    directories.push(directory);
    return join(directory, 'governance.sqlite');
}

function store(): GovernanceStore {
    return new GovernanceStore(databasePath());
}

function createVarrockHierarchy(governance: GovernanceStore): void {
    governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Kingdom of Misthalin' },
        '2026-09-06T08:00:00.000Z');
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'City of Varrock' },
        '2026-09-06T08:01:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'misthalin-realm', factionId: 'misthalin',
        kind: 'realm', name: 'Misthalin' }, '2026-09-06T08:02:00.000Z');
    governance.assignTerritory({ territoryId: 'misthalin-main', jurisdictionId: 'misthalin-realm',
        level: 0, minX: 3000, maxX: 3400, minZ: 3200, maxZ: 3600 }, '2026-09-06T08:03:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        parentJurisdictionId: 'misthalin-realm', kind: 'city', name: 'Varrock' },
    '2026-09-06T08:04:00.000Z');
}

describe('governance domain', () => {
    test('persists general factions and hierarchy nodes with treasury and property references', () => {
        const path = databasePath();
        const governance = new GovernanceStore(path);
        const manor = governance.createFaction({ factionId: 'draynor-manor', kind: 'manor',
            name: 'Draynor Manor', treasuryActorId: 'treasury.draynor' }, '2026-09-06T09:00:00.000Z');
        const scope = governance.createJurisdiction({ jurisdictionId: 'draynor-estate',
            factionId: manor.factionId, kind: 'manor', name: 'Draynor Estate',
            seatPropertyId: 'property.draynor-manor' }, '2026-09-06T09:01:00.000Z');
        expect(manor).toMatchObject({ kind: 'manor', treasuryActorId: 'treasury.draynor', revision: 1 });
        expect(scope).toMatchObject({ factionId: 'draynor-manor', depth: 0,
            seatPropertyId: 'property.draynor-manor', revision: 1 });
        governance.close();

        const reopened = new GovernanceStore(path);
        expect(reopened.getFaction('draynor-manor')).toEqual(manor);
        expect(reopened.getJurisdiction('draynor-estate')).toEqual(scope);
        reopened.close();
    });

    test('resolves nested jurisdictions deterministically from broadest to narrowest', () => {
        const governance = store();
        createVarrockHierarchy(governance);
        governance.assignTerritory({ territoryId: 'varrock-walls', jurisdictionId: 'varrock-city',
            level: 0, minX: 3170, maxX: 3290, minZ: 3370, maxZ: 3510 });
        governance.createFaction({ factionId: 'varrock-smiths', kind: 'guild', name: 'Varrock Smiths Guild' });
        governance.createJurisdiction({ jurisdictionId: 'smiths-quarter', factionId: 'varrock-smiths',
            parentJurisdictionId: 'varrock-city', kind: 'guild', name: 'Smiths Quarter' });
        governance.assignTerritory({ territoryId: 'smiths-yard', jurisdictionId: 'smiths-quarter',
            level: 0, minX: 3200, maxX: 3220, minZ: 3400, maxZ: 3420 });

        expect(governance.resolveAt(3210, 3410, 0).map(item => [item.jurisdictionId, item.faction.factionId]))
            .toEqual([
                ['misthalin-realm', 'misthalin'],
                ['varrock-city', 'varrock'],
                ['smiths-quarter', 'varrock-smiths']
            ]);
        expect(governance.resolveAt(3100, 3300, 0).map(item => item.jurisdictionId))
            .toEqual(['misthalin-realm']);
        expect(governance.resolveAt(3210, 3410, 1)).toEqual([]);
        governance.close();
    });

    test('requires child territory to be contained by its direct parent', () => {
        const governance = store();
        createVarrockHierarchy(governance);
        expect(() => governance.assignTerritory({ territoryId: 'varrock-outside',
            jurisdictionId: 'varrock-city', level: 0,
            minX: 2900, maxX: 3100, minZ: 3300, maxZ: 3400 }))
            .toThrow('contained by a direct parent');
        governance.close();
    });

    test('rejects ambiguous overlaps between unrelated jurisdictions', () => {
        const governance = store();
        governance.createFaction({ factionId: 'asgarnia', kind: 'kingdom', name: 'Kingdom of Asgarnia' });
        governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Kingdom of Misthalin' });
        governance.createJurisdiction({ jurisdictionId: 'asgarnia-realm', factionId: 'asgarnia',
            kind: 'realm', name: 'Asgarnia' });
        governance.createJurisdiction({ jurisdictionId: 'misthalin-realm', factionId: 'misthalin',
            kind: 'realm', name: 'Misthalin' });
        governance.assignTerritory({ territoryId: 'asgarnia-main', jurisdictionId: 'asgarnia-realm',
            level: 0, minX: 2800, maxX: 3100, minZ: 3200, maxZ: 3500 });
        expect(() => governance.assignTerritory({ territoryId: 'misthalin-main',
            jurisdictionId: 'misthalin-realm', level: 0,
            minX: 3000, maxX: 3400, minZ: 3200, maxZ: 3600 }))
            .toThrow('Unrelated jurisdictions');
        governance.close();
    });

    test('makes exact territory assignment replay-safe and rejects changed reuse', () => {
        const governance = store();
        createVarrockHierarchy(governance);
        const input = { territoryId: 'varrock-walls', jurisdictionId: 'varrock-city',
            level: 0, minX: 3170, maxX: 3290, minZ: 3370, maxZ: 3510 };
        const assigned = governance.assignTerritory(input, '2026-09-06T10:00:00.000Z');
        expect(governance.assignTerritory(input, '2026-09-06T11:00:00.000Z')).toEqual(assigned);
        expect(() => governance.assignTerritory({ ...input, maxX: 3291 }))
            .toThrow('reused with different bounds');
        governance.close();
    });

    test('validates ids, coordinate bounds and hierarchy depth inputs', () => {
        const governance = store();
        expect(() => governance.createFaction({ factionId: '!', kind: 'kingdom', name: 'Invalid' }))
            .toThrow('factionId is invalid');
        governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Misthalin' });
        expect(() => governance.createJurisdiction({ jurisdictionId: 'varrock', factionId: 'missing',
            kind: 'city', name: 'Varrock' })).toThrow('Faction does not exist');
        governance.createJurisdiction({ jurisdictionId: 'misthalin-realm', factionId: 'misthalin',
            kind: 'realm', name: 'Misthalin' });
        expect(() => governance.assignTerritory({ territoryId: 'invalid-level',
            jurisdictionId: 'misthalin-realm', level: 4,
            minX: 0, maxX: 1, minZ: 0, maxZ: 1 })).toThrow('level is invalid');
        governance.close();
    });

    test('versions budgets and atomically supersedes the active plan with an audit trail', () => {
        const governance = store();
        governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
        const first = governance.createBudget({ budgetId: 'varrock-2027-v1', factionId: 'varrock', version: 1,
            name: 'Varrock 2027 base', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 100_000,
            spendingLimitGp: 80_000, createdByAgentId: 'varrock-steward' }, '2026-09-06T12:00:00.000Z');
        expect(governance.createBudget({ budgetId: 'varrock-2027-v1', factionId: 'varrock', version: 1,
            name: 'Varrock 2027 base', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 100_000,
            spendingLimitGp: 80_000, createdByAgentId: 'varrock-steward' })).toEqual(first);
        expect(() => governance.createBudget({ budgetId: 'varrock-2027-v1', factionId: 'varrock', version: 1,
            name: 'Varrock 2027 base', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 100_000,
            spendingLimitGp: 80_000, createdByAgentId: 'another-agent' }))
            .toThrow('reused with different content');
        const active = governance.activateBudget(first.budgetId, first.revision, 'varrock-council',
            '2026-12-20T10:00:00.000Z');
        expect(governance.activateBudget(first.budgetId, first.revision, 'varrock-council')).toEqual(active);
        expect(() => governance.activateBudget(first.budgetId, first.revision, 'foreign-agent'))
            .toThrow('different approver');
        const second = governance.createBudget({ budgetId: 'varrock-2027-v2', factionId: 'varrock', version: 2,
            name: 'Varrock 2027 amended', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 120_000,
            spendingLimitGp: 90_000, createdByAgentId: 'varrock-steward' });

        expect(() => governance.activateBudget(second.budgetId, 2, 'varrock-council'))
            .toThrow('changed before activation');
        expect(governance.getActiveBudget('varrock')).toEqual(active);
        const replacement = governance.activateBudget(second.budgetId, second.revision, 'varrock-council',
            '2026-12-21T10:00:00.000Z');
        expect(replacement).toMatchObject({ version: 2, status: 'active', revision: 2 });
        expect(governance.getBudget(first.budgetId)).toMatchObject({ status: 'superseded', revision: 3 });
        expect(governance.listBudgets('varrock').map(item => item.version)).toEqual([2, 1]);
        expect(governance.listBudgetAudit('varrock').map(item => item.action))
            .toEqual(['created', 'activated', 'created', 'superseded', 'activated']);
        governance.close();
    });

    test('rejects skipped versions and invalid budget windows without writing audit', () => {
        const governance = store();
        governance.createFaction({ factionId: 'falador', kind: 'city', name: 'Falador' });
        const base = { budgetId: 'falador-2027-v2', factionId: 'falador', version: 2,
            name: 'Falador plan', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 50_000,
            spendingLimitGp: 40_000, createdByAgentId: 'falador-steward' };
        expect(() => governance.createBudget(base)).toThrow('must follow');
        expect(() => governance.createBudget({ ...base, version: 1,
            validUntil: base.validFrom })).toThrow('validity window');
        expect(governance.listBudgetAudit('falador')).toEqual([]);
        governance.close();
    });

    test('migrates a version one database in place and preserves faction identity', () => {
        const path = databasePath();
        const legacy = new Database(path, { create: true, strict: true });
        legacy.run(`CREATE TABLE governance_schema (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version >= 1))`);
        legacy.run('INSERT INTO governance_schema (singleton, version) VALUES (1, 1)');
        legacy.run(`CREATE TABLE governance_faction (
            faction_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
            treasury_actor_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        legacy.run(`INSERT INTO governance_faction VALUES
            ('misthalin', 'kingdom', 'Misthalin', 'misthalin', 1,
                '2026-09-06T08:00:00.000Z', '2026-09-06T08:00:00.000Z')`);
        legacy.close(true);

        const governance = new GovernanceStore(path);
        expect(governance.getFaction('misthalin')).toMatchObject({ factionId: 'misthalin', revision: 1 });
        expect(governance.createBudget({ budgetId: 'misthalin-2027-v1', factionId: 'misthalin', version: 1,
            name: 'Misthalin 2027', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 100_000,
            spendingLimitGp: 90_000, createdByAgentId: 'royal-steward' })).toMatchObject({ status: 'draft' });
        governance.close();
        const migrated = new Database(path, { strict: true });
        expect(migrated.query('SELECT version FROM governance_schema WHERE singleton = 1').get())
            .toEqual({ version: 4 });
        migrated.close(true);
    });
});
