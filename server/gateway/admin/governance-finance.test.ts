import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceFinanceService } from './governance-finance.js';
import { GovernanceStore } from './governance.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function paths(): { governancePath: string; treasuryPath: string } {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-finance-'));
    directories.push(directory);
    return { governancePath: join(directory, 'governance.sqlite'),
        treasuryPath: join(directory, 'treasury.sqlite') };
}

describe('governance finance service', () => {
    test('registers a faction against exactly one shared institution treasury account', () => {
        const location = paths();
        const finance = new GovernanceFinanceService(location.governancePath, location.treasuryPath);
        const input = { factionId: 'white-knights', kind: 'guild' as const,
            name: 'White Knights', treasuryActorId: 'falador.white-knights' };
        const created = finance.registerFaction(input, '2026-09-06T12:00:00.000Z');
        expect(created).toMatchObject({ faction: { factionId: 'white-knights',
            treasuryActorId: 'falador.white-knights' }, treasury: { kind: 'faction',
            id: 'falador.white-knights', balanceGp: 0 }, activeBudget: null });
        expect(finance.registerFaction(input)).toEqual(created);
        finance.close();

        const treasury = new InstitutionTreasuryStore(location.treasuryPath);
        expect(treasury.list()).toHaveLength(1);
        expect(treasury.get('faction', 'falador.white-knights')).toMatchObject({ balanceGp: 0 });
        treasury.close();
    });

    test('repairs a missing zero-balance treasury link without rewriting governance state', () => {
        const location = paths();
        const governance = new GovernanceStore(location.governancePath);
        const faction = governance.createFaction({ factionId: 'misthalin', kind: 'kingdom', name: 'Misthalin' });
        governance.close();
        const finance = new GovernanceFinanceService(location.governancePath, location.treasuryPath);
        expect(finance.getSnapshot(faction.factionId).treasury).toBeNull();
        expect(finance.ensureFactionTreasury(faction.factionId)).toMatchObject({ kind: 'faction',
            id: 'misthalin', balanceGp: 0, revision: 1 });
        expect(finance.getSnapshot(faction.factionId).faction).toEqual(faction);
        finance.close();
    });

    test('activates a budget only after the shared treasury link exists', () => {
        const location = paths();
        const governance = new GovernanceStore(location.governancePath);
        governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
        const draft = governance.createBudget({ budgetId: 'varrock-2027-v1', factionId: 'varrock', version: 1,
            name: 'Varrock 2027', validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2028-01-01T00:00:00.000Z', revenueTargetGp: 100_000,
            spendingLimitGp: 80_000, createdByAgentId: 'varrock-steward' });
        governance.close();

        const finance = new GovernanceFinanceService(location.governancePath, location.treasuryPath);
        const active = finance.activateBudget(draft.budgetId, draft.revision, 'varrock-council',
            '2026-12-20T10:00:00.000Z');
        expect(active).toMatchObject({ status: 'active', revision: 2, spendingLimitGp: 80_000 });
        expect(finance.getSnapshot('varrock')).toMatchObject({ treasury: { kind: 'faction', id: 'varrock' },
            activeBudget: { budgetId: draft.budgetId, status: 'active' } });
        finance.close();
    });
});
