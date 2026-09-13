import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { BusinessManagerStore } from './business-manager.js';
import { recoverDomainEventWakeups } from './domain-event-recovery.js';
import { EconomicContractStore } from './economic-contracts.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { GovernanceStore } from './governance.js';
import { selectWorldEvent } from './world-director.js';
import { WorldDirectorStore } from './world-director-runtime.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function setup(status: 'desired' | 'paused' = 'desired') {
    const root = mkdtempSync(join(tmpdir(), 'rs-domain-wakeup-')); directories.push(root);
    const paths = { agentPath: join(root, 'agents.sqlite'), businessPath: join(root, 'businesses.sqlite'),
        contractsPath: join(root, 'contracts.sqlite'), governancePath: join(root, 'governance.sqlite'),
        worldDirectorPath: join(root, 'world.sqlite') };
    const inboxPath = join(root, 'inbox.sqlite');
    const agents = new AgentStateStore(paths.agentPath);
    agents.createIdentity({ agentId: 'forge-mind', displayName: 'Forge Mind', background: 'Workshop manager.',
        personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'business',
            subjectId: 'varrock-forge', decisionIntervalMs: 60_000, maxDecisionsPerDay: 20,
            dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 10_000 } }, '2026-09-08T10:00:00.000Z');
    agents.createIdentity({ agentId: 'worker', playerUsername: 'Worker', displayName: 'Worker',
        background: 'Miner.', personalityTraits: ['reliable'] }, '2026-09-08T10:00:00.000Z');
    agents.setSkillKnowledge('worker', { id: 'mining.copper', version: '1.0.0' }, 'known', null,
        '2026-09-08T10:00:30.000Z');
    agents.setEconomicActorLink('worker', null, { actorKind: 'business', actorId: 'varrock-forge', role: 'member' },
        '2026-09-08T10:00:30.000Z');
    agents.createAutonomyEnrollment('worker', { status, policyId: 'private-local-default', policyVersion: '1.0.0' },
        '2026-09-08T10:01:00.000Z');
    agents.createPlayerActionRequest('forge-mind', { requestId: 'work-1', assigneeAgentId: 'worker',
        skill: { id: 'mining.copper', version: '1.0.0' }, objective: 'Mine copper for the forge.', rewardGp: 100 },
    '2026-09-08T10:05:00.000Z');
    agents.close();

    const businesses = new BusinessManagerStore(paths.businessPath);
    businesses.create({ businessId: 'varrock-forge', name: 'Varrock Forge', summary: 'A workshop.',
        ownerAgentId: 'forge-mind', propertyId: 'forge-property' }, '2026-09-08T10:02:00.000Z');
    businesses.hire('varrock-forge', { workerAgentId: 'worker', role: 'worker', title: 'Miner', wageGp: 100,
        requiredSkill: { id: 'mining.copper', version: '1.0.0' } }, '2026-09-08T10:03:00.000Z',
    '11111111-1111-4111-8111-111111111111');
    const policy = businesses.proposePolicy('varrock-forge', { proposalId: '22222222-2222-4222-8222-222222222222',
        proposerAgentId: 'forge-mind', objective: 'Acquire copper.', mode: 'growth', maxRewardGp: 500,
        preferredSkills: [{ id: 'mining.copper', version: '1.0.0' }] }, '2026-09-08T10:04:00.000Z');
    businesses.resolvePolicy('varrock-forge', policy.proposalId, policy.revision, 'approve', 'Approved.',
        '2026-09-08T10:04:30.000Z');
    businesses.close();

    const contracts = new EconomicContractStore(paths.contractsPath);
    const offer = contracts.create({ creatorAgentId: 'forge-mind', counterpartyAgentId: 'worker', kind: 'work',
        title: 'Copper work', summary: 'Exchange bounded services.',
        creatorProvides: { gp: 0, items: [], service: 'Provide forge access.',
            skill: { id: 'forge.access', version: '1.0.0' } },
        counterpartyProvides: { gp: 0, items: [], service: 'Mine copper.',
            skill: { id: 'mining.copper', version: '1.0.0' } }, expiresAt: '2027-09-08T10:00:00.000Z' },
    '2026-09-08T10:06:00.000Z', '33333333-3333-4333-8333-333333333333');
    contracts.accept(offer.offerId, 'worker', offer.revision, '2026-09-08T10:07:00.000Z',
        '44444444-4444-4444-8444-444444444444');
    contracts.close();
    return { paths, inboxPath };
}

describe('durable domain event wakeup recovery', () => {
    test('rebuilds relevant economic, player-action, business and property events exactly once', () => {
        const value = setup();
        const property = { propertyId: 'forge-property', displayName: 'Forge', description: 'Workshop', type: 'shop',
            location: { x: 1, z: 1, level: 0, region: 'varrock' }, purchasePrice: 1_000,
            state: { status: 'owned' as const, owner: { kind: 'business' as const, id: 'varrock-forge' },
                acquiredAt: '2026-09-08T10:08:00.000Z', updatedAt: '2026-09-08T10:08:00.000Z', version: 2 } };
        const first = recoverDomainEventWakeups(value.inboxPath, value.paths, [property]);
        expect(first.created).toBeGreaterThanOrEqual(6);
        expect(recoverDomainEventWakeups(value.inboxPath, value.paths, [property])).toEqual({
            scanned: first.scanned, created: 0, existing: first.scanned
        });
        const inbox = new ReplanInboxStore(value.inboxPath);
        const types = inbox.listForAgent('worker').map(item => item.event.type);
        expect(types).toContain('economic-contract-changed');
        expect(types).toContain('player-action-changed');
        expect(types).toContain('business-work-available');
        expect(types).toContain('property-changed');
        inbox.close();
    });

    test('does not wake paused enrollments', () => {
        const value = setup('paused');
        expect(recoverDomainEventWakeups(value.inboxPath, value.paths)).toEqual({ scanned: 0, created: 0, existing: 0 });
    });

    test('routes governance and allowlisted delivered world events only to relevant enrolled agents', () => {
        const root = mkdtempSync(join(tmpdir(), 'rs-governance-wakeup-')); directories.push(root);
        const paths = { agentPath: join(root, 'agents.sqlite'), businessPath: join(root, 'businesses.sqlite'),
            contractsPath: join(root, 'contracts.sqlite'), governancePath: join(root, 'governance.sqlite'),
            worldDirectorPath: join(root, 'world.sqlite') };
        const inboxPath = join(root, 'inbox.sqlite');
        const agents = new AgentStateStore(paths.agentPath);
        agents.createIdentity({ agentId: 'varrock-council', displayName: 'Council', background: 'Government.',
            personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'faction',
                subjectId: 'varrock', decisionIntervalMs: 60_000, maxDecisionsPerDay: 10,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 1_000 } }, '2026-09-08T10:00:00.000Z');
        agents.createAutonomyEnrollment('varrock-council', { status: 'desired', policyId: 'local',
            policyVersion: '1.0.0' }, '2026-09-08T10:01:00.000Z');
        agents.close();
        const governance = new GovernanceStore(paths.governancePath);
        governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' },
            '2026-09-08T10:02:00.000Z');
        governance.close();
        const world = new WorldDirectorStore(paths.worldDirectorPath);
        const queued = world.enqueue(selectWorldEvent('fixture-seed', 'cycle-1'), '2026-09-08T10:03:00.000Z');
        const claimed = world.claimNext('test-adapter', ['economic-signal', 'resource-signal', 'social-signal',
            'world-flavor'], 10_000, '2026-09-08T10:04:00.000Z')!;
        world.complete(queued.outbox.signal.eventId, claimed.leaseToken!, '2026-09-08T10:04:01.000Z');
        world.close();
        recoverDomainEventWakeups(inboxPath, paths);
        const inbox = new ReplanInboxStore(inboxPath);
        const types = inbox.listForAgent('varrock-council').map(item => item.event.type);
        expect(types).toContain('governance-changed');
        expect(types).toContain('allowlisted-world-event');
        inbox.close();
    });

});
