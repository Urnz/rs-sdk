import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../../agent-state/store.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { buildAdminDecisionContext } from './admin-decision-context.js';
import { BusinessManagerStore } from './business-manager.js';
import { EconomicContractStore } from './economic-contracts.js';
import { readEconomicObservation } from './economic-observer-source.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { DurableAgentReplanCoordinator } from './durable-replan-coordinator.js';
import { createGatewayAgentReplanCoordinator } from './replan-runtime.js';
import type { BotSupervisor } from './supervisor.js';
import type { GatewayBotSnapshot } from './types.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
const start = '2026-10-22T10:00:00.000Z', later = '2026-10-22T10:01:00.000Z';
const employmentId = '11111111-1111-4111-8111-111111111111';
function setup() {
    const root = mkdtempSync(join(tmpdir(), 'rs-observer-')); directories.push(root);
    const agentPath = join(root, 'agents.sqlite'), businessPath = join(root, 'businesses.sqlite'), inboxPath = join(root, 'inbox.sqlite');
    const agents = new AgentStateStore(agentPath);
    agents.createIdentity({ agentId: 'worker', playerUsername: 'worker', displayName: 'Worker', background: 'Miner', personalityTraits: ['patient'] }, start);
    agents.createIdentity({ agentId: 'owner', displayName: 'Owner', background: 'Business', personalityTraits: ['patient'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'forge', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 20, dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 100 } }, start);
    agents.createAutonomyEnrollment('worker', { status: 'desired', policyId: 'local', policyVersion: '1.0.0' }, start);
    agents.close();
    const businesses = new BusinessManagerStore(businessPath);
    businesses.create({ businessId: 'forge', name: 'Forge', summary: 'Workshop', ownerAgentId: 'owner' }, start);
    businesses.hire('forge', { workerAgentId: 'worker', role: 'worker', title: 'Miner', wageGp: 100 }, start, employmentId);
    businesses.close();
    const options = { agentPath, businessPath, workspace: root, now: start };
    const end = () => { const store = new BusinessManagerStore(businessPath);
        try { store.endEmployment('forge', employmentId, 1, later); } finally { store.close(); } };
    return { root, agentPath, businessPath, inboxPath, options, end };
}

describe('SI-B01 native domain → durable inbox → scoped context → decision', () => {
    test('legacy asset and operational context cannot re-label stale or future cash as fresh', () => {
        const value = setup(), store = new AgentStateStore(value.agentPath);
        try {
            const profile = store.getControlProfile('worker')!;
            expect(buildDecisionContext(store.getSnapshot('worker')!, { now: later, assets: {
                observedAt: later, actorLinks: [], money: { balanceGp: 987654, source: 'live', freshness: 'fresh', observedAt: start },
                properties: [], financialPosition: { receivablesGp: 0, liabilitiesGp: 0,
                    openCommitmentReceivablesGp: 0, openCommitmentLiabilitiesGp: 0 }, unavailableSources: []
            } })).toContain('Money: unknown (live, stale');
            const gateway = { username: 'worker', status: 'active', lastStateReceivedAt: Date.parse('2026-10-22T11:00:00.000Z'),
                state: { player: { worldX: 1, worldZ: 1, level: 0 }, inventory: [{ id: 995, count: 17 }],
                    equipment: [], skills: [], bank: { items: [] }, shop: { isOpen: false } } } as unknown as GatewayBotSnapshot;
            const input = { baseContext: '', profile, bot: null, gateway, business: null, governance: null,
                offers: [], contracts: [], latestRun: null, unavailableSources: [], generatedAt: later };
            expect(buildAdminDecisionContext(input).trustedContext).toContain('Coins: unknown');
            gateway.lastStateReceivedAt = Date.parse(later);
            expect(buildAdminDecisionContext(input).trustedContext).toContain('Coins: 17 gp');
        } finally { store.close(); }
    });
    test('pending contract resolution remains pending in the observer context', () => {
        const value = setup(), path = join(value.root, 'contracts.sqlite');
        const store = new EconomicContractStore(path);
        let contractId: string;
        try {
            const offer = store.create({ creatorAgentId: 'owner', counterpartyAgentId: 'worker', kind: 'service', title: 'Workshop access',
                summary: 'Known bilateral terms', creatorProvides: { gp: 0, items: [], service: 'Workshop access', skill: { id: 'forge.access', version: '1.0.0' } },
                counterpartyProvides: { gp: 0, items: [], service: 'Mine ore', skill: { id: 'mining.copper', version: '1.0.0' } },
                expiresAt: '2026-10-23T10:00:00.000Z' }, start);
            const contract = store.accept(offer.offerId, 'worker', offer.revision, start).contract;
            contractId = contract.contractId;
            store.startResolution(contractId, 'cancelled', contract.revision, 'Stop the service', later);
        } finally { store.close(); }
        expect(readEconomicObservation('worker', { ...value.options, now: later }).facts.find(f => f.key === `contract:${contractId}`))
            .toMatchObject({ value: 'cancelling', trust: 'native' });
    });
    test('real ended employment is delivered once across restart and source gaps', async () => {
        const value = setup();
        let inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(readEconomicObservation('worker', value.options))).toBeNull();
        inbox.close();
        value.end();
        inbox = new ReplanInboxStore(value.inboxPath);
        const source = readEconomicObservation('worker', { ...value.options, now: later });
        const record = inbox.observeEconomy(source)!;
        expect(record.event.type).toBe('significant-economic-change');
        expect(record.event.summary).toContain(`income:${employmentId}`);
        inbox.close();
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(readEconomicObservation('worker', { ...value.options,
            businessPath: join(value.root, 'missing-business.sqlite'), now: later }))).toBeNull();
        inbox.close();
        let calls = 0;
        const coordinator = new DurableAgentReplanCoordinator({ resolveAgentId: async () => 'worker', listAgentIds: async () => ['worker'],
            plan: async (agentId, event) => {
                calls++;
                const store = new AgentStateStore(value.agentPath);
                try {
                    const context = buildDecisionContext(store.getSnapshot(agentId)!, { now: later, maxCharacters: 6000,
                        economicObservation: readEconomicObservation(agentId, { ...value.options, now: later }) });
                    expect(context).toContain(`income:${employmentId}: "ended"`);
                    expect(context).toContain('hunger: unknown');
                    return { runId: event.eventId, status: 'blocked', reason: 'Income ended; source-backed alternatives required.' };
                } finally { store.close(); }
            }, append: () => undefined }, { path: value.inboxPath });
        expect((await coordinator.replayDue(later))[0]?.outcome?.status).toBe('blocked');
        expect(await coordinator.replayDue(later)).toEqual([]);
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, now: later }))).toBeNull();
        expect(inbox.listForAgent('worker')).toHaveLength(1);
        expect(calls).toBe(1);
        inbox.close();
    });

    test('cursor and admission roll back together on a write failure', () => {
        const value = setup();
        let inbox = new ReplanInboxStore(value.inboxPath);
        inbox.observeEconomy(readEconomicObservation('worker', value.options)); inbox.close(); value.end();
        const db = new Database(value.inboxPath);
        db.run(`CREATE TRIGGER fail_cursor BEFORE INSERT ON economic_observer_cursor BEGIN SELECT RAISE(ABORT,'injected cursor failure'); END`);
        db.close();
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(() => inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, now: later }))).toThrow('injected');
        expect(inbox.listForAgent('worker')).toHaveLength(0); inbox.close();
        const repair = new Database(value.inboxPath); repair.run('DROP TRIGGER fail_cursor'); repair.close();
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, now: later }))).not.toBeNull();
        inbox.close();
    });

    test('private peer inventory is never read; stale own cash stays unknown', () => {
        const value = setup();
        const snapshot = (username: string, cash: number, at: string) => ({ username, status: 'active', connected: true,
            connectedAt: Date.parse(at), lastStateReceivedAt: Date.parse(at), controllers: 0, observers: 0,
            state: { player: { name: username, isDead: false }, inventory: [{ id: 995, count: cash }] } }) as GatewayBotSnapshot;
        const gatewayBots = new Map([['worker', snapshot('worker', 17, start)], ['stranger', snapshot('stranger', 987654, later)]]);
        const observation = readEconomicObservation('worker', { ...value.options, gatewayBots, now: later });
        expect(observation.facts.find(f => f.key === 'own-liquid-inventory-gp')?.value).toBeNull();
        expect(JSON.stringify(observation)).not.toContain('987654');
        expect(JSON.stringify(readEconomicObservation('owner', { ...value.options, gatewayBots, now: later }))).not.toContain('987654');
        gatewayBots.set('worker', snapshot('worker', 17, later));
        expect(readEconomicObservation('worker', { ...value.options, gatewayBots, now: later }).facts
            .find(f => f.key === 'own-liquid-inventory-gp')).toMatchObject({ value: 17, trust: 'observed' });
        gatewayBots.set('worker', snapshot('stranger', 987654, later));
        const misrouted = readEconomicObservation('worker', { ...value.options, gatewayBots, now: later });
        expect(misrouted.facts.find(f => f.key === 'own-liquid-inventory-gp')?.value).toBeNull();
        expect(JSON.stringify(misrouted)).not.toContain('987654');
    });

    test('a burst of native conditions coalesces within the inbox payload limit and stays deduplicated', () => {
        const value = setup(), source = readEconomicObservation('worker', value.options);
        source.facts = Array.from({ length: 50 }, (_, index) => ({ key: `income:employment-${index}`,
            value: 'ended', source: 'native-employment-fixture', cursor: '1', observedAt: start,
            freshness: 'fresh' as const, trust: 'native' as const }));
        let inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(source)!.event.summary).toContain('50 condition(s)'); inbox.close();
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.observeEconomy(source)).toBeNull(); expect(inbox.listForAgent('worker')).toHaveLength(1); inbox.close();
    });

    test('business stock is visible only to the bound institution, never to its worker', () => {
        const value = setup();
        const store = new BusinessManagerStore(value.businessPath);
        store.creditGenesisInventory('opening-stock', 'forge', 379, 12, start); store.close();
        expect(readEconomicObservation('owner', value.options).facts.find(f => f.key === 'stock:379'))
            .toMatchObject({ value: 12, trust: 'native' });
        expect(readEconomicObservation('worker', value.options).facts.some(f => f.key === 'stock:379')).toBe(false);
    });

    test('additive v3 migration preserves pending inbox events; future schema fails closed', () => {
        const value = setup(); value.end();
        let inbox = new ReplanInboxStore(value.inboxPath);
        const event = inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, now: later }))!.event;
        inbox.close();
        const legacy = new Database(value.inboxPath);
        legacy.run('DROP TABLE economic_observer_cursor'); legacy.run('PRAGMA user_version = 3'); legacy.close();
        inbox = new ReplanInboxStore(value.inboxPath);
        expect(inbox.get(event.eventId)).toMatchObject({ status: 'pending', event }); inbox.close();
        const newer = new Database(value.inboxPath); newer.run('PRAGMA user_version = 5'); newer.close();
        expect(() => new ReplanInboxStore(value.inboxPath)).toThrow('newer than supported');
    });

    test('own native raw shortage wakes once; absent or foreign inventory never becomes zero stock', () => {
        const value = setup(), inbox = new ReplanInboxStore(value.inboxPath);
        const view = (raw: number, at: string, username = 'worker') => new Map([[username, { username, status: 'active', lastStateReceivedAt: Date.parse(at),
            state: { player: { name: username, isDead: false }, inventory: [{ id: 377, count: raw }] } } as GatewayBotSnapshot]]);
        try {
            expect(readEconomicObservation('worker', { ...value.options, gatewayBots: view(0, start) }).facts.some(f => f.key === 'stock:377')).toBe(false);
            const agent = new AgentStateStore(value.agentPath);
            try { agent.setSkillKnowledge('worker', { id: 'procedure.food.gather-lobster', version: '0.1.0' }, 'known', null, start); }
            finally { agent.close(); }
            expect(inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, gatewayBots: view(2, start) }))).toBeNull();
            const foreign = readEconomicObservation('worker', { ...value.options, now: later, gatewayBots: view(0, later, 'stranger') });
            expect(foreign.facts.find(f => f.key === 'stock:377')?.value).toBeNull();
            expect(inbox.observeEconomy(foreign)).toBeNull();
            const own = readEconomicObservation('worker', { ...value.options, now: later, gatewayBots: view(0, later) });
            expect(inbox.observeEconomy(own)?.event.summary).toContain('stock:377');
            expect(inbox.observeEconomy(own)).toBeNull();
        } finally { inbox.close(); }
    });

    test('economic event uses the gateway lease gate before any model request', async () => {
        const value = setup(); value.end();
        const inbox = new ReplanInboxStore(value.inboxPath);
        const record = inbox.observeEconomy(readEconomicObservation('worker', { ...value.options, now: later }))!;
        inbox.close();
        const coordinator = createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => undefined,
            { agentPath: value.agentPath });
        expect(await coordinator.submit(record.event, later)).toMatchObject({ outcome: {
            status: 'skipped', reason: 'Agent does not hold a live autonomy lease.' }, error: null });
    });
});
