import { dirname, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { listAgentDomainTools } from '../../../agent-state/control.js';
import type { AgentControlProfile, CreateAgentPlayerActionRequest } from '../../../agent-state/types.js';
import { agentStateDbPath, governanceDbPath, institutionTreasuryDbPath } from './paths.js';
import { GovernanceStore, type Faction, type GovernanceBudget, type Jurisdiction } from './governance.js';
import { GovernancePolicyStore, type CreateGovernancePolicy, type GovernancePolicy } from './governance-policy.js';
import { GovernanceObligationStore, type GovernanceObligation } from './governance-obligations.js';
import { InstitutionTreasuryStore, type InstitutionTreasuryAccount } from './institution-treasury.js';

export type ProposeFactionPolicyInput = Omit<CreateGovernancePolicy, 'createdByAgentId'>;

export interface GovernanceAgentSnapshot {
    faction: Faction;
    treasury: InstitutionTreasuryAccount | null;
    activeBudget: GovernanceBudget | null;
    jurisdictions: Array<{ jurisdiction: Jurisdiction; policies: GovernancePolicy[] }>;
    obligations: GovernanceObligation[];
}

export function governancePathFor(agentPath = agentStateDbPath): string {
    return agentPath === agentStateDbPath ? governanceDbPath : join(dirname(agentPath), 'governance.sqlite');
}

export function governanceTreasuryPathFor(agentPath = agentStateDbPath): string {
    return agentPath === agentStateDbPath ? institutionTreasuryDbPath
        : join(dirname(agentPath), 'institution-treasury.sqlite');
}

function factionAuthority(agentId: string, path: string): AgentControlProfile {
    const agents = new AgentStateStore(path);
    try {
        const profile = agents.getControlProfile(agentId);
        if (!profile || profile.role !== 'institution' || profile.subjectKind !== 'faction') {
            throw new Error('Only a faction institution agent may access the Governance port');
        }
        return profile;
    } finally { agents.close(); }
}

function exactFaction(profile: AgentControlProfile, path: string): Faction {
    const governance = new GovernanceStore(path);
    try {
        const faction = governance.getFaction(profile.subjectId);
        if (!faction) throw new Error('The exact Faction subject does not exist');
        if (faction.status !== 'active') throw new Error('Faction is disabled and read-only');
        return faction;
    } finally { governance.close(); }
}

export function factionTreasuryActorForAgent(agentId: string, agentPath = agentStateDbPath,
    governancePath = governancePathFor(agentPath)): string {
    return exactFaction(factionAuthority(agentId, agentPath), governancePath).treasuryActorId;
}

export function inspectGovernanceForAgent(agentId: string, agentPath = agentStateDbPath,
    governancePath = governancePathFor(agentPath), treasuryPath = governanceTreasuryPathFor(agentPath)):
    GovernanceAgentSnapshot {
    const profile = factionAuthority(agentId, agentPath);
    const tools = listAgentDomainTools(profile);
    if (!tools.includes('inspect-assets') || !tools.includes('inspect-budget')) {
        throw new Error('Agent is not allowed to inspect governance assets and budget');
    }
    const governance = new GovernanceStore(governancePath);
    const policies = new GovernancePolicyStore(governancePath);
    const obligations = new GovernanceObligationStore(governancePath);
    const treasury = new InstitutionTreasuryStore(treasuryPath);
    try {
        const faction = governance.getFaction(profile.subjectId);
        if (!faction) throw new Error('The exact Faction subject does not exist');
        const jurisdictions = governance.listJurisdictions(faction.factionId, 100)
            .map(jurisdiction => ({ jurisdiction,
                policies: policies.listForJurisdiction(jurisdiction.jurisdictionId, 100) }));
        return { faction, treasury: treasury.get('faction', faction.treasuryActorId),
            activeBudget: governance.getActiveBudget(faction.factionId), jurisdictions,
            obligations: obligations.listForActor({ kind: 'faction', id: faction.treasuryActorId }, 100) };
    } finally {
        treasury.close(); obligations.close(); policies.close(); governance.close();
    }
}

export function proposeFactionPolicyForAgent(agentId: string, input: ProposeFactionPolicyInput,
    agentPath = agentStateDbPath, governancePath = governancePathFor(agentPath),
    now = new Date().toISOString()): GovernancePolicy {
    const profile = factionAuthority(agentId, agentPath);
    if (!listAgentDomainTools(profile).includes('propose-faction-policy')) {
        throw new Error('Agent is not allowed to propose a faction policy');
    }
    const governance = new GovernanceStore(governancePath);
    const policies = new GovernancePolicyStore(governancePath);
    try {
        const faction = governance.getFaction(profile.subjectId);
        if (!faction) throw new Error('The exact Faction subject does not exist');
        const jurisdiction = governance.getJurisdiction(input.jurisdictionId);
        if (!jurisdiction || jurisdiction.factionId !== faction.factionId) {
            throw new Error('Faction agent may propose policy only for its exact jurisdiction');
        }
        const exposure = input.calculation.mode === 'flat'
            ? input.calculation.amountGp : input.calculation.maximumGp;
        if (input.kind === 'subsidy' && exposure > profile.dailyOperationalBudgetGp) {
            throw new Error('Faction subsidy proposal exceeds the institution agent operational budget');
        }
        return policies.create({ ...input, createdByAgentId: profile.agentId }, now);
    } finally { policies.close(); governance.close(); }
}

export function validateFactionPlayerActionForAgent(agentId: string,
    input: Pick<CreateAgentPlayerActionRequest, 'rewardGp'>, agentPath = agentStateDbPath,
    governancePath = governancePathFor(agentPath)) {
    const profile = factionAuthority(agentId, agentPath);
    if (!listAgentDomainTools(profile).includes('request-player-action')) {
        throw new Error('Agent is not allowed to request player work');
    }
    const governance = new GovernanceStore(governancePath);
    try {
        const faction = governance.getFaction(profile.subjectId);
        if (!faction) throw new Error('The exact Faction subject does not exist');
        if (faction.status !== 'active') throw new Error('Faction is disabled and read-only');
        const budget = governance.getActiveBudget(faction.factionId);
        if (!budget) throw new Error('Faction player work requires an approved active budget');
        const rewardGp = input.rewardGp ?? 0;
        if (!Number.isSafeInteger(rewardGp) || rewardGp < 0
            || rewardGp > profile.dailyOperationalBudgetGp || rewardGp > budget.spendingLimitGp) {
            throw new Error('Faction player work reward exceeds an approved budget limit');
        }
        return { faction, budget };
    } finally { governance.close(); }
}
