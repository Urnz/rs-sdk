import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../agent-state/store.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { ProductionWorkInProgressStore, compileProductionWorkflow, loadDefaultProductionWorkflowCatalog } from '../../production-workflow/index.js';
import { productionSourceId } from '../../production-workflow/evidence.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { reportSocietyDashboard, readSocietyDashboardEvent, type DashboardFilters } from '../dashboard.js';
import type { DependencyOptions } from '../../economic-dependency/index.js';

export const at = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
export function dashboardFixture(populate = true, bind = true) {
    const directory = mkdtempSync(join(tmpdir(), 'society-dashboard-'));
    const dependencies: DependencyOptions = { enginePath: join(directory, 'trades.sqlite'), productionPath: join(directory, 'business.sqlite'),
        agentPath: join(directory, 'agents.sqlite'), clockPath: join(directory, 'clock.sqlite') };
    const profile = { schemaVersion: 1 as const, profileId: 'dashboard', version: '1.0.0', seed: 'dashboard', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } };
    const scope = { fromSimulationTime: at(0), toSimulationTime: at(5), clockId: 'world', clockProfileDigest: simulationClockProfileDigest(profile), actorAgentIds: ['ada'] };
    const options = { configDirectory: join(import.meta.dir, '../../config'), dependencies,
        sources: { food: join(directory, 'food.sqlite'), tools: join(directory, 'tools.sqlite'), housing: join(directory, 'housing.sqlite') } };
    if (populate) {
        const clock = new SimulationClockStore(dependencies.clockPath);
        clock.create({ clockId: 'world', profile, wallTime: at(0), simulationTime: at(0) });
        const agents = new AgentStateStore(dependencies.agentPath);
        try { for (const agentId of ['ada', 'bea']) agents.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
            background: 'Native dashboard fixture.', personalityTraits: ['careful'] }, at(0)); } finally { agents.close(); }
        const business = new BusinessManagerStore(dependencies.productionPath);
        business.create({ businessId: 'forge', ownerAgentId: 'ada', name: 'Forge', summary: 'Native dashboard fixture.' }, at(0));
        for (const itemId of [436, 438]) business.creditGenesisInventory(`seed-${itemId}`, 'forge', itemId, 100, at(0)); business.close();
        const catalog = loadDefaultProductionWorkflowCatalog(), plan = compileProductionWorkflow(catalog, 'tools.bronze-pickaxe', '1.0.0');
        const work = new ProductionWorkInProgressStore(dependencies.productionPath, catalog, undefined, bind ? (facts, factsDigest) => clock.bindEvent({
            clockId: 'world', domain: 'business-production', sourceId: productionSourceId(facts.evidence.operationId), sourceDigest: factsDigest, wallTime: facts.recordedAt }).stamp : false);
        try {
            work.reserve({ operationId: 'reserve-run', runId: 'native-run', businessId: 'forge', actorAgentId: 'ada', workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0',
                inputs: plan.externalInputs.map(item => ({ itemId: item.itemId, count: item.quantity, storageId: null })) }, at(0));
            for (const [index, step] of plan.steps.entries()) work.completeStep('native-run', step.stepId, {
                operationId: `step-${step.stepId}`, runId: 'native-run', stepId: step.stepId, status: 'completed', inputs: step.inputs, outputs: step.outputs,
                sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at(index + 1) }, () => true, at(index + 1));
        } finally { work.close(); clock.close(); }
    }
    function addTrade(hour = 3) {
        const clock = new SimulationClockStore(dependencies.clockPath), trades = new TradeEvidenceStore(dependencies.enginePath, event => {
            if (bind) clock.bindEvent({ clockId: 'world', domain: 'engine-trade', sourceId: event.eventId, sourceDigest: event.eventDigest, wallTime: event.committedAt, engineTick: event.tick });
        });
        try { return trades.record({ tick: hour, fromUsername: 'ada', toUsername: 'bea', fromItems: [{ id: 1265, name: '<img src=x onerror="window.injected=true">', count: 1 }],
            toItems: [{ id: 995, name: 'Coins', count: 40 }], fromValue: 40, toValue: 40, committedAt: at(hour) }); }
        finally { trades.close(); clock.close(); }
    }
    function addIndependentProduction() {
        const business = new BusinessManagerStore(dependencies.productionPath);
        try {
            business.create({ businessId: 'other', ownerAgentId: 'bea', name: 'Other forge', summary: 'Independent production.' }, at(2));
            for (const itemId of [436, 438]) business.creditGenesisInventory(`other-${itemId}`, 'other', itemId, 100, at(2));
        } finally { business.close(); }
        const catalog = loadDefaultProductionWorkflowCatalog(), plan = compileProductionWorkflow(catalog, 'tools.bronze-pickaxe', '1.0.0');
        const clock = new SimulationClockStore(dependencies.clockPath);
        const work = new ProductionWorkInProgressStore(dependencies.productionPath, catalog, undefined, (facts, factsDigest) => clock.bindEvent({
            clockId: 'world', domain: 'business-production', sourceId: productionSourceId(facts.evidence.operationId), sourceDigest: factsDigest, wallTime: facts.recordedAt }).stamp);
        try {
            work.reserve({ operationId: 'reserve-other', runId: 'other-run', businessId: 'other', actorAgentId: 'bea', workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0',
                inputs: plan.externalInputs.map(item => ({ itemId: item.itemId, count: item.quantity, storageId: null })) }, at(2));
            for (const [index, step] of plan.steps.entries()) work.completeStep('other-run', step.stepId, {
                operationId: `other-${step.stepId}`, runId: 'other-run', stepId: step.stepId, status: 'completed', inputs: step.inputs, outputs: step.outputs,
                sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at(index + 3) }, () => true, at(index + 3));
        } finally { work.close(); clock.close(); }
    }
    return { directory, dependencies, options, scope, addTrade, addIndependentProduction,
        read: (filters: DashboardFilters = {}) => reportSocietyDashboard(scope, filters, options),
        detail: (id: string, filters: DashboardFilters) => readSocietyDashboardEvent(scope, filters, id, options),
        close: () => rmSync(directory, { recursive: true, force: true }) };
}
