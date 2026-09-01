import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import { BusinessManagerStore } from './business-manager.js';
import { inspectBusinessForAgent, proposeBusinessPolicyForAgent } from './business-agent-port.js';
import { listAdminAgents } from './agent-state.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs-business-agent-port-'));
    directories.push(directory);
    const agentPath = join(directory, 'agents.sqlite');
    const businessPath = join(directory, 'businesses.sqlite');
    const agents = new AgentStateStore(agentPath);
    agents.createIdentity({ agentId: 'forge-mind', displayName: 'Forge Mind',
        background: 'Autonomous workshop manager.', personalityTraits: ['prudent'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'varrock_forge',
            decisionIntervalMs: 3_600_000, maxDecisionsPerDay: 12,
            dailyLlmBudgetMicros: 250_000, dailyOperationalBudgetGp: 5_000 } });
    agents.createIdentity({ agentId: 'outsider', playerUsername: 'Outsider', displayName: 'Outsider',
        background: 'Unaffiliated player.', personalityTraits: ['curious'] });
    agents.close();
    const businesses = new BusinessManagerStore(businessPath);
    businesses.create({ businessId: 'varrock_forge', name: 'Varrock Forge',
        summary: 'Copper workshop.', ownerAgentId: 'merchant-ada' });
    businesses.create({ businessId: 'other_business', name: 'Other Business',
        summary: 'Must stay isolated.', ownerAgentId: 'other-owner' });
    businesses.close();
    return { agentPath, businessPath };
}

describe('business institution agent port', () => {
    test('reads only the exact Business subject and writes an inert bounded proposal', () => {
        const paths = fixture();
        expect(inspectBusinessForAgent('forge-mind', paths.agentPath, paths.businessPath))
            .toMatchObject({ businessId: 'varrock_forge', activePolicy: null });
        const proposal = proposeBusinessPolicyForAgent('forge-mind', {
            proposalId: '77777777-7777-4777-8777-777777777777',
            objective: 'Pay for verified copper deliveries.', mode: 'balanced', maxRewardGp: 2_000,
            preferredSkills: [{ id: 'mining.varrock.copper', version: '1.0.0' }]
        }, paths.agentPath, paths.businessPath, '2026-09-01T15:00:00.000Z');
        expect(proposal).toMatchObject({ businessId: 'varrock_forge', proposerAgentId: 'forge-mind',
            status: 'pending', maxRewardGp: 2_000 });
        expect(inspectBusinessForAgent('forge-mind', paths.agentPath, paths.businessPath).activePolicy).toBeNull();
    });

    test('rejects player agents, foreign subjects and rewards above the operational budget', () => {
        const paths = fixture();
        expect(() => inspectBusinessForAgent('outsider', paths.agentPath, paths.businessPath))
            .toThrow('business institution agent');
        expect(() => proposeBusinessPolicyForAgent('forge-mind', {
            proposalId: '88888888-8888-4888-8888-888888888888', objective: 'Overspend.',
            mode: 'growth', maxRewardGp: 5_001
        }, paths.agentPath, paths.businessPath)).toThrow('operational budget');

        const agents = new AgentStateStore(paths.agentPath);
        const profile = agents.getControlProfile('forge-mind')!;
        agents.setControlProfile('forge-mind', profile.revision, { role: 'institution',
            subjectKind: 'business', subjectId: 'missing_business', avatarPlayerUsername: null,
            decisionIntervalMs: profile.decisionIntervalMs, maxDecisionsPerDay: profile.maxDecisionsPerDay,
            dailyLlmBudgetMicros: profile.dailyLlmBudgetMicros,
            dailyOperationalBudgetGp: profile.dailyOperationalBudgetGp });
        agents.close();
        expect(() => inspectBusinessForAgent('forge-mind', paths.agentPath, paths.businessPath))
            .toThrow('exact Business subject');
    });

    test('adds the exact business and active policy to the institution decision context', async () => {
        const paths = fixture();
        const proposal = proposeBusinessPolicyForAgent('forge-mind', {
            proposalId: '99999999-9999-4999-8999-999999999999', objective: 'Grow copper output safely.',
            mode: 'growth', maxRewardGp: 1_500
        }, paths.agentPath, paths.businessPath, '2026-09-01T16:00:00.000Z');
        const businesses = new BusinessManagerStore(paths.businessPath);
        businesses.resolvePolicy('varrock_forge', proposal.proposalId, proposal.revision,
            'approve', 'Approved for context test.', '2026-09-01T16:05:00.000Z');
        businesses.close();

        const agents = await listAdminAgents(paths.agentPath);
        const institution = agents.agents.find(item => item.identity.agentId === 'forge-mind');
        expect(institution?.business).toMatchObject({ businessId: 'varrock_forge',
            activePolicy: { mode: 'growth', maxRewardGp: 1_500 } });
        expect(institution?.decisionContext).toContain('Business: varrock_forge; active');
        expect(institution?.decisionContext).toContain('policy growth/1500 gp');
        expect(agents.agents.find(item => item.identity.agentId === 'outsider')?.business).toBeNull();
    });
});
