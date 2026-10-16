import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../agent-state/store.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { ProductionWorkInProgressStore, loadDefaultProductionWorkflowCatalog, compileProductionWorkflow } from '../../production-workflow/index.js';
import { validateProductionWorkflowCatalog } from '../../production-workflow/catalog.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import { digest } from '../../external-trade/policy.js';
import { analyzeEconomicDependencies } from '../risk.js';
import { reportEconomicRisk, reportEconomicDependencies, type DependencyOptions, type DependencyQuery } from '../index.js';

const directories: string[] = [], catalog = loadDefaultProductionWorkflowCatalog(), wall = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
const scope: DependencyQuery = { from: wall(0), to: wall(10), basis: 'wall' };
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture(productionCatalog = catalog, registeredActors = ['ada', 'bea', 'cora']) {
    const directory = mkdtempSync(join(tmpdir(), 'economic-risk-')); directories.push(directory);
    const options: DependencyOptions = { enginePath: join(directory, 'trades.sqlite'), productionPath: join(directory, 'business.sqlite'),
        agentPath: join(directory, 'agents.sqlite'), clockPath: join(directory, 'clock.sqlite') };
    const clock = new SimulationClockStore(options.clockPath), profile = { schemaVersion: 1 as const, profileId: 'risk', version: '1.0.0', seed: 'native-risk',
        rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } };
    clock.create({ clockId: 'world', profile, wallTime: wall(0), simulationTime: wall(0) }); clock.close();
    const agents = new AgentStateStore(options.agentPath);
    try { for (const agentId of registeredActors) agents.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
        background: 'Native risk test.', personalityTraits: ['careful'] }, wall(0)); } finally { agents.close(); }
    const manager = new BusinessManagerStore(options.productionPath);
    try { for (const [businessId, ownerAgentId] of [['forge', 'ada'], ['other', 'bea']]) {
        manager.create({ businessId: businessId!, ownerAgentId: ownerAgentId!, name: businessId!, summary: 'Native producer.' }, wall(0));
        for (const itemId of [436, 438, 1741, 317]) manager.creditGenesisInventory(`${businessId}-${itemId}`, businessId!, itemId, 100, wall(0));
    } } finally { manager.close(); }
    new ProductionWorkInProgressStore(options.productionPath, productionCatalog, undefined, false).close();
    new TradeEvidenceStore(options.enginePath).close();
    let operation = 0;
    function run(workflowId = 'tools.bronze-pickaxe', businessId = 'forge', actorAgentId = 'ada', countSteps = Infinity) {
        const plan = compileProductionWorkflow(productionCatalog, workflowId, '1.0.0'), runId = `run-${++operation}`,
            work = new ProductionWorkInProgressStore(options.productionPath, productionCatalog, undefined, false);
        try {
            work.reserve({ operationId: `reserve-${runId}`, runId, businessId, actorAgentId, workflowId, workflowVersion: '1.0.0',
                inputs: plan.externalInputs.map(item => ({ itemId: item.itemId, count: item.quantity, storageId: null })) }, wall(0));
            for (const [index, step] of plan.steps.entries()) if (index < countSteps) work.completeStep(runId, step.stepId,
                { operationId: `${runId}-${step.stepId}`, runId, stepId: step.stepId, status: 'completed', inputs: step.inputs, outputs: step.outputs,
                    sourceEvidenceDigest: 'a'.repeat(64), occurredAt: wall(index + 1) }, () => true, wall(index + 1));
        } finally { work.close(); }
    }
    function trade(from = 'ada', to = 'bea', itemId = 1265, count = 1, hour = 5) {
        const store = new TradeEvidenceStore(options.enginePath);
        try { store.record({ tick: ++operation, fromUsername: from, toUsername: to, fromItems: [{ id: itemId, name: 'native item', count }],
            toItems: [{ id: 995, name: 'coins', count: 40 }], fromValue: 9999, toValue: 9999, committedAt: wall(hour) }); }
        finally { store.close(); }
    }
    return { options, run, trade, report: (query = scope, paths = options) => reportEconomicRisk(query, paths),
        simulationScope: { ...scope, basis: 'simulation', clockId: 'world', clockProfileDigest: simulationClockProfileDigest(profile) } as DependencyQuery };
}
type Report = ReturnType<typeof reportEconomicRisk>;
const product = (report: Report, itemId: number) => report.products.find(row => row.itemId === itemId)!;
const scenario = (report: Report, kind: string, label: string) => report.scenarios.find(row => row.targetKind === kind && row.label === label)!;
function mutate(path: string, sql: string) { const db = new Database(path); try { db.run(sql); }
    finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); } }

test('native two-stage production has exact depth and single-producer candidates only with observed downstream use', () => {
    const f = fixture(); f.run(); const report = f.report();
    expect(report.supplyChain.maximumObservedProductionStages).toBe(2);
    expect(report.supplyChain.eventDepths.map(row => row.stages).sort()).toEqual([1, 2]);
    expect(product(report, 2349).singlePointOfFailure.status).toBe('observed-single-producer-candidate');
    expect(product(report, 1265).singlePointOfFailure.status).toBe('no-verified-downstream-lot-use');
    expect(product(report, 436).singlePointOfFailure.status).toBe('no-observed-producer');
    expect(report.supplyChain.fullChainDepthKnown).toBeFalse(); expect(report.predictsFutureOutage).toBeFalse();
    expect(product(report, 2349).singlePointOfFailure.globalVerdict).toBe('unknown');
});
test('withdrawing a required raw input blocks its step and cascades through the actual bronze lot exactly once', () => {
    const f = fixture(); f.run(); const report = f.report(), copper = scenario(report, 'product', '436');
    expect(copper.directProductionEventIds).toHaveLength(1); expect(copper.propagatedProductionEventIds).toHaveLength(1);
    expect(copper.propagationLinks).toHaveLength(1);
    expect(copper.lostProductionByProduct.map(({ itemId, quantity }) => ({ itemId, quantity }))).toEqual([{ itemId: 1265, quantity: '1' }, { itemId: 2349, quantity: '3' }]);
    expect(scenario(report, 'product', '2349').affectedProductionEventCount).toBe(1);
    expect(scenario(report, 'product', '1265').affectedProductionEventCount).toBe(0);
});
test('forked physical lots count every affected step once and declared ordering is not a third material stage', () => {
    const f = fixture(); f.run('facility.bronze-bellows-upgrade'); const report = f.report(), copper = scenario(report, 'product', '436');
    expect(report.supplyChain.maximumObservedProductionStages).toBe(2);
    expect(copper.affectedProductionEventCount).toBe(3); expect(copper.propagatedProductionEventCount).toBe(2);
    expect(copper.lostProductionByProduct.map(row => row.quantity)).toEqual(['1', '6', '1']);
});
test('Business and responsible-agent outages remove their own events without inventing production-to-sale lineage', () => {
    const f = fixture(); f.run(); f.trade(); const report = f.report(), business = scenario(report, 'business', 'forge'), ada = scenario(report, 'agent', 'ada');
    expect(business.affectedProductionEventCount).toBe(2); expect(business.propagatedProductionEventCount).toBe(0);
    expect(business.canceledTradeFlowIds).toHaveLength(0); expect(ada.canceledTradeReceiptCount).toBe(1);
    expect(ada.canceledTradeFlowIds).toHaveLength(2); expect(ada.affectedProductionEventCount).toBe(2);
    expect(ada.canceledTransfersByProduct.map(row => row.quantity)).toEqual(['40', '1']);
});
test('production concentration is per product and Business, with exact 3:1 shares and HHI 10/16', () => {
    const f = fixture(); for (let i = 0; i < 3; i++) f.run(); f.run('tools.bronze-pickaxe', 'other', 'bea');
    const report = f.report(), pickaxe = product(report, 1265), bronze = product(report, 2349);
    expect(pickaxe.producedQuantity).toBe('4'); expect(bronze.producedQuantity).toBe('12');
    expect(pickaxe.businessConcentration!.hhi).toEqual({ numerator: '10', denominator: '16', approximate: 0.625 });
    expect(pickaxe.businessConcentration!.largestShare.approximate).toBe(0.75);
    expect(bronze.singlePointOfFailure.status).toBe('multiple-observed-producers');
    expect(report.singlePointOfFailureProducts).toHaveLength(0);
    expect(report.criticalActors.businesses[0]!.label).toBe('forge');
    expect(report.criticalActors.agents[0]!.label).toBe('ada');
    expect(pickaxe.registeredResponsibleAgentConcentration!.hhi.approximate).toBe(0.625);
});
test('product shortage cancels an entire atomic barter/payment receipt, but agent removal does not infer a resale cascade', () => {
    const f = fixture(); f.trade('ada', 'bea', 1265, 2); f.trade('bea', 'cora', 1265, 1);
    const report = f.report(), ada = scenario(report, 'agent', 'ada'), pickaxe = scenario(report, 'product', '1265');
    expect(ada.canceledTradeReceiptCount).toBe(1); expect(pickaxe.canceledTradeReceiptCount).toBe(2);
    expect(ada.canceledTransfersByProduct.find(row => row.itemId === 1265)!.quantity).toBe('2');
    expect(pickaxe.canceledTransfersByProduct.find(row => row.itemId === 995)!.quantity).toBe('80');
    expect(scenario(report, 'product', '995').canceledTradeFlowIds).toHaveLength(4);
    expect(product(report, 1265).businessConcentration).toBeNull();
    expect(report.supplyChain.maximumObservedProductionStages).toBeNull();
});
test('window boundaries censor depth and retain unknown input origins rather than pulling in previous producers', () => {
    const f = fixture(); f.run(); const report = f.report({ ...scope, from: wall(1) });
    expect(report.supplyChain.maximumObservedProductionStages).toBe(1); expect(report.supplyChain.links).toHaveLength(0);
    expect(report.supplyChain.boundaryInputs[0]!.origin).toBe('observed-production-outside-window');
    expect(product(report, 2349).singlePointOfFailure.status).toBe('no-observed-producer');
    expect(scenario(report, 'product', '436')).toBeUndefined();
});
test('missing AgentState leaves responsible-actor concentration unknown and never creates an agent outage target', () => {
    const f = fixture(); f.run(); const missing = join(f.options.agentPath, 'absent.sqlite'), report = f.report(scope, { ...f.options, agentPath: missing });
    expect(report.criticalActors.agents).toHaveLength(0); expect(report.criticalActors.businesses).toHaveLength(1);
    expect(product(report, 1265).registeredResponsibleAgentConcentration).toBeNull();
    expect(product(report, 1265).unattributedResponsibleActorQuantity).toBe('1');
    expect(product(report, 1265).businessConcentration!.hhi.approximate).toBe(1); expect(existsSync(missing)).toBeFalse();
});
test('missing and invalid production sources produce unavailable metrics, independent trades remain observed', () => {
    const f = fixture(); f.run(); f.trade();
    for (const corrupt of [false, true]) {
        if (corrupt) mutate(f.options.productionPath, 'DELETE FROM business_production_evidence');
        const report = f.report(scope, corrupt ? f.options : { ...f.options, productionPath: join(f.options.productionPath, 'absent.sqlite') });
        expect(report.productionMetricsStatus).toBe('unavailable'); expect(product(report, 1265).producedQuantity).toBeNull();
        expect(product(report, 1265).singlePointOfFailure.status).toBe('unavailable');
        expect(scenario(report, 'agent', 'ada').canceledTradeReceiptCount).toBe(1);
    }
});
test('an empty observed window and untimed simulation events do not become a complete or healthy economy', () => {
    const f = fixture(); expect(f.report().productionMetricsStatus).toBe('no-observed-production'); f.run();
    const report = f.report(f.simulationScope); expect(report.scenarios).toHaveLength(0);
    expect(report.dependencyGraph.eventCoverage.unplaced).toBe(2); expect(report.completeEconomyCoverage).toBeFalse();
});
test('all absent sources remain unavailable without migration or file creation', () => {
    const f = fixture(), missing = join(f.options.agentPath, 'absent.sqlite');
    const report = f.report(scope, { enginePath: missing, productionPath: missing, agentPath: missing, clockPath: missing });
    expect(report.measurementStatus).toBe('unavailable'); expect(report.productionMetricsStatus).toBe('unavailable');
    expect(report.scenarios).toHaveLength(0); expect(report.supplyChain.maximumObservedProductionStages).toBeNull(); expect(existsSync(missing)).toBeFalse();
});
test('reports are deterministic, source-preserving, and every withdrawal trace resolves to embedded selected evidence', () => {
    const f = fixture(); f.run(); f.trade(); const graph = reportEconomicDependencies(scope, f.options), first = f.report();
    expect(f.report()).toEqual(first); expect(reportEconomicDependencies(scope, f.options)).toEqual(graph);
    const { digest: expected, ...definition } = first; expect(digest(definition)).toBe(expected);
    const nodes = new Set(graph.nodes.map(node => node.id)), evidence = new Set(graph.evidence.filter(row => row.selected).map(row => row.id));
    for (const row of first.scenarios) {
        expect(nodes.has(row.targetNodeId)).toBeTrue();
        for (const id of row.affectedEvidenceIds) expect(evidence.has(id)).toBeTrue();
        for (const link of row.propagationLinks) expect(nodes.has(link.lotNodeId) && evidence.has(link.evidenceId)).toBeTrue();
    }
});
test('unknown human participants are not ranked as registered agents', () => {
    const f = fixture(); f.trade('ada', 'human'); const report = f.report();
    expect(report.criticalActors.agents.map(row => row.label)).toEqual(['ada']);
    expect(report.dependencyGraph.nodes.some(node => node.kind === 'player' && node.label === 'human')).toBeTrue();
});
test('tampered graph artifacts and cycles fail closed rather than returning a finite depth', () => {
    const f = fixture(); f.run(); const graph = reportEconomicDependencies(scope, f.options), changed = structuredClone(graph);
    changed.nodes.pop(); expect(() => analyzeEconomicDependencies(changed)).toThrow('digest');
    const cycle = structuredClone(graph), input = cycle.edges.find(edge => edge.relation === 'consumed-wip' && edge.itemId === 436)!;
    const output = cycle.edges.find(edge => edge.relation === 'produced-wip' && edge.itemId === 1265)!;
    input.from = output.to; input.itemId = 1265; input.quantity = 1;
    const { digest: ignored, ...definition } = cycle; cycle.digest = digest(definition);
    expect(() => analyzeEconomicDependencies(cycle)).toThrow('Cyclic');
});
test('work limits reject an oversized ranking rather than silently sampling targets', () => {
    const f = fixture(), graph = reportEconomicDependencies(scope, f.options);
    for (let index = 0; index < 2049; index++) graph.nodes.push({ id: `agent-${index}`, kind: 'agent', label: `agent-${index}`, metadata: {} });
    const { digest: ignored, ...definition } = graph; graph.digest = digest(definition);
    expect(() => analyzeEconomicDependencies(graph)).toThrow('work limits');
});
test('separate native transfers accumulate beyond Number safe precision using exact decimal quantities', () => {
    const f = fixture(); f.trade('ada', 'bea', 1265, Number.MAX_SAFE_INTEGER); f.trade('ada', 'bea', 1265, Number.MAX_SAFE_INTEGER);
    const transfer = scenario(f.report(), 'agent', 'ada').canceledTransfersByProduct.find(row => row.itemId === 1265)!;
    expect(transfer.quantity).toBe('18014398509481982'); expect(transfer.evidenceIds).toHaveLength(2);
});

test('matching products from unrelated reserved stock never establish a downstream single-producer dependency', () => {
    const { digest: ignored, ...definition } = structuredClone(catalog);
    definition.workflows.push({ workflowId: 'forge.reserved-bronze', version: '1.0.0', name: 'Forge from reserved stock',
        steps: [{ stepId: 'forge', recipe: { id: 'smithing.forge-bronze-pickaxe', version: '1.0.0' }, batches: 1, dependsOn: [] }] });
    const f = fixture(validateProductionWorkflowCatalog(definition)); f.run('tools.bronze-pickaxe', 'forge', 'ada', 1);
    const manager = new BusinessManagerStore(f.options.productionPath);
    try { manager.creditGenesisInventory('unrelated-bronze', 'other', 2349, 3, wall(0)); } finally { manager.close(); }
    f.run('forge.reserved-bronze', 'other', 'bea'); const report = f.report(), bronze = product(report, 2349);
    expect(bronze.businessConcentration!.producerCount).toBe(1); expect(bronze.consumerEventIds).toHaveLength(1);
    expect(bronze.verifiedLotConsumerEventIds).toHaveLength(0);
    expect(bronze.singlePointOfFailure.status).toBe('no-verified-downstream-lot-use');
    expect(scenario(report, 'business', 'forge').affectedProductionEventCount).toBe(1);
    expect(scenario(report, 'business', 'forge').propagatedProductionEventCount).toBe(0);
});

test('a real three-stage material chain has depth three and cascading losses across two exact lot links', () => {
    const { digest: ignored, ...definition } = structuredClone(catalog), base = definition.recipes[2]!;
    definition.recipes.push({ ...base, recipeId: 'fixture.third-stage', inputs: [{ itemId: 1265, quantity: 1 }], outputs: [{ itemId: 1267, quantity: 2 }] });
    definition.workflows.push({ workflowId: 'fixture.three-stage', version: '1.0.0', name: 'Three committed material stages',
        steps: [...definition.workflows[1]!.steps, { stepId: 'finish', recipe: { id: 'fixture.third-stage', version: '1.0.0' }, batches: 1, dependsOn: ['forge'] }] });
    const f = fixture(validateProductionWorkflowCatalog(definition)); f.run('fixture.three-stage'); const report = f.report();
    expect(report.supplyChain.maximumObservedProductionStages).toBe(3);
    expect(scenario(report, 'product', '436').propagatedProductionEventCount).toBe(2);
    expect(scenario(report, 'product', '436').propagationLinks).toHaveLength(2);
    expect(scenario(report, 'product', '436').lostProductionByProduct.find(row => row.itemId === 1267)!.quantity).toBe('2');
});

test('a downstream join reached by two failed lots is counted once, with both causal links preserved', () => {
    const { digest: ignored, ...definition } = structuredClone(catalog), base = definition.recipes[2]!;
    definition.recipes.push({ ...base, recipeId: 'fixture.join', inputs: [{ itemId: 1265, quantity: 1 }, { itemId: 65000, quantity: 1 }],
        outputs: [{ itemId: 65001, quantity: 1 }] });
    definition.workflows.push({ workflowId: 'fixture.joined-chain', version: '1.0.0', name: 'Joined material chain',
        steps: [...definition.workflows[2]!.steps, { stepId: 'join', recipe: { id: 'fixture.join', version: '1.0.0' }, batches: 1, dependsOn: ['forge-tool', 'assemble-upgrade'] }] });
    const f = fixture(validateProductionWorkflowCatalog(definition)); f.run('fixture.joined-chain');
    const report = f.report(), copper = scenario(report, 'product', '436');
    expect(report.supplyChain.maximumObservedProductionStages).toBe(3);
    expect(copper.affectedProductionEventCount).toBe(4); expect(copper.propagatedProductionEventCount).toBe(3);
    expect(copper.propagationLinks).toHaveLength(4);
    expect(copper.lostProductionByProduct.find(row => row.itemId === 65001)!.quantity).toBe('1');
});

test('partly unattributed responsible actors do not yield concentration renormalized over just the known agents', () => {
    const f = fixture(catalog, ['ada']); for (let index = 0; index < 3; index++) f.run(); f.run('tools.bronze-pickaxe', 'other', 'bea');
    const pickaxe = product(f.report(), 1265);
    expect(pickaxe.businessConcentration!.hhi.approximate).toBe(0.625);
    expect(pickaxe.registeredResponsibleAgentConcentration).toBeNull(); expect(pickaxe.unattributedResponsibleActorQuantity).toBe('1');
});

test('concentration squares and totals remain exact beyond Number safe precision', () => {
    const { digest: ignored, ...definition } = structuredClone(catalog); definition.recipes[0]!.outputs[0]!.quantity = 2000000000;
    const f = fixture(validateProductionWorkflowCatalog(definition));
    for (let index = 0; index < 3; index++) f.run('food.cooked-shrimp'); f.run('food.cooked-shrimp', 'other', 'bea');
    const shrimp = product(f.report(), 315);
    expect(shrimp.producedQuantity).toBe('8000000000');
    expect(shrimp.businessConcentration!.hhi).toEqual({ numerator: '40000000000000000000', denominator: '64000000000000000000', approximate: 0.625 });
});
