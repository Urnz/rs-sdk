import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { reportSocietyEvaluation } from '../evaluation-report.js';
import type { EvaluationScope } from '../evaluation.js';
import { AgentStateStore } from '../../agent-state/store.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { ProductionWorkInProgressStore, compileProductionWorkflow, loadDefaultProductionWorkflowCatalog } from '../../production-workflow/index.js';
import { productionSourceId } from '../../production-workflow/evidence.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import type { DependencyOptions } from '../../economic-dependency/index.js';

const directories: string[] = [], configDirectory = join(import.meta.dir, '../../config');
const at = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
const profile = { schemaVersion: 1 as const, profileId: 'evaluation', version: '1.0.0', seed: 'evaluation', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } };
const scope: EvaluationScope = { fromSimulationTime: at(0), toSimulationTime: at(5), clockId: 'world',
    clockProfileDigest: simulationClockProfileDigest(profile), actorAgentIds: ['ada'] };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(populate = true, bind = true) {
    const directory = mkdtempSync(join(tmpdir(), 'society-evaluation-')); directories.push(directory);
    const dependencies: DependencyOptions = { enginePath: join(directory, 'trades.sqlite'), productionPath: join(directory, 'business.sqlite'),
        agentPath: join(directory, 'agents.sqlite'), clockPath: join(directory, 'clock.sqlite') };
    const options = { configDirectory, dependencies, sources: { food: join(directory, 'food.sqlite'), tools: join(directory, 'tools.sqlite'), housing: join(directory, 'housing.sqlite') } };
    if (populate) {
        const clock = new SimulationClockStore(dependencies.clockPath);
        clock.create({ clockId: 'world', profile, wallTime: at(0), simulationTime: at(0) });
        const agents = new AgentStateStore(dependencies.agentPath);
        agents.createIdentity({ agentId: 'ada', playerUsername: 'ada', displayName: 'Ada', background: 'Native evaluation fixture.', personalityTraits: ['careful'] }, at(0)); agents.close();
        const business = new BusinessManagerStore(dependencies.productionPath);
        business.create({ businessId: 'forge', ownerAgentId: 'ada', name: 'Forge', summary: 'Native evaluation fixture.' }, at(0));
        for (const itemId of [436, 438]) business.creditGenesisInventory(`seed-${itemId}`, 'forge', itemId, 100, at(0)); business.close();
        const catalog = loadDefaultProductionWorkflowCatalog(), plan = compileProductionWorkflow(catalog, 'tools.bronze-pickaxe', '1.0.0');
        const work = new ProductionWorkInProgressStore(dependencies.productionPath, catalog, undefined, bind ? (facts, factsDigest) => clock.bindEvent({
            clockId: 'world', domain: 'business-production', sourceId: productionSourceId(facts.evidence.operationId), sourceDigest: factsDigest, wallTime: facts.recordedAt }).stamp : false);
        try {
            work.reserve({ operationId: 'reserve-run', runId: 'native-run', businessId: 'forge', actorAgentId: 'ada', workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0',
                inputs: plan.externalInputs.map(item => ({ itemId: item.itemId, count: item.quantity, storageId: null })) }, at(0));
            for (const [i, step] of plan.steps.entries()) work.completeStep('native-run', step.stepId, {
                operationId: `step-${step.stepId}`, runId: 'native-run', stepId: step.stepId, status: 'completed', inputs: step.inputs, outputs: step.outputs,
                sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at(i + 1) }, () => true, at(i + 1));
        } finally { work.close(); clock.close(); }
    }
    const snapshot = () => readdirSync(directory).sort().map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')]);
    return { directory, options, snapshot, report: (query = scope) => reportSocietyEvaluation(query, options) };
}

test('native bound production supplies observed specialization and withdrawal risk with exact source references', () => {
    const f = fixture(), before = f.snapshot(), report = f.report();
    expect(report.measurementStatus).toBe('partial-observed-channels');
    const specialization = report.calculation.objectives.find(row => row.id === 'specialization')!;
    expect(specialization.metrics[0]).toMatchObject({ id: 'stage-hhi:ada', numerator: '2', denominator: '4', basisPoints: '5000' });
    expect(report.calculation.objectives.find(row => row.id === 'systemic-risk')!.metrics[0]).toMatchObject({ numerator: '2', denominator: '2', basisPoints: '10000' });
    expect(report.evidence.productionEvents).toHaveLength(2); expect(report.evidence.recipeReferences).toHaveLength(2);
    expect(report.evidence.withdrawals.every(row => row.affectedEvidenceIds.length === 2)).toBeTrue();
    expect(report.sources.economicRisk.eventCoverage.unplaced).toBe(0);
    expect(report.totalScore).toBeNull(); expect(report.completePopulationCoverage).toBeFalse();
    expect(report.calculation.objectives.filter(row => row.status === 'inconclusive')).toHaveLength(8);
    const after = f.snapshot();
    expect(after.filter(([name]) => name!.endsWith('.sqlite'))).toEqual(before.filter(([name]) => name!.endsWith('.sqlite')));
    // SQLite may create empty WAL/shared-memory sidecars even on a read-only connection.
    expect(after.filter(([name]) => !name!.endsWith('.sqlite')).map(([name]) => name).sort())
        .toEqual(['agents.sqlite-shm', 'agents.sqlite-wal', 'clock.sqlite-shm', 'clock.sqlite-wal']);
    expect(readFileSync(join(f.directory, 'agents.sqlite-wal')).length).toBe(0);
    expect(readFileSync(join(f.directory, 'clock.sqlite-wal')).length).toBe(0);
    expect(f.report().digest).toBe(report.digest);
});

test('missing native sources remain inconclusive and report does not create any database or directories', () => {
    const f = fixture(false), before = f.snapshot(), report = f.report();
    expect(report.calculation.objectives.every(row => row.status === 'inconclusive')).toBeTrue();
    expect(report.sources.economicRisk.sources.production.status).toBe('unavailable');
    expect(report.sources.selfSufficiency.sources.food.status).toBe('unavailable');
    expect(f.snapshot()).toEqual(before); expect(before).toEqual([]);
});

test('unplaced events, a different clock profile or out-of-window events never become measured zero or good society', () => {
    const f = fixture(true, false), unplaced = f.report();
    expect(unplaced.sources.economicRisk.eventCoverage.unplaced).toBe(2);
    expect(unplaced.calculation.objectives.every(row => row.status === 'inconclusive')).toBeTrue();
    const bound = fixture();
    for (const report of [bound.report({ ...scope, clockProfileDigest: 'f'.repeat(64) }),
        bound.report({ ...scope, fromSimulationTime: at(3), toSimulationTime: at(4) })]) {
        expect(report.calculation.objectives.every(row => row.status === 'inconclusive')).toBeTrue();
        expect(report.societyMinimumVerdict).toBe('inconclusive');
    }
});

test('actor selection restricts specialization while economic-window withdrawal scope stays explicit', () => {
    const report = fixture().report({ ...scope, actorAgentIds: ['bea'] });
    expect(report.calculation.objectives.find(row => row.id === 'specialization')!.status).toBe('inconclusive');
    expect(report.calculation.objectives.find(row => row.id === 'systemic-risk')!.status).toBe('observed');
    expect(report.metricScopes.systemicRisk).toContain('observed-world-production');
});

test('tampered native production invalidates derived indicators without a synthetic fallback', () => {
    const f = fixture(), db = new Database(f.options.dependencies.productionPath);
    try { db.run('DELETE FROM business_production_evidence'); } finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
    const report = f.report(); expect(report.sources.economicRisk.sources.production.status).toBe('invalid');
    expect(report.calculation.objectives.every(row => row.status === 'inconclusive')).toBeTrue();
});
