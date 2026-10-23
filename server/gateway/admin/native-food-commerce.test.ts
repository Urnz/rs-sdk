import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import { BusinessManagerStore } from './business-manager.js';
import { reservePopulationFoodCommerce } from './native-food-commerce.js';
import { populationNeedsBinding } from './needs-runtime.js';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-A09 finite native food sale/procurement, bilateral settlement and uncertain recovery', async () => {
    await runNativeFoodIntegration('NativeCommerce.test.ts', 24);
}, 60000);
test('backend commerce admission derives exact population identities and never accepts posted inventory or native receipt claims', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'commerce-admission-'));
    try {
        mkdirSync(join(workspace, 'config')); mkdirSync(join(workspace, '.local/economy'), { recursive: true });
        for (const name of ['native-kitchen.json', 'facility-capabilities.json', 'properties.json', 'business-stock-policies.json', 'sale-channel-policies.json'])
            copyFileSync(resolve(import.meta.dir, '../../../config', name), join(workspace, 'config', name));
        const options = { workspace, worldId: 'fixture-world', businessPath: join(workspace, '.local/economy/businesses.sqlite'),
            treasuryPath: join(workspace, '.local/economy/institution-treasury.sqlite'), journalPath: join(workspace, '.local/economy/food-commerce.sqlite'),
            checkpointPath: join(workspace, 'checkpoints.sqlite'), tradePath: join(workspace, 'trades.sqlite') };
        const at = '2026-10-19T10:00:00.000Z', simulationTime = '2001-01-01T00:00:01.000Z';
        const member = (username: string): AgentPopulationMember => ({ agentId: `actor-${username}`, playerUsername: username,
            worldProfile: { profileId: 'finite', version: '1.0.0', digest: 'b'.repeat(64) }, lifecyclePolicy: { policyId: 'finite', version: '1.0.0', digest: 'c'.repeat(64), kind: 'finite' },
            simulationClock: { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64) }, joinedAtSimulationTime: simulationTime,
            sourceResultId: 'opening-result', sourceResultDigest: 'd'.repeat(64), status: 'active', resetAtSimulationTime: null,
            characterLifecycle: { agentId: `actor-${username}`, origin: 'created', createdAtSimulationTime: simulationTime, birthAtSimulationTime: null,
                ageAtObservationMilliseconds: 0, ageObservedAtSimulationTime: simulationTime, currentAgeSimulationMilliseconds: 0,
                status: 'active', statusChangedAtSimulationTime: simulationTime, createdAt: at, updatedAt: at, revision: 1 }, createdAt: at, updatedAt: at, revision: 1 });
        const worker = member('chef'), buyer = member('buyer'), manager = new BusinessManagerStore(options.businessPath);
        manager.create({ businessId: 'karamja-kitchen', name: 'Kitchen', summary: 'Food trade', ownerAgentId: worker.agentId, propertyId: 'karamja.fishing-hut' });
        manager.creditGenesisInventory('food-opening', 'karamja-kitchen', 379, 4); manager.close();
        const clock = { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), simulationTime, wallTime: at, status: 'running' as const, revision: 1, engineTick: 100 };
        const request = { operationId: 'population-sale-1', kind: 'sale' as const, businessId: 'karamja-kitchen', quantity: 2, unitPriceGp: 40, expiresAt: '2026-10-19T10:05:00.000Z' };
        const grant = { grantId: 'food-access', kind: 'explicit' as const, subjectAgentId: worker.agentId, facilityId: 'karamja.fishing-hut.utility', capabilityId: 'storage.secure',
            status: 'active' as const, validFrom: simulationTime, validUntil: null, sourceEvidenceId: 'owner-access' };
        const order = reservePopulationFoodCommerce(options, worker, buyer, clock, request, grant, () => true);
        expect(order.binding.intent.counterparty).toEqual({ agentId: buyer.agentId, username: buyer.playerUsername, lifecycleId: populationNeedsBinding(options.worldId, buyer).lifecycleId });
        expect(reservePopulationFoodCommerce(options, worker, buyer, clock, request, grant, () => true)).toEqual(order);
        expect(() => reservePopulationFoodCommerce(options, worker, buyer, clock, { ...request, quantity: 3 }, grant, () => true)).toThrow('reused');
        buyer.status = 'reset'; expect(() => reservePopulationFoodCommerce(options, worker, buyer, clock, request, grant, () => true)).toThrow('lifecycle');
    } finally { rmSync(workspace, { recursive: true, force: true }); }
});
