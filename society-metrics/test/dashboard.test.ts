import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { dashboardFixture, at } from './dashboard-fixture.js';
import { SocietyDashboardError, reportSocietyDashboard } from '../dashboard.js';
import { societyMinimumDigest } from '../../society-minimum/policy.js';
import { reportSocietyEvaluation } from '../evaluation-report.js';
import { handleAdminRequest } from '../../server/gateway/admin/routes.js';
import type { BotSupervisor } from '../../server/gateway/admin/supervisor.js';

function status(run: () => unknown) { try { run(); return 200; } catch (error) { if (error instanceof SocietyDashboardError) return error.status; throw error; } }
const hashes = (directory: string) => readdirSync(directory).filter(name => name.endsWith('.sqlite')).sort().map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')]);

test('one collection binds evaluation, metric contributions, native source facts and unchanged database bytes', () => {
    const f = dashboardFixture();
    try {
        f.addTrade(); const before = hashes(f.directory), report = f.read();
        expect(report.evaluation).toEqual(reportSocietyEvaluation(f.scope, f.options));
        expect(report.totalWindowEvents).toBe(3); // one trade receipt with two flows, not two trades
        expect(report.facets).toMatchObject({ agents: ['ada', 'bea'], businesses: ['forge'], regions: { status: 'unavailable', unknownEvents: 3 } });
        const metric = report.metrics.find(row => row.objectiveId === 'specialization')!;
        const linked = f.read({ metric: metric.key }); expect(linked.totalMatchingEvents).toBe(2);
        expect(linked.events.every(event => event.contribution?.numerator && event.contribution?.denominator)).toBeTrue();
        const event = linked.events[0]!, detail = f.detail(event.id, { snapshot: report.snapshot, metric: metric.key });
        expect(detail.event).toMatchObject({ sourceDigest: event.sourceDigest, nativeSequence: 1, region: null });
        expect(detail.nativeRecord).toMatchObject({ factsDigest: event.sourceDigest, facts: { recordedActorAgentId: 'ada', businessId: 'forge', evidence: { operationId: event.recordId } } });
        expect(detail.simulationBinding).toMatchObject({ clockId: 'world', profileDigest: f.scope.clockProfileDigest, sourceDigest: event.sourceDigest, simulationTime: event.simulationTime });
        expect(detail.graphEdges.some(edge => edge.relation === 'produced-wip')).toBeTrue();
        const { digest, ...definition } = report; expect(societyMinimumDigest(definition)).toBe(digest);
        expect(f.read().digest).toBe(report.digest); expect(hashes(f.directory)).toEqual(before);
    } finally { f.close(); }
});

test('agent, Business, item, unknown region and event time intersect without altering evaluation denominators', () => {
    const f = dashboardFixture();
    try {
        f.addTrade(); const baseline = f.read();
        expect(f.read({ agent: 'bea' }).events.map(row => row.channel)).toEqual(['engine-trade']);
        expect(f.read({ agent: 'ada', business: 'forge', itemId: 1265, region: 'unknown' }).totalMatchingEvents).toBe(1);
        expect(f.read({ agent: 'bea', business: 'forge' }).totalMatchingEvents).toBe(0);
        expect(f.read({ region: '1234' }).totalMatchingEvents).toBe(0);
        const window = f.read({ eventFrom: at(1), eventTo: at(2) });
        expect(window.events).toHaveLength(1); expect(window.events[0]!.simulationTime).toBe(at(2));
        expect(window.timeline.reduce((sum, bin) => sum + bin.eventCount, 0)).toBe(3);
        expect(window.evaluation.digest).toBe(baseline.evaluation.digest); expect(window.snapshot).toBe(baseline.snapshot);
    } finally { f.close(); }
});

test('tied disjoint worst withdrawals witness one maximum instead of unioning several losses into its numerator', () => {
    const f = dashboardFixture();
    try {
        f.addIndependentProduction(); const report = f.read();
        const metric = report.metrics.find(row => row.objectiveId === 'systemic-risk')!;
        expect(metric.metric).toMatchObject({ numerator: '2', denominator: '4' });
        expect(report.worstWithdrawals).toHaveLength(4);
        expect(metric.numeratorScenario?.targetNodeId).toBe(report.worstWithdrawals[0]!.targetNodeId);
        const linked = f.read({ metric: metric.key });
        expect(linked.events).toHaveLength(4);
        const numeratorEvents = linked.events.filter(row => row.contribution!.numerator);
        expect(numeratorEvents).toHaveLength(2); // the union across the tied actors would incorrectly contain four
        expect(numeratorEvents.map(row => row.id).sort()).toEqual([...report.worstWithdrawals[0]!.affectedEvidenceIds].sort());
        const detail = f.detail(numeratorEvents[0]!.id, { snapshot: report.snapshot, metric: metric.key });
        expect(detail.contribution?.numeratorScenario).toEqual(metric.numeratorScenario);
    } finally { f.close(); }
});

test('pagination uses a stable snapshot; details outside active filters, wrong ids and omitted snapshot cannot escape scope', () => {
    const f = dashboardFixture();
    try {
        f.addTrade(); const first = f.read({ limit: 1 });
        const second = f.read({ snapshot: first.snapshot, limit: 1, offset: first.page.nextOffset! });
        expect(first.events[0]!.id).not.toBe(second.events[0]!.id); expect(second.snapshot).toBe(first.snapshot);
        expect(status(() => f.read({ offset: 1 }))).toBe(400);
        expect(status(() => f.detail(first.events[0]!.id, {}))).toBe(400);
        expect(status(() => f.detail(first.events[0]!.id, { snapshot: first.snapshot, agent: 'bea' }))).toBe(404);
        expect(status(() => f.detail('evidence:' + 'f'.repeat(64), { snapshot: first.snapshot }))).toBe(404);
        expect(status(() => f.read({ snapshot: 'f'.repeat(64) }))).toBe(409);
    } finally { f.close(); }
});

test('a native append or source corruption makes an old snapshot conflict instead of attaching a different receipt', () => {
    const f = dashboardFixture();
    try {
        const initial = f.read(); f.addTrade();
        expect(status(() => f.detail(initial.events[0]!.id, { snapshot: initial.snapshot }))).toBe(409);
        const current = f.read(), db = new Database(f.dependencies.productionPath);
        try { db.run('DELETE FROM business_production_evidence'); } finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
        expect(status(() => f.read({ snapshot: current.snapshot }))).toBe(409);
        const invalid = f.read(); expect(invalid.evaluation.sources.economicRisk.sources.production.status).toBe('invalid');
        expect(invalid.events.map(event => event.channel)).toEqual(['engine-trade']);
    } finally { f.close(); }
});

test('missing sources and unplaced clock evidence retain unknown coverage and never create native history', () => {
    const absent = dashboardFixture(false), unplaced = dashboardFixture(true, false);
    try {
        const report = absent.read(); expect(report.events).toEqual([]); expect(report.evaluation.societyMinimumVerdict).toBe('inconclusive');
        expect(readdirSync(absent.directory)).toEqual([]);
        expect(unplaced.read().sourceCoverage.unplaced).toBe(2); expect(unplaced.read().events).toEqual([]);
        expect(() => absent.read({ eventFrom: at(0), eventTo: at(6) })).toThrow('outside');
        expect(() => absent.read({ limit: 101 })).toThrow(); expect(() => absent.read({ itemId: NaN })).toThrow();
        expect(() => absent.read({ metric: 'invented' })).toThrow('Unknown'); expect(() => absent.read({ region: '../escape' })).toThrow();
    } finally { absent.close(); unplaced.close(); }
});

test('all event bounds are (start,end], including millisecond windows and final timeline bucket', () => {
    const f = dashboardFixture();
    try {
        const tiny = { ...f.scope, fromSimulationTime: at(1), toSimulationTime: new Date(Date.parse(at(1)) + 3).toISOString() };
        const report = reportSocietyDashboard(tiny, {}, f.options);
        expect(report.events).toEqual([]); expect(report.timeline).toHaveLength(3);
        const full = f.read(); expect(full.timeline.reduce((sum, bin) => sum + bin.eventCount, 0)).toBe(full.totalWindowEvents);
    } finally { f.close(); }
});

test('dashboard routes authenticate, resolve only configured native sources, and report source conflicts as 409', async () => {
    const f = dashboardFixture();
    try {
        const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor, selfSufficiencySources: f.options.sources, dependencyGraphOptions: f.dependencies };
        const params = new URLSearchParams({ from: f.scope.fromSimulationTime, to: f.scope.toSimulationTime, actor: 'ada', clockId: 'world', clockProfileDigest: f.scope.clockProfileDigest });
        params.set('production', 'C:/untrusted.sqlite'); params.set('observations', '{}');
        const url = new URL(`http://localhost:7780/api/admin/society/dashboard?${params}`), headers = { 'X-Admin-Request': 'rs-sdk-admin' };
        expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
        const response = await handleAdminRequest(new Request(url, { headers }), url, context); expect(response!.status).toBe(200);
        const report = await response!.json(); expect(report.events).toHaveLength(2);
        const detail = new URL(url); detail.pathname += `/events/${encodeURIComponent(report.events[0].id)}`; detail.searchParams.set('snapshot', report.snapshot);
        expect((await handleAdminRequest(new Request(detail), detail, context))!.status).toBe(401);
        expect((await handleAdminRequest(new Request(detail, { headers }), detail, context))!.status).toBe(200);
        f.addTrade(); expect((await handleAdminRequest(new Request(detail, { headers }), detail, context))!.status).toBe(409);
        url.searchParams.set('limit', '1e2'); expect((await handleAdminRequest(new Request(url, { headers }), url, context))!.status).toBe(400);
        expect((await handleAdminRequest(new Request(url, { method: 'POST', headers, body: '{}' }), url, context))!.status).not.toBe(200);
    } finally { f.close(); }
});
