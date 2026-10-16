import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { collectSocietyEvaluation, type SocietyEvaluationOptions } from './evaluation-report.js';
import { validateEvaluationScope, type EvaluationScope } from './evaluation.js';
import { timestamp } from './policy.js';
import { productionSourceId } from '../production-workflow/evidence.js';

export class SocietyDashboardError extends Error {
    constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export interface DashboardFilters {
    agent?: string; business?: string; itemId?: number; region?: string; metric?: string;
    eventFrom?: string; eventTo?: string; offset?: number; limit?: number; snapshot?: string;
}
export interface DashboardEvent {
    id: string; channel: 'engine-trade' | 'business-production'; recordId: string; nativeSequence: number;
    sourceDigest: string; wallTime: string; simulationTime: string; agents: string[]; actorReferences: string[];
    businesses: string[]; itemIds: number[]; region: null; issues: string[];
}
const keyPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/i, hashPattern = /^[0-9a-f]{64}$/;
function check(value: unknown, reason: string): asserts value { if (!value) throw new SocietyDashboardError(reason); }
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
function validateFilters(input: DashboardFilters, scope: EvaluationScope) {
    for (const name of ['agent', 'business'] as const) if (input[name] !== undefined)
        check(typeof input[name] === 'string' && keyPattern.test(input[name]!), `Invalid ${name} filter`);
    if (input.itemId !== undefined) check(Number.isSafeInteger(input.itemId) && input.itemId >= 0 && input.itemId <= 65535, 'Invalid item filter');
    if (input.region !== undefined) check(input.region === 'unknown' || /^(0|[1-9]\d{0,4})$/.test(input.region) && Number(input.region) <= 65535, 'Invalid region filter');
    if (input.metric !== undefined) check(typeof input.metric === 'string' && input.metric.length <= 300, 'Invalid metric filter');
    if (input.snapshot !== undefined) check(typeof input.snapshot === 'string' && hashPattern.test(input.snapshot), 'Invalid snapshot digest');
    const offset = input.offset ?? 0, limit = input.limit ?? 25;
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'Invalid event page');
    check(!offset || input.snapshot, 'Pagination requires the original snapshot digest');
    const from = input.eventFrom ?? scope.fromSimulationTime, to = input.eventTo ?? scope.toSimulationTime;
    check(timestamp(from) >= timestamp(scope.fromSimulationTime) && timestamp(to) <= timestamp(scope.toSimulationTime)
        && timestamp(from) < timestamp(to), 'Event subwindow lies outside evaluation window');
    return { ...input, offset, limit, eventFrom: from, eventTo: to };
}

/** One native collection supplies both the values and exact receipt index. No saved/uploaded report is trusted. */
function collect(query: EvaluationScope, options: SocietyEvaluationOptions) {
    const scope = validateEvaluationScope(query), native = collectSocietyEvaluation(scope, options);
    const { evaluation, economic: { risk, sources } } = native, graph = risk.dependencyGraph;
    const snapshot = digest({ projectionProtocol: '1.0.0-single-canonical-maximum-withdrawal', scope, evaluationDigest: evaluation.digest, graphDigest: graph.digest });
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const incidence = new Map<string, Set<string>>();
    const eventEdges = new Map<string, typeof graph.edges>();
    for (const edge of graph.edges) {
        const ids = incidence.get(edge.evidenceId) ?? new Set<string>(); ids.add(edge.from); ids.add(edge.to); incidence.set(edge.evidenceId, ids);
        const edges = eventEdges.get(edge.evidenceId) ?? []; edges.push(edge); eventEdges.set(edge.evidenceId, edges);
    }
    const payloads = new Map<string, { sourceDigest: string; nativeSequence: number; record: unknown }>();
    const clockBindings = new Map((sources.clock.status === 'available' ? sources.clock.value : []).map(binding =>
        [JSON.stringify([binding.clockId, binding.domain, binding.sourceId]), binding]));
    if (sources.trades.status === 'available') for (const trade of sources.trades.value)
        payloads.set(`engine-trade:${trade.event.eventId}`, { sourceDigest: trade.event.eventDigest, nativeSequence: trade.sequence, record: trade });
    if (sources.production.status === 'available') sources.production.value.receipts.forEach((receipt, index) =>
        payloads.set(`business-production:${receipt.facts.evidence.operationId}`, { sourceDigest: receipt.factsDigest, nativeSequence: index + 1, record: receipt }));
    const events: DashboardEvent[] = graph.evidence.filter(proof => proof.selected).map(proof => {
        check(proof.simulationTime !== null, 'Selected event lacks simulation time');
        const payload = payloads.get(`${proof.channel}:${proof.recordId}`);
        check(payload && payload.sourceDigest === proof.digest && payload.nativeSequence === proof.nativeSequence, 'Native receipt binding differs');
        const associated = [...(incidence.get(proof.id) ?? [])].map(id => nodes.get(id)!);
        const labels = (kind: string) => sorted(associated.filter(node => node.kind === kind).map(node => node.label));
        return { id: proof.id, channel: proof.channel, recordId: proof.recordId, nativeSequence: proof.nativeSequence,
            sourceDigest: proof.digest, wallTime: proof.wallTime, simulationTime: proof.simulationTime,
            agents: labels('agent'), actorReferences: sorted([...labels('actor-reference'), ...labels('player')]), businesses: labels('business'),
            itemIds: [...new Set((eventEdges.get(proof.id) ?? []).flatMap(edge => edge.itemId === null ? [] : [edge.itemId]))].sort((a, b) => a - b),
            region: null, issues: proof.issues };
    }).sort((a, b) => a.simulationTime.localeCompare(b.simulationTime) || a.id.localeCompare(b.id));
    const productionIds = new Set(evaluation.evidence.productionEvents.map(row => row.evidenceId as string));
    const production = events.filter(event => productionIds.has(event.id));
    const byActor = new Map<string, string[]>();
    for (const event of production) for (const actor of event.agents) {
        const ids = byActor.get(actor) ?? []; ids.push(event.id); byActor.set(actor, ids);
    }
    const maximumLoss = risk.scenarios.filter(row => row.targetKind === 'agent' || row.targetKind === 'business')
        .reduce((maximum, row) => Math.max(maximum, row.affectedProductionEventCount), 0);
    const worstWithdrawals = risk.scenarios.filter(row => (row.targetKind === 'agent' || row.targetKind === 'business') && row.affectedProductionEventCount === maximumLoss)
        .sort((a, b) => a.targetNodeId.localeCompare(b.targetNodeId));
    // A maximum is witnessed by one scenario. Unioning tied, disjoint losses would change its numerator.
    const representative = worstWithdrawals[0];
    const riskNumerator = sorted((representative?.affectedEvidenceIds ?? []).filter(id => productionIds.has(id)));
    check(riskNumerator.length === maximumLoss, 'Withdrawal evidence count differs from its metric numerator');
    const metrics = evaluation.calculation.objectives.flatMap(objective => objective.metrics.map(metric => {
        const ids = objective.id === 'specialization' && metric.status === 'observed' ? byActor.get(metric.id.slice('stage-hhi:'.length)) ?? []
            : objective.id === 'systemic-risk' && metric.status === 'observed' ? production.map(event => event.id) : [];
        return { key: `${objective.id}/${metric.id}`, objectiveId: objective.id, metric,
            numeratorEvidenceIds: objective.id === 'systemic-risk' ? riskNumerator : ids, denominatorEvidenceIds: ids,
            numeratorScenario: objective.id === 'systemic-risk' && metric.status === 'observed' && representative
                ? { targetNodeId: representative.targetNodeId, label: representative.label } : null,
            eventCount: ids.length, scope: objective.id === 'systemic-risk' ? evaluation.metricScopes.systemicRisk
                : objective.id === 'specialization' ? evaluation.metricScopes.specialization : 'No complete native event-backed indicator available.' };
    }));
    return { scope, snapshot, evaluation, graph, events, metrics, payloads, clockBindings, incidence, eventEdges, nodes,
        worstWithdrawals: worstWithdrawals.map(row => ({ targetNodeId: row.targetNodeId, label: row.label,
            affectedProductionEventCount: row.affectedProductionEventCount, affectedEvidenceIds: row.affectedEvidenceIds })) };
}
function selection(data: ReturnType<typeof collect>, input: DashboardFilters) {
    const filters = validateFilters(input, data.scope);
    if (filters.snapshot && filters.snapshot !== data.snapshot) throw new SocietyDashboardError('A forrásadat megváltozott. Töltsd újra a riportot és az eseménylistát.', 409);
    const metric = filters.metric === undefined ? undefined : data.metrics.find(row => row.key === filters.metric);
    check(filters.metric === undefined || metric, 'Unknown metric drill-down');
    const allowed = metric ? new Set(metric.denominatorEvidenceIds) : null;
    const dimensions = data.events.filter(event => (!allowed || allowed.has(event.id))
        && (filters.agent === undefined || event.agents.includes(filters.agent))
        && (filters.business === undefined || event.businesses.includes(filters.business))
        && (filters.itemId === undefined || event.itemIds.includes(filters.itemId))
        && (filters.region === undefined || filters.region === 'unknown'));
    const selected = dimensions.filter(event => event.simulationTime > filters.eventFrom && event.simulationTime <= filters.eventTo);
    return { filters, selected, dimensions, metric };
}

export function reportSocietyDashboard(query: EvaluationScope, input: DashboardFilters, options: SocietyEvaluationOptions) {
    // Validate before reading any native source.
    validateFilters(input, validateEvaluationScope(query));
    const data = collect(query, options), { filters, selected, dimensions, metric } = selection(data, input);
    const start = timestamp(data.scope.fromSimulationTime), end = timestamp(data.scope.toSimulationTime);
    const width = Math.ceil((end - start) / 24), count = Math.ceil((end - start) / width);
    const timeline = Array.from({ length: count }, (_, index) => ({ from: new Date(start + width * index).toISOString(),
        to: new Date(Math.min(end, start + width * (index + 1))).toISOString(), eventCount: 0 }));
    for (const event of dimensions) timeline[Math.min(count - 1, Math.floor((timestamp(event.simulationTime) - start - 1) / width))]!.eventCount++;
    const definition = { schemaVersion: 1, artifactKind: 'society-dashboard', snapshot: data.snapshot, scope: data.scope,
        evaluation: data.evaluation,
        metrics: data.metrics.map(({ numeratorEvidenceIds, denominatorEvidenceIds, ...row }) => row),
        facets: { agents: sorted(data.events.flatMap(event => event.agents)), businesses: sorted(data.events.flatMap(event => event.businesses)),
            itemIds: [...new Set(data.events.flatMap(event => event.itemIds))].sort((a, b) => a - b),
            regions: { status: 'unavailable', knownRegionIds: [] as number[], unknownEvents: data.events.length,
                reason: 'Native production/trade receipts have no historical region; no current location is substituted.' } },
        filters, totalMatchingEvents: selected.length, totalWindowEvents: data.events.length,
        page: { offset: filters.offset, limit: filters.limit, nextOffset: filters.offset + filters.limit < selected.length ? filters.offset + filters.limit : null },
        events: selected.slice(filters.offset, filters.offset + filters.limit).map(event => ({ ...event,
            contribution: metric ? { numerator: metric.numeratorEvidenceIds.includes(event.id), denominator: metric.denominatorEvidenceIds.includes(event.id) } : null })),
        timeline, worstWithdrawals: data.worstWithdrawals, sourceCoverage: data.graph.eventCoverage,
        limitations: ['Event filters and pagination never change the base evaluation values or their denominators.',
            'Region is unknown for existing native receipts; a region filter cannot prove regional absence.',
            'Only verified selected production/trade receipts are indexed. Unplaced/invalid/missing channels remain visible in source coverage.',
            'The snapshot binds independently consistent native reads, not a cross-database atomic world snapshot.'] };
    return { ...definition, digest: digest(definition) };
}

export function readSocietyDashboardEvent(query: EvaluationScope, input: DashboardFilters, eventId: string, options: SocietyEvaluationOptions) {
    check(/^evidence:[0-9a-f]{64}$/.test(eventId), 'Invalid native evidence id');
    check(typeof input.snapshot === 'string' && hashPattern.test(input.snapshot), 'Exact event detail requires a snapshot digest');
    validateFilters(input, validateEvaluationScope(query));
    const data = collect(query, options), chosen = selection(data, input), event = chosen.selected.find(row => row.id === eventId);
    if (!event) throw new SocietyDashboardError('Az esemény nem található a kiválasztott riportban és szűrésben.', 404);
    const simulationBinding = data.clockBindings.get(JSON.stringify([data.scope.clockId, event.channel,
        event.channel === 'business-production' ? productionSourceId(event.recordId) : event.recordId]));
    check(simulationBinding && simulationBinding.sourceDigest === event.sourceDigest && simulationBinding.profileDigest === data.scope.clockProfileDigest
        && simulationBinding.simulationTime === event.simulationTime && simulationBinding.wallTime === event.wallTime, 'Native simulation binding differs');
    const definition = { schemaVersion: 1, artifactKind: 'society-native-event-detail', snapshot: data.snapshot, scope: data.scope,
        event, nativeRecord: data.payloads.get(`${event.channel}:${event.recordId}`)!.record, simulationBinding,
        graphEdges: data.eventEdges.get(event.id) ?? [],
        graphNodes: [...(data.incidence.get(event.id) ?? [])].map(id => data.nodes.get(id)!),
        contribution: chosen.metric ? { key: chosen.metric.key, metric: chosen.metric.metric,
            numeratorScenario: chosen.metric.numeratorScenario,
            numerator: chosen.metric.numeratorEvidenceIds.includes(event.id), denominator: chosen.metric.denominatorEvidenceIds.includes(event.id) } : null,
        limitations: ['Native hashes and receipts establish recorded facts, not complete economy coverage or certified physical execution.',
            'No historical region is present. The original receipt is shown without geographic enrichment.'] };
    return { ...definition, digest: digest(definition) };
}
