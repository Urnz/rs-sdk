import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
