import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runSkillDiscoveryExperiment } from '../discovery-experiment';
import { SkillLibrary } from '../library';
import { SkillRegistry } from '../registry';
import { FileSkillStore } from '../store';

describe('shared versus isolated skill discovery experiment', () => {
    const registry = new SkillRegistry();

    beforeAll(async () => {
        const library = new SkillLibrary(registry, new FileSkillStore(join(import.meta.dir, '.unused-store')));
        await library.loadReviewedCatalog(join(import.meta.dir, '..', 'catalog'));
    });

    test('runs paired workloads and measures avoided rediscovery work', () => {
        const report = runSkillDiscoveryExperiment(registry, {
            seed: 'paired-test', agentCount: 8, tasksPerAgent: 12, trials: 6, discoveryCostMultiplier: 3
        });

        expect(report.catalog).toHaveLength(5);
        expect(report.trials).toHaveLength(12);
        for (let index = 0; index < report.trials.length; index += 2) {
            const shared = report.trials[index]!;
            const isolated = report.trials[index + 1]!;
            expect(shared.mode).toBe('shared-library');
            expect(isolated.mode).toBe('isolated-discovery');
            expect(shared.agents.map(agent => agent.taskSkillIds))
                .toEqual(isolated.agents.map(agent => agent.taskSkillIds));
            expect(shared.independentDiscoveries).toBe(0);
            expect(isolated.independentDiscoveries).toBeGreaterThan(0);
            expect(isolated.totalOperations).toBeGreaterThan(shared.totalOperations);
        }
        expect(report.summary.operationSavings).toBeGreaterThan(0);
        expect(report.summary.operationSavingsPercent).toBeGreaterThan(0);
        expect(report.summary.avoidedIndependentDiscoveries).toBeGreaterThan(0);
        expect(report.summary.avoidedDuplicateDiscoveries).toBeGreaterThan(0);
    });

    test('is byte-for-byte deterministic for the same catalog, configuration, and seed', () => {
        const config = { seed: 'repeatable', agentCount: 5, tasksPerAgent: 7, trials: 4 };
        const first = runSkillDiscoveryExperiment(registry, config);
        const second = runSkillDiscoveryExperiment(registry, config);
        expect(second).toEqual(first);
        expect(second.workloadFingerprint).toBe(first.workloadFingerprint);
    });

    test('supports an explicit skill subset and rejects invalid experiment bounds', () => {
        const report = runSkillDiscoveryExperiment(registry, {
            seed: 'mining-only', agentCount: 2, tasksPerAgent: 2, trials: 1,
            skillIds: ['mining.varrock-east.copper-to-bank']
        });
        expect(report.catalog.map(skill => skill.id)).toEqual(['mining.varrock-east.copper-to-bank']);
        expect(() => runSkillDiscoveryExperiment(registry, { agentCount: 1 })).toThrow('agentCount');
        expect(() => runSkillDiscoveryExperiment(registry, { trials: 0 })).toThrow('trials');
        expect(() => runSkillDiscoveryExperiment(registry, {
            agentCount: 100, tasksPerAgent: 100, trials: 1_000
        })).toThrow('250000');
        expect(() => runSkillDiscoveryExperiment(registry, { skillIds: ['missing.skill'] })).toThrow('not found');
    });
});
