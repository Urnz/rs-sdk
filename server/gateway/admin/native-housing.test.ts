import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import { PropertyStore } from '../../engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../engine/src/mods/Properties.js';
import { reservePopulationRental } from './native-housing.js';
import { populationNeedsBinding } from './needs-runtime.js';
import { runNativeFoodIntegration } from './native-food-test-runtime.js';
test('SI-A10 native rent escrow, Property entitlement, physical sleep and durable fatigue integration', async () => {
    await runNativeFoodIntegration('NativeHousing.test.ts', 24);
}, 60000);
test('trusted rental admission derives actor/lifecycle/price from population, Property title and catalog', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'rental-admission-'));
    try {
        mkdirSync(join(workspace, 'config')); mkdirSync(join(workspace, '.local/admin'), { recursive: true });
        for (const name of ['native-housing.json', 'housing-units.json', 'housing-tier-policies.json', 'housing-effect-policies.json', 'properties.json'])
            copyFileSync(resolve(import.meta.dir, '../../../config', name), join(workspace, 'config', name));
        const options = { workspace, worldId: 'fixture-world', housingPath: join(workspace, '.local/economy/housing.sqlite'), propertyPath: join(workspace, '.local/admin/properties.sqlite'), checkpointPath: join(workspace, 'checkpoints.sqlite') };
        const wallTime = '2026-10-19T12:00:00.000Z', simulationTime = '2001-01-01T00:00:00.000Z';
        const member = (name: string): AgentPopulationMember => ({ agentId: `actor-${name}`, playerUsername: name,
            worldProfile: { profileId: 'finite', version: '1.0.0', digest: 'b'.repeat(64) }, lifecyclePolicy: { policyId: 'finite', version: '1.0.0', digest: 'c'.repeat(64), kind: 'finite' },
            simulationClock: { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64) }, joinedAtSimulationTime: simulationTime, sourceResultId: 'opening', sourceResultDigest: 'd'.repeat(64),
            status: 'active', resetAtSimulationTime: null, createdAt: wallTime, updatedAt: wallTime, revision: 1,
            characterLifecycle: { agentId: `actor-${name}`, origin: 'created', createdAtSimulationTime: simulationTime, birthAtSimulationTime: null, ageAtObservationMilliseconds: 0,
                ageObservedAtSimulationTime: simulationTime, currentAgeSimulationMilliseconds: 0, status: 'active', statusChangedAtSimulationTime: simulationTime, createdAt: wallTime, updatedAt: wallTime, revision: 1 } });
        const tenant = member('tenant'), landlord = member('landlord'), property = new PropertyStore(loadPropertyCatalog(join(workspace, 'config/properties.json')), options.propertyPath);
        try { property.assignGenesis('landlord-opening', 'falador.south-house', 1, { kind: 'player', id: 'landlord' }); } finally { property.close(); }
        const clock = { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), wallTime, simulationTime, status: 'running' as const, revision: 1, engineTick: 100 };
        const request = { operationId: 'native-lease-1', bedSlotId: 'falador.south-house.bed-1' };
        const order = reservePopulationRental(options, tenant, landlord, clock, request);
        expect(order.binding.intent.amountGp).toBe(500); expect(order.binding.intent.tenant.lifecycleId).toBe(populationNeedsBinding(options.worldId, tenant).lifecycleId);
        expect(reservePopulationRental(options, tenant, landlord, clock, request)).toEqual(order);
        expect(() => reservePopulationRental(options, tenant, landlord, clock, { ...request, bedSlotId: 'falador.south-house.bed-2' })).toThrow('reused');
        expect(() => reservePopulationRental(options, member('other'), member('stranger'), clock, { ...request, operationId: 'native-lease-2' })).toThrow('owner');
        tenant.characterLifecycle.status = 'deceased'; expect(() => reservePopulationRental(options, tenant, landlord, clock, request)).toThrow('lifecycle');
    } finally { rmSync(workspace, { recursive: true, force: true }); }
});
