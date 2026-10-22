import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLlmRuntimeConfig } from '../llm-runtime/config.js';
import type { LlmRuntimeConfig, AutonomousSkillAuthorization } from '../llm-runtime/types.js';
import { check, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';

export function integrationRuntimeConfig(fixture: IntegrationFixture, base: LlmRuntimeConfig): LlmRuntimeConfig {
    validateIntegrationFixture(fixture);
    check(fixture.nativeSiteProfile && fixture.survival, 'Bounded runtime profile requires native sites and day-survival rules');
    const food: AutonomousSkillAuthorization[] = fixture.skills.filter(s => s.id.startsWith('procedure.food.')).map(s => {
        const operation = s.id.split('.')[2]!.split('-')[0]!;
        check(['gather', 'cook', 'consume'].includes(operation), 'Unexpected integration food operation');
        return { id: s.id, version: s.version, risk: 'routine', operations: operation === 'cook' ? ['walk-to', 'food-cook'] : [`food-${operation}`],
            parameters: operation === 'consume' ? { slot: { minimum: 0, maximum: 27 } }
                : operation === 'cook' ? { 'kitchen-run': {}, 'batch-id': {} } : {},
            itemNames: operation === 'consume' ? ['lobster'] : ['raw lobster', 'lobster'], partners: [],
            maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0, maxGpPerDay: 0 } as AutonomousSkillAuthorization;
    });
    const delivery = fixture.skills.find(s => s.id === 'trade.lumbridge.give-item')!;
    const travel = fixture.skills.find(s => s.id === 'procedure.travel.native-sites');
    const routes: AutonomousSkillAuthorization[] = travel ? [{ id: travel.id, version: travel.version, risk: 'routine',
        operations: ['travel-to-site'], parameters: { site: { oneOf: ['kitchen', 'pier', 'housing'] } },
        // The existing decision ledger aggregates rent, food and travel in one daily total.
        // The avatar's own control profile still applies its individual daily ceiling.
        itemNames: [], partners: [], maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 30,
        maxGpPerDay: Math.max(...fixture.avatars.map(a => a.coinsGp)) }] : [];
    return validateLlmRuntimeConfig({ ...base, enabled: false, automaticReplanning: true,
        skillBuilder: { ...base.skillBuilder, enabled: false }, dailyBudget: { ...base.dailyBudget, maxCostMicros: 0 },
        autonomousExecution: { enabled: true, maxOperations: 8, maxTimeoutMs: travel ? 360000 : 240000, allowedSkills: [...food, ...routes,
            { id: delivery.id, version: delivery.version, risk: 'player-trade', operations: ['walk-to', 'trade-give-item'],
                parameters: { recipient: { oneOf: fixture.avatars.filter(a => a.agentId !== fixture.kitchen.courierAgentId).map(a => a.username) },
                    'item-name': { exact: 'Lobster' }, amount: { exact: 1 } },
                itemNames: ['lobster'], partners: fixture.avatars.filter(a => a.agentId !== fixture.kitchen.courierAgentId).map(a => a.username),
                maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0, maxGpPerDay: 0 }] } });
}

/** Explicit fixture boot configuration, before any persistent world exists. */
export function stageIntegrationRuntime(root: string, fixture: IntegrationFixture): string {
    const marker = 'config/integration-runtime-profile.json';
    check(existsSync(join(root, '.integration-stage.json'))
        && JSON.parse(readFileSync(join(root, '.integration-stage.json'), 'utf8')).fixtureDigest === fixture.digest
        && ['.local/agent-state/agents.sqlite', '.local/simulation/simulation-clock.sqlite', marker]
            .every(p => !existsSync(join(root, p))), 'Runtime configuration requires a fresh unpublished stage');
    const config = integrationRuntimeConfig(fixture, JSON.parse(readFileSync(join(root, 'config/llm-runtime.json'), 'utf8')));
    writeFileSync(join(root, 'config/llm-runtime.json'), JSON.stringify(config, null, 2) + '\n');
    writeFileSync(join(root, marker), JSON.stringify({ protocol: 'integration-livelihood-runtime-v1', fixtureDigest: fixture.digest,
        configDigest: digest(config), providerCalls: 0 }, null, 2) + '\n', { flag: 'wx' });
    return marker;
}
