import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore, buildDecisionContext, resolveAgentAssets } from '../index.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-assets-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('economic actor links', () => {
    test('creates and migrates the identity-owned player link with the agent', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        const identity = store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Asset test agent.', personalityTraits: ['careful'] }, '2026-08-29T10:00:00.000Z');
        expect(store.listEconomicActorLinks('ferrye14')).toEqual([expect.objectContaining({
            actorKind: 'player', actorId: 'ferrye14', role: 'self', source: 'identity'
        })]);
        store.updateIdentity('ferrye14', identity.revision, { playerUsername: 'Ferrye 15' },
            '2026-08-29T11:00:00.000Z');
        expect(store.listEconomicActorLinks('ferrye14')[0]).toMatchObject({ actorId: 'ferrye_15', revision: 2 });
        store.close();

        store = new AgentStateStore(path);
        expect(store.listEconomicActorLinks('ferrye14')[0]?.actorId).toBe('ferrye_15');
        store.close();
    });

    test('persists future business links and protects identity and stale writes', () => {
        const store = new AgentStateStore(databasePath());
        store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Asset test agent.', personalityTraits: ['careful'] });
        const link = store.setEconomicActorLink('ferrye14', null, {
            actorKind: 'business', actorId: 'Varrock Forge', role: 'owner'
        }, '2026-08-29T10:00:00.000Z');
        expect(link).toMatchObject({ actorId: 'varrock_forge', role: 'owner', source: 'admin', revision: 1 });
        const updated = store.setEconomicActorLink('ferrye14', link.revision, {
            actorKind: 'business', actorId: 'varrock_forge', role: 'manager'
        });
        expect(updated.revision).toBe(2);
        expect(() => store.setEconomicActorLink('ferrye14', link.revision, {
            actorKind: 'business', actorId: 'varrock_forge', role: 'member'
        })).toThrow('changed before update');
        expect(() => store.setEconomicActorLink('ferrye14', 1, {
            actorKind: 'player', actorId: 'ferrye14', role: 'owner'
        })).toThrow('identity economic actor link');
        store.close();
    });
});

describe('asset portfolio resolver', () => {
    test('links only owned economic actors and summarizes debts without copying source state', () => {
        const store = new AgentStateStore(databasePath());
        store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Asset test agent.', personalityTraits: ['careful'] });
        store.setEconomicActorLink('ferrye14', null, { actorKind: 'business', actorId: 'varrock-forge', role: 'owner' });
        store.setRelationship('ferrye14', null, { actorKey: 'horvik', displayName: 'Horvik',
            agentOwesGp: 32_000, actorOwesGp: 4_000 });
        store.createCommitment('ferrye14', { commitmentId: 'repay.horvik', actorKey: 'horvik',
            direction: 'owed-by-agent', description: 'Repay Horvik.', valueGp: 32_000 });
        const links = store.listEconomicActorLinks('ferrye14');
        const relationships = store.listRelationships('ferrye14');
        const commitments = store.listCommitments('ferrye14');
        const portfolio = resolveAgentAssets(links, relationships, commitments, {
            observedAt: '2026-08-29T12:00:00.000Z',
            money: [
                { actor: { kind: 'player', id: 'ferrye14' }, balanceGp: 68_000,
                    observedAt: '2026-08-29T11:59:59.000Z', source: 'live', freshness: 'fresh' },
                { actor: { kind: 'player', id: 'stranger' }, balanceGp: 999_999,
                    observedAt: '2026-08-29T12:00:00.000Z', source: 'live', freshness: 'fresh' }
            ],
            properties: [
                { propertyId: 'varrock.east-workshop', displayName: 'Varrock East Workshop', type: 'workshop',
                    region: 'Varrock', acquiredAt: '2026-08-28T12:00:00.000Z', stateVersion: 2,
                    owner: { kind: 'player', id: 'ferrye14' } },
                { propertyId: 'falador.castle', displayName: 'Falador Castle', type: 'castle', region: 'Falador',
                    acquiredAt: null, stateVersion: 1, owner: { kind: 'faction', id: 'white-knights' } }
            ]
        });
        expect(portfolio.money?.balanceGp).toBe(68_000);
        expect(portfolio.properties.map(item => item.propertyId)).toEqual(['varrock.east-workshop']);
        expect(portfolio.financialPosition).toEqual({ receivablesGp: 4_000, liabilitiesGp: 32_000,
            openCommitmentReceivablesGp: 0, openCommitmentLiabilitiesGp: 32_000 });
        const context = buildDecisionContext(store.getSnapshot('ferrye14')!, { assets: portfolio, maxCharacters: 1200 });
        expect(context).toContain('Current assets');
        expect(context).toContain('68000 gp');
        expect(context).toContain('varrock.east-workshop');
        expect(context).not.toContain('falador.castle');
        store.close();
    });
});
