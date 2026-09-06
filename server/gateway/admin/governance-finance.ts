import { GovernanceStore, type CreateFaction, type Faction,
    type GovernanceBudget } from './governance.js';
import { InstitutionTreasuryStore,
    type InstitutionTreasuryAccount } from './institution-treasury.js';

export interface FactionFinancialSnapshot {
    faction: Faction;
    treasury: InstitutionTreasuryAccount | null;
    activeBudget: GovernanceBudget | null;
}

export class GovernanceFinanceService {
    private readonly governance: GovernanceStore;
    private readonly treasury: InstitutionTreasuryStore;

    constructor(governancePath: string, treasuryPath: string) {
        this.governance = new GovernanceStore(governancePath);
        this.treasury = new InstitutionTreasuryStore(treasuryPath);
    }

    close(): void {
        this.governance.close();
        this.treasury.close();
    }

    registerFaction(input: CreateFaction, now = new Date().toISOString()): FactionFinancialSnapshot {
        const existing = this.governance.getFaction(input.factionId);
        let faction: Faction;
        if (existing) {
            const treasuryActorId = input.treasuryActorId?.trim().toLowerCase() ?? existing.factionId;
            if (existing.kind !== input.kind || existing.name !== input.name.trim().replace(/\s+/g, ' ')
                || existing.treasuryActorId !== treasuryActorId) {
                throw new Error('Faction id was reused with different content');
            }
            faction = existing;
        } else {
            faction = this.governance.createFaction(input, now);
        }
        this.treasury.ensure('faction', faction.treasuryActorId, now);
        return this.getSnapshot(faction.factionId);
    }

    ensureFactionTreasury(factionId: string,
        now = new Date().toISOString()): InstitutionTreasuryAccount {
        const faction = this.governance.getFaction(factionId);
        if (!faction) throw new Error('Faction does not exist');
        return this.treasury.ensure('faction', faction.treasuryActorId, now);
    }

    getSnapshot(factionId: string): FactionFinancialSnapshot {
        const faction = this.governance.getFaction(factionId);
        if (!faction) throw new Error('Faction does not exist');
        return { faction, treasury: this.treasury.get('faction', faction.treasuryActorId),
            activeBudget: this.governance.getActiveBudget(faction.factionId) };
    }

    activateBudget(budgetId: string, expectedRevision: number, approvedByAgentId: string,
        now = new Date().toISOString()): GovernanceBudget {
        const budget = this.governance.getBudget(budgetId);
        if (!budget) throw new Error('Budget does not exist');
        this.ensureFactionTreasury(budget.factionId, now);
        return this.governance.activateBudget(budgetId, expectedRevision, approvedByAgentId, now);
    }
}
