import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { physicalExecutionAuthority } from '../../../agent-state/control.js';
import { GovernanceStore } from './governance.js';
import { GovernancePolicyStore } from './governance-policy.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { createAdminPlayerActionRequest } from './agent-state.js';
import { inspectGovernanceForAgent, proposeFactionPolicyForAgent,
    validateFactionPlayerActionForAgent } from './governance-agent-port.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-agent-port-'));
    directories.push(directory);
    const agentPath = join(directory, 'agents.sqlite');
    const governancePath = join(directory, 'governance.sqlite');
    const treasuryPath = join(directory, 'institution-treasury.sqlite');
    const agents = new AgentStateStore(agentPath);
    agents.createIdentity({ agentId: 'varrock-council', displayName: 'Varrock Council',
        background: 'Local government.', personalityTraits: ['prudent'],
        controlProfile: { role: 'institution', subjectKind: 'faction', subjectId: 'varrock',
            decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 8,
            dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 5_000 } });
    agents.createIdentity({ agentId: 'worker', playerUsername: 'Worker', displayName: 'Worker',
        background: 'Local contractor.', personalityTraits: ['reliable'] });
    agents.setSkillKnowledge('worker', { id: 'construction.varrock.repair', version: '1.0.0' },
        'known', null);
    agents.close();

    const governance = new GovernanceStore(governancePath);
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock',
        treasuryActorId: 'treasury.varrock' });
    governance.createFaction({ factionId: 'falador', kind: 'city', name: 'Falador' });
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        kind: 'city', name: 'Varrock City' });
    governance.createJurisdiction({ jurisdictionId: 'falador-city', factionId: 'falador',
        kind: 'city', name: 'Falador City' });
    const budget = governance.createBudget({ budgetId: 'varrock-1', factionId: 'varrock', version: 1,
        name: 'Works budget', validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2027-09-01T00:00:00.000Z', revenueTargetGp: 10_000,
        spendingLimitGp: 4_000, createdByAgentId: 'admin' });
    governance.activateBudget(budget.budgetId, budget.revision, 'admin');
    governance.close();

    const policies = new GovernancePolicyStore(governancePath);
    policies.create({ policyId: 'foreign-tax-1', jurisdictionId: 'falador-city', policyKey: 'market-tax',
        version: 1, kind: 'tax', trigger: 'business-revenue', name: 'Foreign tax',
        calculation: { mode: 'basis-points', rateBps: 100, minimumGp: 0, maximumGp: 500 },
        createdByAgentId: 'falador-agent' });
    policies.close();

    const treasury = new InstitutionTreasuryStore(treasuryPath);
    treasury.ensure('faction', 'treasury.varrock');
    treasury.setBalance('faction', 'treasury.varrock', 1, 20_000);
    treasury.close();
    return { agentPath, governancePath, treasuryPath };
}

describe('faction Governance agent port', () => {
    test('reads only the exact faction projection and creates only an inert draft', () => {
        const paths = fixture();
        const snapshot = inspectGovernanceForAgent('varrock-council', paths.agentPath,
            paths.governancePath, paths.treasuryPath);
        expect(snapshot).toMatchObject({ faction: { factionId: 'varrock', treasuryActorId: 'treasury.varrock' },
            treasury: { id: 'treasury.varrock', balanceGp: 20_000 },
            activeBudget: { budgetId: 'varrock-1' } });
        expect(snapshot.jurisdictions.map(item => item.jurisdiction.jurisdictionId)).toEqual(['varrock-city']);
        expect(snapshot.jurisdictions.flatMap(item => item.policies)).toEqual([]);

        const proposal = proposeFactionPolicyForAgent('varrock-council', {
            policyId: 'varrock-tax-1', jurisdictionId: 'varrock-city', policyKey: 'market-tax', version: 1,
            kind: 'tax', trigger: 'business-revenue', name: 'Market tax',
            calculation: { mode: 'basis-points', rateBps: 200, minimumGp: 0, maximumGp: 1_000 }
        }, paths.agentPath, paths.governancePath, '2026-09-06T12:00:00.000Z');
        expect(proposal).toMatchObject({ status: 'draft', jurisdictionId: 'varrock-city' });
        const policies = new GovernancePolicyStore(paths.governancePath);
        expect(policies.listActive('varrock-city')).toEqual([]);
        policies.close();
    });

    test('rejects foreign policy scope and outbound exposure above the operational budget', () => {
        const paths = fixture();
        expect(() => proposeFactionPolicyForAgent('varrock-council', {
            policyId: 'foreign-write-1', jurisdictionId: 'falador-city', policyKey: 'market-tax', version: 2,
            kind: 'tax', trigger: 'business-revenue', name: 'Foreign write',
            calculation: { mode: 'flat', amountGp: 10 }
        }, paths.agentPath, paths.governancePath)).toThrow('exact jurisdiction');
        expect(() => proposeFactionPolicyForAgent('varrock-council', {
            policyId: 'large-subsidy-1', jurisdictionId: 'varrock-city', policyKey: 'development', version: 1,
            kind: 'subsidy', trigger: 'property-development', name: 'Large subsidy',
            calculation: { mode: 'flat', amountGp: 5_001 }
        }, paths.agentPath, paths.governancePath)).toThrow('operational budget');
        expect(() => inspectGovernanceForAgent('worker', paths.agentPath, paths.governancePath, paths.treasuryPath))
            .toThrow('faction institution agent');
    });

    test('leaves physical work as a budgeted player request funded by the exact treasury actor', () => {
        const paths = fixture();
        const agents = new AgentStateStore(paths.agentPath);
        expect(physicalExecutionAuthority(agents.getControlProfile('varrock-council')!, 'Worker').allowed).toBe(false);
        agents.close();
        expect(validateFactionPlayerActionForAgent('varrock-council', { rewardGp: 4_000 },
            paths.agentPath, paths.governancePath)).toMatchObject({ faction: { factionId: 'varrock' },
            budget: { budgetId: 'varrock-1' } });
        expect(() => validateFactionPlayerActionForAgent('varrock-council', { rewardGp: 4_001 },
            paths.agentPath, paths.governancePath)).toThrow('budget limit');

        createAdminPlayerActionRequest('varrock-council', {
            requestId: '11111111-1111-4111-8111-111111111111', assigneeAgentId: 'worker',
            skill: { id: 'construction.varrock.repair', version: '1.0.0' },
            objective: 'Repair a verified city asset.', rewardGp: 1_500
        }, paths.agentPath);
        const treasury = new InstitutionTreasuryStore(paths.treasuryPath);
        try {
            expect(treasury.get('faction', 'treasury.varrock'))
                .toMatchObject({ reservedGp: 1_500, availableGp: 18_500 });
            expect(treasury.getReservation('11111111-1111-4111-8111-111111111111'))
                .toMatchObject({ actorId: 'treasury.varrock', amountGp: 1_500 });
        } finally { treasury.close(); }
    });
});
