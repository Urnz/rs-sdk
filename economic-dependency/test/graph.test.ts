import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../agent-state/store.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import { ProductionWorkInProgressStore, loadDefaultProductionWorkflowCatalog, compileProductionWorkflow } from '../../production-workflow/index.js';
import { productionSourceId, readProductionEvidence, type ProductionClockBinder } from '../../production-workflow/evidence.js';
import { readDatabase } from '../../external-trade/source.js';
import { digest } from '../../external-trade/policy.js';
import { reportEconomicDependencies, type DependencyQuery, type DependencyOptions } from '../index.js';

const directories: string[] = [], catalog = loadDefaultProductionWorkflowCatalog();
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const wall = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour)).toISOString();
const sim = (hour: number) => new Date(Date.UTC(2001, 0, 1, hour)).toISOString();
const clockProfile = { schemaVersion: 1 as const, profileId: 'graph', version: '1.0.0', seed: 'graph-native', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } };
const query: DependencyQuery = { from: wall(0), to: wall(5), basis: 'wall' };
function fixture(timed = false) {
    const directory = mkdtempSync(join(tmpdir(), 'economic-dependency-')); directories.push(directory);
    const options: DependencyOptions = { productionPath: join(directory, 'business.sqlite'), agentPath: join(directory, 'agents.sqlite'),
        enginePath: join(directory, 'trades.sqlite'), clockPath: join(directory, 'clock.sqlite') };
    const clock = new SimulationClockStore(options.clockPath);
    clock.create({ clockId: 'world', profile: clockProfile, wallTime: wall(0), simulationTime: sim(0) });
    const agents = new AgentStateStore(options.agentPath,{store:clock,clockId:'world'});
    try { for (const actor of ['ada', 'bea']) agents.createIdentity({ agentId: actor, playerUsername: actor, displayName: actor,
        background: 'Native graph fixture.', personalityTraits: ['careful'] }, wall(0)); } finally { agents.close(); clock.close(); }
    const manager = new BusinessManagerStore(options.productionPath);
    try { manager.create({ businessId: 'forge', ownerAgentId: 'ada', name: 'Forge', summary: 'Native stock production.' }, wall(0));
        manager.creditGenesisInventory('copper-opening', 'forge', 436, 3, wall(0));
        manager.creditGenesisInventory('tin-opening', 'forge', 438, 3, wall(0)); } finally { manager.close(); }
    const binder: ProductionClockBinder | false = timed ? (facts, factsDigest) => {
        const shared = new SimulationClockStore(options.clockPath);
        try { return shared.bindEvent({ clockId: 'world', domain: 'business-production', sourceId: productionSourceId(facts.evidence.operationId), sourceDigest: factsDigest, wallTime: facts.recordedAt }).stamp; }
        finally { shared.close(); }
    } : false;
    const openWork = () => new ProductionWorkInProgressStore(options.productionPath, catalog, undefined, binder);
    const work = openWork();
    try { work.reserve({ operationId: 'reserve-bronze', runId: 'bronze', businessId: 'forge', actorAgentId: 'ada', workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0',
        inputs: [{ itemId: 436, count: 3, storageId: null }, { itemId: 438, count: 3, storageId: null }] }, wall(0)); } finally { work.close(); }
    new TradeEvidenceStore(options.enginePath).close();
    const plan = compileProductionWorkflow(catalog, 'tools.bronze-pickaxe', '1.0.0');
    function step(stepId: string, hour: number, trusted = true) {
        const step = plan.steps.find(item => item.stepId === stepId)!, store = openWork();
        try { return store.completeStep('bronze', stepId, { operationId: `produce-${stepId}`, runId: 'bronze', stepId, status: 'completed',
            inputs: step.inputs, outputs: step.outputs, sourceEvidenceDigest: 'a'.repeat(64), occurredAt: wall(hour) }, () => trusted, wall(hour)); }
        finally { store.close(); }
    }
    let tradeId = 0;
    function trade(hour = 3, from = 'ada', to = 'bea', items = [{ id: 1265, name: 'pickaxe', count: 1 }]) {
        const store = new TradeEvidenceStore(options.enginePath, timed ? event => {
            const shared = new SimulationClockStore(options.clockPath);
            try { shared.bindEvent({ clockId: 'world', domain: 'engine-trade', sourceId: event.eventId, sourceDigest: event.eventDigest,
                wallTime: event.committedAt, engineTick: event.tick }); } finally { shared.close(); }
        } : undefined);
        try { return store.record({ tick: ++tradeId, fromUsername: from, toUsername: to, fromItems: items, toItems: [{ id: 995, name: 'coins', count: 40 }],
            fromValue: 9999, toValue: 8888, committedAt: wall(hour) }, `10000000-0000-4000-8000-${String(tradeId).padStart(12, '0')}`); }
        finally { store.close(); }
    }
    return { options, step, trade, openWork, graph: (scope = query) => reportEconomicDependencies(scope, options),
        simulationQuery: { from: sim(0), to: sim(5), basis: 'simulation', clockId: 'world', clockProfileDigest: simulationClockProfileDigest(clockProfile) } as DependencyQuery };
}
function mutate(path: string, sql: string) { const db = new Database(path); try { db.run(sql); }
    finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); } }
const removeAudit = (path: string) => { for (const table of ['business_production_evidence', 'business_production_evidence_head', 'business_production_evidence_catalog',
    'business_production_evidence_legacy', 'business_production_evidence_schema']) mutate(path, `DROP TABLE ${table}`); };

describe('observed economic dependency graph', () => {
    test('actual committed WIP allocations connect agent, Business and product levels with exact intermediate lots', () => {
        const f = fixture(); f.step('smelt', 1); f.step('forge', 2); const graph = f.graph();
        expect(graph.nodes.filter(node => node.kind === 'business').map(node => node.label)).toEqual(['forge']);
        expect(graph.nodes.filter(node => node.kind === 'agent').map(node => node.label)).toEqual(['ada']);
        const bronze = graph.nodes.find(node => node.kind === 'wip-lot' && node.metadata.itemId === 2349)!;
        expect(graph.edges.filter(edge => edge.to === bronze.id && edge.relation === 'produced-wip')).toHaveLength(1);
        expect(graph.edges.filter(edge => edge.from === bronze.id && edge.relation === 'consumed-wip')).toHaveLength(1);
        expect(graph.edges.filter(edge => edge.relation === 'consumed-wip').map(edge => edge.quantity)).toEqual(expect.arrayContaining([3, 3, 3]));
        expect(graph.projections.products.nodeIds).toHaveLength(4);
        expect(graph.nodes.filter(node => node.kind === 'wip-lot' && node.metadata.origin === 'reserved-stock-origin-unproven')).toHaveLength(2);
        expect(graph.provesSelfSufficiency).toBeFalse(); expect(graph.completeEconomyCoverage).toBeFalse();
    });
    test('trade legs preserve actual directions/GP and never infer a Business or production-to-trade lot link', () => {
        const f = fixture(); f.step('smelt', 1); f.step('forge', 2); f.trade(); const graph = f.graph();
        expect(graph.projections.agents.transfers.map(flow => ({ itemId: flow.itemId, quantity: flow.quantity })))
            .toEqual(expect.arrayContaining([{ itemId: 1265, quantity: 1 }, { itemId: 995, quantity: 40 }]));
        expect(graph.edges.some(edge => graph.nodes.find(node => node.id === edge.from)?.kind === 'wip-lot'
            && graph.nodes.find(node => node.id === edge.to)?.metadata.eventKind === 'committed-player-transfer')).toBeFalse();
        expect(graph.edges.filter(edge => edge.relation === 'production-business')).toHaveLength(2);
        expect(graph.edges.filter(edge => edge.unit === 'gp').every(edge => edge.quantity === 40)).toBeTrue();
    });
    test('exact production replay and repeated graph reads do not add events or edges', () => {
        const f = fixture(); f.step('smelt', 1); const first = f.graph(); f.step('smelt', 1);
        expect(f.graph()).toEqual(first); expect(first.evidence.filter(item => item.channel === 'business-production')).toHaveLength(1);
        const { digest: expected, ...definition } = first; expect(digest(definition)).toBe(expected);
    });
    test('configured recipes and reserved stock alone never become completed production edges', () => {
        const f = fixture(); const graph = f.graph(); expect(graph.edges).toHaveLength(0); expect(graph.nodes).toHaveLength(0);
        expect(() => f.step('smelt', 1, false)).toThrow(); expect(f.graph().edges).toHaveLength(0);
    });
    test('final release and restart preserve production evidence without producing outputs twice', () => {
        const f = fixture(); f.step('smelt', 1); f.step('forge', 2); const work = f.openWork();
        try { work.completeRun('bronze', null, wall(3)); } finally { work.close(); }
        const first = f.graph(); expect(first.edges.filter(edge => edge.relation === 'produced-wip')).toHaveLength(2); expect(f.graph()).toEqual(first);
    });
    test('simulation graphs require exact native bindings and do not relabel wall times as simulation times', () => {
        const untimed = fixture(); untimed.step('smelt', 1); untimed.trade();
        expect(untimed.graph(untimed.simulationQuery).nodes).toHaveLength(0);
        expect(untimed.graph(untimed.simulationQuery).diagnostics.filter(item => item.reason === 'unplaced-event')).toHaveLength(2);
        const timed = fixture(true); timed.step('smelt', 1); timed.step('forge', 2); timed.trade();
        const graph = timed.graph(timed.simulationQuery); expect(graph.evidence.filter(item => item.selected)).toHaveLength(3);
        expect(graph.evidence.every(item => item.simulationTime?.startsWith('2001-'))).toBeTrue();
    });
    test('wrong clock profile and altered native clock backing withhold simulation edges', () => {
        const f = fixture(true); f.step('smelt', 1); f.trade(2);
        expect(f.graph({ ...f.simulationQuery, clockProfileDigest: 'b'.repeat(64) }).nodes).toHaveLength(0);
        mutate(f.options.clockPath, "UPDATE simulation_event_stamp SET simulation_time='2001-01-01T04:00:00.000Z' WHERE domain='business-production'");
        expect(f.graph(f.simulationQuery).evidence.find(item => item.channel === 'business-production')!.selected).toBeFalse();
    });
    test('a narrower window retains boundary lot context without adding an outside-window producer event', () => {
        const f = fixture(); f.step('smelt', 1); f.step('forge', 2); const graph = f.graph({ ...query, from: wall(1) });
        expect(graph.edges.filter(edge => edge.relation === 'produced-wip')).toHaveLength(1);
        expect(graph.nodes.some(node => node.kind === 'wip-lot' && node.metadata.origin === 'observed-production-outside-window')).toBeTrue();
        expect(graph.evidence.filter(item => item.selected)).toHaveLength(1);
        expect(f.graph({ ...query, to: wall(1) }).evidence.filter(item => item.selected)).toHaveLength(1);
    });
    test('unmapped humans and changed historical usernames remain player nodes instead of guessed agents', () => {
        const f = fixture(); f.trade(1, 'ada', 'human');
        const agents = new AgentStateStore(f.options.agentPath); try { agents.updateIdentity('ada', 1, { playerUsername: 'cora' }, wall(2)); } finally { agents.close(); }
        const graph = f.graph(); expect(graph.nodes.filter(node => node.kind === 'player').map(node => node.label).sort()).toEqual(['ada', 'human']);
        expect(graph.projections.agents.transfers).toHaveLength(0); expect(graph.participantTransfers).toHaveLength(2);
    });
    test('legacy step migration does not backfill production and a new step may consume explicitly unverified legacy WIP', () => {
        const f = fixture(); f.step('smelt', 1); removeAudit(f.options.productionPath);
        expect(f.graph().legacyUnlinkedProductionSteps).toBe(1); expect(f.graph().sources.production.status).toBe('unavailable');
        const reopened = f.openWork(); reopened.close(); expect(f.graph().edges).toHaveLength(0);
        f.step('forge', 2); const graph = f.graph(); expect(graph.legacyUnlinkedProductionSteps).toBe(1);
        expect(graph.nodes.some(node => node.kind === 'wip-lot' && node.metadata.origin === 'legacy-production-unverified')).toBeTrue();
        expect(graph.edges.filter(edge => edge.relation === 'produced-wip')).toHaveLength(1);
    });
    test('source row, frozen actor, catalog and audit-tail tampering invalidate only that source', () => {
        for (const sql of ["UPDATE business_production_step SET source_evidence_digest='forged'", "UPDATE business_production_run SET actor_agent_id='bea'",
            "DELETE FROM business_production_evidence", "UPDATE business_production_evidence_catalog SET definition_json='{}'"]) {
            const f = fixture(); f.step('smelt', 1); f.trade(2); mutate(f.options.productionPath, sql); const graph = f.graph();
            expect(graph.sources.production.status).toBe('invalid'); expect(graph.edges.some(edge => edge.relation === 'produced-wip')).toBeFalse();
            expect(() => f.step('smelt',1)).toThrow();
            expect(graph.participantTransfers).toHaveLength(2);
        }
    });
    test('failed audit insertion rolls back stock and steps, and an orphan clock stamp proves no production', () => {
        const f = fixture(true);
        mutate(f.options.productionPath, "CREATE TRIGGER fail_receipt BEFORE INSERT ON business_production_evidence BEGIN SELECT RAISE(ABORT,'forced receipt failure'); END");
        expect(() => f.step('smelt', 1)).toThrow('forced receipt failure');
        expect(readDatabase(f.options.productionPath, db => (db.query('SELECT COUNT(*) AS count FROM business_production_step').get() as any).count)).toBe(0);
        expect(readDatabase(f.options.productionPath, db => (db.query('SELECT SUM(count) AS count FROM business_production_material').get() as any).count)).toBe(6);
        expect(f.graph(f.simulationQuery).nodes).toHaveLength(0);
    });
    test('overused material or corrupted audit blocks subsequent production with no partial second step', () => {
        const f = fixture(); f.step('smelt', 1);
        mutate(f.options.productionPath, "UPDATE business_production_material SET count=count+1 WHERE origin_step_id='smelt'");
        expect(() => f.step('forge', 2)).toThrow('balance'); expect(f.graph().sources.production.status).toBe('invalid');
        expect(readDatabase(f.options.productionPath, db => (db.query('SELECT COUNT(*) AS count FROM business_production_step').get() as any).count)).toBe(1);
    });
    test('missing databases and a future schema cause no creation, migration or favorable empty graph', () => {
        const f = fixture(), missing = join(f.options.agentPath, 'absent.sqlite');
        const empty = reportEconomicDependencies(query, { enginePath: missing, productionPath: missing, agentPath: missing, clockPath: missing });
        expect(empty.measurementStatus).toBe('unavailable'); expect(empty.nodes).toHaveLength(0); expect(existsSync(missing)).toBeFalse();
        mutate(f.options.productionPath, 'UPDATE business_production_evidence_schema SET version=2');
        expect(f.graph().sources.production.status).toBe('invalid'); expect(() => f.openWork()).toThrow('schema');
    });
    test('unsafe trade totals and invalid/extended date windows fail instead of rounding or string-ordering', () => {
        const f = fixture(); f.trade(); expect(f.graph({ ...query, to: '+010000-01-01T00:00:00.000Z' }).participantTransfers).toHaveLength(2);
        expect(() => f.graph({ ...query, from: '+010000-01-01T00:00:00.000Z' })).toThrow('window');
        expect(() => f.graph({ ...query, basis: 'simulation' })).toThrow();
        f.trade(4, 'ada', 'bea', [{ id: 1265, name: 'tool', count: Number.MAX_SAFE_INTEGER }, { id: 1265, name: 'tool', count: 1 }]);
        expect(() => f.graph()).toThrow('integer');
    });
    test('every edge endpoint and evidence reference is present; graphs never report criticality or outage effects', () => {
        const f = fixture(); f.step('smelt', 1); f.step('forge', 2); f.trade(); const graph = f.graph(), nodes = new Set(graph.nodes.map(node => node.id));
        for (const edge of graph.edges) { expect(nodes.has(edge.from) && nodes.has(edge.to)).toBeTrue(); expect(graph.evidence.some(item => item.id === edge.evidenceId)).toBeTrue(); }
        expect('criticality' in graph).toBeFalse(); expect(graph.projections.products.classificationIsNotCausalFlow).toBeTrue();
    });
    test('a missing AgentState source preserves native production without inventing registered agents', () => {
        const f = fixture(); f.step('smelt',1);
        const graph=reportEconomicDependencies(query,{...f.options,agentPath:join(f.options.agentPath,'missing.sqlite')});
        expect(graph.nodes.filter(node=>node.kind==='agent')).toHaveLength(0);
        expect(graph.nodes.filter(node=>node.kind==='actor-reference').map(node=>node.label)).toEqual(['ada']);
        expect(graph.edges.filter(edge=>edge.relation==='produced-wip')).toHaveLength(1);
    });
    test('immutable finite membership establishes historical avatar identity after display edits, without retroactive assignment', () => {
        for(const late of [false,true]){
            const f=fixture(true);if(late)f.trade(1);
            const clock=new SimulationClockStore(f.options.clockPath),agents=new AgentStateStore(f.options.agentPath,{store:clock,clockId:'world'});
            try{agents.bindPopulationMember({agentId:'ada',playerUsername:'ada',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
                lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',digest:'b'.repeat(64),kind:'finite'},
                simulationClock:{clockId:'world',profileDigest:simulationClockProfileDigest(clockProfile)},joinedAtSimulationTime:sim(0),
                sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)},wall(late?2:0));
                agents.updateIdentity('ada',1,{displayName:'Updated Ada'},wall(late?2:0));
            }finally{agents.close();clock.close();}
            if(!late)f.trade(1);
            const graph=f.graph(f.simulationQuery);
            expect(graph.nodes.some(node=>node.kind==='agent'&&node.label==='ada')).toBe(!late);
            expect(graph.nodes.some(node=>node.kind==='player'&&node.label==='ada')).toBe(late);
        }
    });
});
