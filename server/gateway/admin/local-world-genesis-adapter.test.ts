import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog,
    businessGenesisInventoryDigest, WorldGenesisRunStore,
    type GenesisAssetAllocation } from '../../../world-genesis/index.js';
import { LocalLostCityWorldGenesisAdapter, type LocalGenesisDependencies } from './local-world-genesis-adapter.js';
import { previewAdminWorldGenesis, resetAdminWorldGenesis, startAdminWorldGenesis } from './world-genesis.js';
import { BusinessManagerStore } from './business-manager.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import type { AdminPropertyList } from './properties.js';
import type { OfflineSaveSummary } from './offline-editor.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function resultFromAssets(seed: string, assets: GenesisAssetAllocation[]) {
    const profile = loadWorldGenesisProfileCatalog(join(import.meta.dir, '..', '..', '..', 'config',
        'world-genesis-profiles.json')).profiles.find(item => item.profileId === 'frontier')!;
    const configuration = buildWorldGenesisConfiguration({ seed, profile,
        worldBuild: 'lostcity-local-v1', simulationClock: { clockId: 'world', profileDigest: 'e'.repeat(64),
            initialSimulationTime: '2001-01-01T00:00:00.000Z' } });
    return buildWorldGenesisResult(configuration, { assets }, '2026-09-14T10:00:00.000Z');
}

function result() {
    const assets: GenesisAssetAllocation[] = [
        { allocationId: 'alice-coins', kind: 'currency', owner: { kind: 'player', id: 'alice' }, amountGp: 500 },
        { allocationId: 'alice-food', kind: 'item', owner: { kind: 'player', id: 'alice' },
            container: 'inventory', itemId: 315, count: 2, slot: null },
        { allocationId: 'alice-house', kind: 'property', owner: { kind: 'player', id: 'alice' },
            propertyId: 'varrock.test-house' }
    ];
    return resultFromAssets('local-adapter', assets);
}

function institutionalResult() {
    const stock: GenesisAssetAllocation = { allocationId: 'forge-iron', kind: 'item',
        owner: { kind: 'business', id: 'varrock-forge' }, container: 'business-stock',
        itemId: 440, count: 12, slot: null };
    const assets: GenesisAssetAllocation[] = [stock, {
        allocationId: 'forge-business', kind: 'business', owner: { kind: 'player', id: 'alice' },
        businessId: 'varrock-forge', openingCapitalGp: 1000,
        openingInventoryDigest: businessGenesisInventoryDigest([stock], 'varrock-forge')
    }, { allocationId: 'forge-grant', kind: 'currency', owner: { kind: 'business', id: 'varrock-forge' },
        amountGp: 200 }, { allocationId: 'knights-treasury', kind: 'currency',
        owner: { kind: 'faction', id: 'white-knights' }, amountGp: 500 }, {
        allocationId: 'forge-property', kind: 'property', owner: { kind: 'business', id: 'varrock-forge' },
        propertyId: 'varrock.test-house'
    }];
    return resultFromAssets('local-institutions', assets);
}

function harness(editable = true) {
    let serial = 0;
    let player: OfflineSaveSummary = { savedAt: '2026-09-14T09:00:00.000Z', coins: 100,
        coinPlacement: 'bank', skills: [{ name: 'Mining', experience: 0 }], inventory: [], bank: [], equipment: [],
        position: { x: 3200, z: 3200, level: 0 } };
    const properties: AdminPropertyList = { enabled: true, pendingPurchases: [], properties: [{
        propertyId: 'varrock.test-house', displayName: 'Test house', description: 'House', type: 'house',
        location: { x: 3200, z: 3200, level: 0, region: 'Varrock' }, purchasePrice: 1000,
        state: { status: 'available', owner: null, acquiredAt: null,
            updatedAt: '2026-09-14T09:00:00.000Z', version: 1 }
    }] };
    const dependencies: LocalGenesisDependencies = {
        async inspectPlayer() { return { backups: [], readiness: { editable,
            code: editable ? 'ready' : 'player-online' }, state: player }; },
        async editPlayer(username, draft, commandId) {
            if (draft.expectedSavedAt !== player.savedAt) throw new Error('stale save');
            const before = player;
            player = { savedAt: `2026-09-14T09:00:0${++serial}.000Z`, coins: draft.coins,
                coinPlacement: draft.coinPlacement === 'preserve' ? player.coinPlacement : draft.coinPlacement,
                skills: draft.skills, inventory: draft.inventory, bank: draft.bank,
                equipment: draft.equipment ?? [], position: draft.position ?? player.position };
            return { ok: true, commandId, username, operation: 'edit' as const,
                backupId: `backup-${serial}`, before, after: player };
        },
        async listProperties() { return properties; },
        async assignProperty(request) {
            const property = properties.properties[0]!;
            if (property.state.version !== request.expectedVersion || property.state.status !== 'available') {
                throw new Error('property conflict');
            }
            property.state = { status: 'owned', owner: request.owner, acquiredAt: '2001-01-01T00:00:00.000Z',
                updatedAt: '2001-01-01T00:00:00.000Z', version: request.expectedVersion + 1 };
            return { ok: true as const, commandId: request.commandId, tick: 1,
                assignment: { allocationId: request.allocationId, propertyId: request.propertyId,
                    owner: request.owner, beforeVersion: request.expectedVersion,
                    version: request.expectedVersion + 1, createdAt: '2001-01-01T00:00:00.000Z' } };
        },
        async resetProperty(propertyId, expectedVersion, commandId) {
            const property = properties.properties[0]!;
            if (property.propertyId !== propertyId || property.state.version !== expectedVersion) throw new Error('stale property');
            property.state = { status: 'available', owner: null, acquiredAt: null,
                updatedAt: '2026-09-14T10:02:00.000Z', version: expectedVersion + 1 };
            return { ok: true as const, commandId, property, tick: 2 };
        },
        getBusiness(){return null},
        getBusinessInventory(){return[]},
        createBusiness(allocationId,input,now){return{allocationId,businessId:input.businessId,
            ownerAgentId:input.ownerAgentId,propertyId:input.propertyId??null,status:'active',createdAt:now,resetAt:null}},
        resetBusiness(allocationId,now){return{allocationId,businessId:'unused',ownerAgentId:'unused',propertyId:null,
            status:'reset',createdAt:now,resetAt:now}},
        creditBusinessItem(_allocationId,businessId,itemId,count,now){return{businessId,itemId,count,revision:1,updatedAt:now}},
        resetBusinessItem(){return null},
        getTreasury(){return null},
        creditTreasury(kind,id,allocationId,amountGp,now){return{allocationId,kind,actorId:id,amountGp,
            status:'active',createdAt:now,resetAt:null}},
        resetTreasury(allocationId,now){return{allocationId,kind:'business',actorId:'unused',amountGp:1,
            status:'reset',createdAt:now,resetAt:now}}
    };
    return { adapter: new LocalLostCityWorldGenesisAdapter(dependencies), dependencies,
        player: () => player, properties };
}

function paths() {
    const directory = mkdtempSync(join(tmpdir(), 'local-genesis-adapter-')); directories.push(directory);
    return { runDbPath: join(directory, 'runs.sqlite'), provenanceDbPath: join(directory, 'provenance.sqlite') };
}

function storedDependencies(local: ReturnType<typeof harness>, businessStore: BusinessManagerStore,
    treasuryStore: InstitutionTreasuryStore): LocalGenesisDependencies {
    return { ...local.dependencies,
        getBusiness: businessId => businessStore.get(businessId),
        getBusinessInventory: businessId => businessStore.listInventory(businessId),
        createBusiness: (allocationId, input, now) => businessStore.createGenesis(allocationId, input, now),
        resetBusiness: (allocationId, now) => businessStore.resetGenesisBusiness(allocationId, now),
        creditBusinessItem: (allocationId, businessId, itemId, count, now) =>
            businessStore.creditGenesisInventory(allocationId, businessId, itemId, count, now),
        resetBusinessItem: (allocationId, now) => businessStore.resetGenesisInventory(allocationId, now),
        getTreasury: (kind, id) => treasuryStore.get(kind, id),
        creditTreasury: (kind, id, allocationId, amountGp, now) =>
            treasuryStore.creditGenesis(kind, id, allocationId, amountGp, now),
        resetTreasury: (allocationId, now) => treasuryStore.resetGenesis(allocationId, now) };
}

describe('local LostCity world genesis adapter', () => {
    test('applies and restores offline player assets and property ownership through verified boundaries', async () => {
        const genesis = result(), local = harness(), location = paths();
        expect(await previewAdminWorldGenesis(genesis, local.adapter)).toMatchObject({ preview: { ok: true } });
        const applied = await startAdminWorldGenesis(genesis, genesis.resultDigest, local.adapter, location,
            '2026-09-14T10:01:00.000Z');
        expect(local.player()).toMatchObject({ coins: 600, inventory: [{ id: 315, count: 2 }] });
        expect(local.properties.properties[0]?.state).toMatchObject({ status: 'owned',
            owner: { kind: 'player', id: 'alice' } });
        await resetAdminWorldGenesis(genesis.resultId, applied.revision, genesis.resultDigest, local.adapter,
            location, '2026-09-14T10:02:00.000Z');
        expect(local.player()).toMatchObject({ coins: 100, inventory: [] });
        expect(local.properties.properties[0]?.state).toMatchObject({ status: 'available', owner: null });
    });

    test('fails preview and refuses preparation while a target player is online', async () => {
        const genesis = result(), local = harness(false);
        const preview = await previewAdminWorldGenesis(genesis, local.adapter);
        expect(preview.preview).toMatchObject({ ok: false });
        expect(preview.preview.checks.find(check => check.key === 'player:alice')).toMatchObject({ ok: false });
        await expect(local.adapter.prepare(genesis)).rejects.toThrow('preflight failed');
    });

    test('fails preview before journalling for missing business targets and treasury overflow', async () => {
        const missing = resultFromAssets('missing-business', [{ allocationId: 'missing-grant', kind: 'currency',
            owner: { kind: 'business', id: 'missing-shop' }, amountGp: 1 }]);
        const local = harness();
        expect((await previewAdminWorldGenesis(missing, local.adapter)).preview.checks
            .find(check => check.key === 'business-target:missing-shop')).toMatchObject({ ok: false });

        const overflow = resultFromAssets('treasury-overflow', [{ allocationId: 'knights-grant', kind: 'currency',
            owner: { kind: 'faction', id: 'white-knights' }, amountGp: 500 }]);
        const adapter = new LocalLostCityWorldGenesisAdapter({ ...local.dependencies,
            getTreasury: () => ({ kind: 'faction', id: 'white-knights', balanceGp: 2_147_483_600,
                reservedGp: 0, availableGp: 2_147_483_600, revision: 1, createdAt: '2001-01-01T00:00:00.000Z',
                updatedAt: '2001-01-01T00:00:00.000Z' }) });
        expect((await previewAdminWorldGenesis(overflow, adapter)).preview.checks
            .find(check => check.key === 'treasury-capacity')).toMatchObject({ ok: false });
    });

    test('creates and fully resets a business, opening stock and institutional treasuries', async () => {
        const genesis = institutionalResult(), local = harness(), location = paths();
        const businessStore = new BusinessManagerStore(join(dirname(location.runDbPath), 'business.sqlite'));
        const treasuryStore = new InstitutionTreasuryStore(join(dirname(location.runDbPath), 'treasury.sqlite'));
        try {
            const dependencies = storedDependencies(local, businessStore, treasuryStore);
            const adapter = new LocalLostCityWorldGenesisAdapter(dependencies);
            expect(await previewAdminWorldGenesis(genesis, adapter)).toMatchObject({ preview: { ok: true } });
            const applied = await startAdminWorldGenesis(genesis, genesis.resultDigest, adapter, location,
                '2026-09-14T10:01:00.000Z');
            expect(businessStore.get('varrock-forge')).toMatchObject({ ownerAgentId: 'alice',
                propertyId: 'varrock.test-house' });
            expect(businessStore.listInventory('varrock-forge')).toMatchObject([{ itemId: 440, count: 12 }]);
            expect(treasuryStore.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 1200, reservedGp: 0 });
            expect(treasuryStore.get('faction', 'white-knights')).toMatchObject({ balanceGp: 500, reservedGp: 0 });
            await resetAdminWorldGenesis(genesis.resultId, applied.revision, genesis.resultDigest, adapter,
                location, '2026-09-14T10:02:00.000Z');
            expect(businessStore.get('varrock-forge')).toBeNull();
            expect(treasuryStore.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 0, reservedGp: 0 });
            expect(treasuryStore.get('faction', 'white-knights')).toMatchObject({ balanceGp: 0, reservedGp: 0 });
            expect(local.properties.properties[0]?.state).toMatchObject({ status: 'available', owner: null });
        } finally {
            businessStore.close();
            treasuryStore.close();
        }
    });

    test('recovers a partial institutional apply when later allocations were never created', async () => {
        const genesis = institutionalResult(), local = harness(), location = paths();
        const businessStore = new BusinessManagerStore(join(dirname(location.runDbPath), 'business.sqlite'));
        const treasuryStore = new InstitutionTreasuryStore(join(dirname(location.runDbPath), 'treasury.sqlite'));
        try {
            const working = storedDependencies(local, businessStore, treasuryStore);
            const failing = new LocalLostCityWorldGenesisAdapter({ ...working,
                creditTreasury(kind, id, allocationId, amountGp, now) {
                    if (allocationId === 'knights-treasury') throw new Error('injected treasury failure');
                    return working.creditTreasury(kind, id, allocationId, amountGp, now);
                } });
            await expect(startAdminWorldGenesis(genesis, genesis.resultDigest, failing, location,
                '2026-09-14T10:01:00.000Z')).rejects.toThrow('requires reset');
            const runs = new WorldGenesisRunStore(location.runDbPath);
            const interrupted = runs.get(genesis.resultId)!;
            runs.close();
            expect(interrupted).toMatchObject({ status: 'rollback-required', revision: 2 });

            await resetAdminWorldGenesis(genesis.resultId, interrupted.revision, genesis.resultDigest,
                new LocalLostCityWorldGenesisAdapter(working), location, '2026-09-14T10:02:00.000Z');
            expect(businessStore.get('varrock-forge')).toBeNull();
            expect(treasuryStore.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 0 });
            expect(treasuryStore.get('faction', 'white-knights')).toBeNull();
        } finally {
            businessStore.close();
            treasuryStore.close();
        }
    });
});
