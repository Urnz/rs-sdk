import { digest, integer } from '../external-trade/policy.js';
import { check } from '../external-trade/source.js';
import type { buildDependencyGraph } from './graph.js';
import type { GraphEdge, GraphNode } from './types.js';

type Graph = ReturnType<typeof buildDependencyGraph>;
type Target = GraphNode & { kind: 'agent' | 'business' | 'product' };
interface LotLink { producerEventId: string; consumerEventId: string; lotNodeId: string; itemId: number; quantity: number; evidenceId: string }
const sorted = (values: Iterable<string>) => [...values].sort();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ratio = (numerator: bigint, denominator: bigint) => ({ numerator: String(numerator), denominator: String(denominator),
    approximate: Number(numerator) / Number(denominator) });

/** Internal derivation over a freshly verified native graph, not an authority for user-supplied JSON. */
export function analyzeEconomicDependencies(graph: Graph) {
    const { digest: graphDigest, ...definition } = graph;
    check(graph.artifactKind === 'observed-economic-dependency-graph' && digest(definition) === graphDigest, 'Dependency artifact digest differs');
    const nodes = new Map(graph.nodes.map(node => [node.id, node])), evidence = new Map(graph.evidence.map(item => [item.id, item]));
    check(nodes.size === graph.nodes.length && evidence.size === graph.evidence.length, 'Duplicate dependency identity');
    const production = new Map(graph.nodes.filter(node => node.kind === 'event' && node.metadata.eventKind === 'committed-business-wip-step').map(node => [node.id, node]));
    const trades = new Map(graph.nodes.filter(node => node.kind === 'event' && node.metadata.eventKind === 'committed-player-transfer').map(node => [node.id, node]));
    const outputs = new Map<string, GraphEdge[]>(), inputs = new Map<string, GraphEdge[]>(), tradeFlows = new Map<string, GraphEdge>(),
        business = new Map<string, string>(), actor = new Map<string, string>(), participants = new Map<string, Set<string>>(),
        producer = new Map<string, GraphEdge>();
    const add = (map: Map<string, GraphEdge[]>, id: string, edge: GraphEdge) => map.set(id, [...(map.get(id) ?? []), edge]);
    for (const edge of graph.edges) {
        const from = nodes.get(edge.from), to = nodes.get(edge.to), proof = evidence.get(edge.evidenceId);
        check(from && to && proof?.selected, 'Dependency edge is dangling or outside selected evidence');
        if (edge.quantity !== null) check(integer(edge.quantity) > 0 && edge.itemId !== null, 'Invalid dependency quantity');
        if (edge.relation === 'produced-wip') {
            check(production.has(edge.from) && to.kind === 'wip-lot' && !producer.has(edge.to), 'WIP producer is invalid or duplicated');
            producer.set(edge.to, edge); add(outputs, edge.from, edge);
        } else if (edge.relation === 'consumed-wip') {
            check(from.kind === 'wip-lot' && production.has(edge.to), 'WIP consumer is invalid'); add(inputs, edge.to, edge);
        } else if (edge.relation === 'production-business' || edge.relation === 'production-run-actor') {
            const map = edge.relation === 'production-business' ? business : actor;
            check(production.has(edge.to) && !map.has(edge.to) && (edge.relation === 'production-business' ? from.kind === 'business'
                : from.kind === 'agent' || from.kind === 'actor-reference'), 'Production role is invalid or duplicated'); map.set(edge.to, edge.from);
        } else if (edge.relation === 'supplied' || edge.relation === 'received') {
            const eventId = edge.relation === 'supplied' ? edge.to : edge.from, participant = edge.relation === 'supplied' ? from : to;
            check(trades.has(eventId) && ['agent', 'player'].includes(participant.kind), 'Trade participant is invalid');
            if (!participants.has(eventId)) participants.set(eventId, new Set()); participants.get(eventId)!.add(participant.id);
            if (edge.relation === 'supplied') { check(!tradeFlows.has(eventId), 'Duplicate trade quantity'); tradeFlows.set(eventId, edge); }
        }
    }
    for (const eventId of production.keys()) check(business.has(eventId) && actor.has(eventId) && outputs.has(eventId), 'Production incidence is incomplete');
    for (const eventId of trades.keys()) check(tradeFlows.has(eventId) && participants.get(eventId)?.size === 2, 'Trade incidence is incomplete');

    const links: LotLink[] = [], boundaryInputs: Array<{ eventNodeId: string; lotNodeId: string; itemId: number; quantity: string; origin: unknown }> = [];
    const children = new Map<string, LotLink[]>(), parents = new Map<string, Set<string>>();
    for (const [eventId, values] of inputs) for (const edge of values) {
        const origin = producer.get(edge.from);
        if (origin) {
            check(origin.itemId === edge.itemId && origin.quantity !== null && edge.quantity !== null && origin.quantity >= edge.quantity, 'WIP link quantity differs');
            const link = { producerEventId: origin.from, consumerEventId: eventId, lotNodeId: edge.from,
                itemId: edge.itemId!, quantity: edge.quantity, evidenceId: edge.evidenceId };
            links.push(link); if (!children.has(origin.from)) children.set(origin.from, []); children.get(origin.from)!.push(link);
            if (!parents.has(eventId)) parents.set(eventId, new Set()); parents.get(eventId)!.add(origin.from);
        } else boundaryInputs.push({ eventNodeId: eventId, lotNodeId: edge.from, itemId: edge.itemId!, quantity: String(edge.quantity), origin: nodes.get(edge.from)!.metadata.origin });
    }
    // Iterative topological traversal: no recursion, no product-type or trade resale joins.
    const indegree = new Map([...production.keys()].map(id => [id, parents.get(id)?.size ?? 0]));
    const ready = sorted([...indegree].filter(([, count]) => count === 0).map(([id]) => id)), order: string[] = [], depths = new Map<string, number>();
    for (let cursor = 0; cursor < ready.length; cursor++) {
        const eventId = ready[cursor]!, depth = depths.get(eventId) ?? 1; depths.set(eventId, depth); order.push(eventId);
        const successors = new Set((children.get(eventId) ?? []).map(link => link.consumerEventId));
        for (const child of sorted(successors)) {
            depths.set(child, Math.max(depths.get(child) ?? 1, depth + 1)); indegree.set(child, indegree.get(child)! - 1);
            if (indegree.get(child) === 0) ready.push(child);
        }
    }
    check(order.length === production.size, 'Cyclic production lineage; risk is not measurable');
    const targets = graph.nodes.filter((node): node is Target => ['agent', 'business', 'product'].includes(node.kind)).sort((a, b) => compare(a.id, b.id));
    check(targets.length <= 2048 && targets.length * (graph.edges.length + links.length + production.size + trades.size) <= 20000000,
        'Economic risk exceeds work limits; no partial ranking or sampling');

    function quantities(values: GraphEdge[]) {
        const totals = new Map<number, { quantity: bigint; evidenceIds: Set<string> }>();
        for (const edge of values) {
            const itemId = edge.itemId!, value = totals.get(itemId) ?? { quantity: 0n, evidenceIds: new Set<string>() };
            value.quantity += BigInt(edge.quantity!); value.evidenceIds.add(edge.evidenceId); totals.set(itemId, value);
        }
        return [...totals].sort(([a], [b]) => a - b).map(([itemId, value]) => ({ itemId, unit: itemId === 995 ? 'gp' : 'item-units',
            quantity: String(value.quantity), evidenceIds: sorted(value.evidenceIds) }));
    }
    let traceSize = 0;
    const scenarios = targets.map(target => {
        const direct = new Set<string>(), lostTrades = new Set<string>();
        for (const eventId of production.keys()) if (target.kind === 'business' ? business.get(eventId) === target.id
            : target.kind === 'agent' ? actor.get(eventId) === target.id
                : (inputs.get(eventId) ?? []).some(edge => edge.itemId === target.metadata.itemId)) direct.add(eventId);
        const canceledReceipts = new Set<string>();
        for (const [eventId, flow] of tradeFlows) if (target.kind === 'agent' ? participants.get(eventId)!.has(target.id)
            : target.kind === 'product' && flow.itemId === target.metadata.itemId) canceledReceipts.add(flow.evidenceId);
        for (const [eventId, flow] of tradeFlows) if (canceledReceipts.has(flow.evidenceId)) lostTrades.add(eventId);
        const affected = new Set(direct), causes: LotLink[] = [];
        for (const eventId of order) if (affected.has(eventId)) for (const link of children.get(eventId) ?? []) {
            affected.add(link.consumerEventId); causes.push(link);
        }
        const propagated = new Set([...affected].filter(id => !direct.has(id))), affectedEvidenceIds = new Set<string>();
        for (const id of [...affected, ...lostTrades]) affectedEvidenceIds.add(nodes.get(id)!.metadata.evidenceId as string);
        traceSize += affected.size + lostTrades.size + causes.length;
        check(traceSize <= 1000000, 'Economic risk trace exceeds limit; no partial scenarios');
        return { targetNodeId: target.id, targetKind: target.kind, label: target.label,
            model: target.kind === 'product' ? 'withdraw-product-inputs-and-atomic-trades' : 'withdraw-recorded-role-events',
            directProductionEventIds: sorted(direct), propagatedProductionEventIds: sorted(propagated), canceledTradeFlowIds: sorted(lostTrades),
            affectedProductionEventCount: affected.size, propagatedProductionEventCount: propagated.size,
            canceledTradeReceiptCount: new Set([...lostTrades].map(id => nodes.get(id)!.metadata.evidenceId)).size,
            affectedEvidenceIds: sorted(affectedEvidenceIds), propagationLinks: causes.sort((a, b) => compare(digest(a), digest(b))),
            lostProductionByProduct: quantities([...affected].flatMap(id => outputs.get(id) ?? [])),
            canceledTransfersByProduct: quantities([...lostTrades].map(id => tradeFlows.get(id)!)) };
    });

    const productionAvailable = graph.sources.production.status === 'available';
    const productionMetricsStatus = !productionAvailable ? 'unavailable' : production.size === 0 ? 'no-observed-production' : 'observed-window-only';
    const products = graph.nodes.filter(node => node.kind === 'product').sort((a, b) => Number(a.metadata.itemId) - Number(b.metadata.itemId)).map(product => {
        const itemId = product.metadata.itemId as number, businessTotals = new Map<string, bigint>(), agentTotals = new Map<string, bigint>(), proofs = new Set<string>();
        let total = 0n, unattributed = 0n;
        for (const [eventId, values] of outputs) for (const edge of values) if (edge.itemId === itemId) {
            const count = BigInt(edge.quantity!), owner = business.get(eventId)!, responsible = actor.get(eventId)!;
            total += count; businessTotals.set(owner, (businessTotals.get(owner) ?? 0n) + count); proofs.add(edge.evidenceId);
            if (nodes.get(responsible)!.kind === 'agent') agentTotals.set(responsible, (agentTotals.get(responsible) ?? 0n) + count); else unattributed += count;
        }
        function concentration(totals: Map<string, bigint>) {
            if (total === 0n) return null;
            const squares = [...totals.values()].reduce((sum, quantity) => sum + quantity * quantity, 0n), maximum = [...totals.values()].reduce((a, b) => a > b ? a : b, 0n);
            return { producerCount: totals.size, hhi: ratio(squares, total * total), largestShare: ratio(maximum, total),
                producers: sorted(totals.keys()).map(nodeId => ({ nodeId, quantity: String(totals.get(nodeId)), share: ratio(totals.get(nodeId)!, total) })) };
        }
        const consumers = [...inputs].filter(([, values]) => values.some(edge => edge.itemId === itemId)).map(([eventId]) => eventId),
            linkedConsumers = new Set(links.filter(link => link.itemId === itemId).map(link => link.consumerEventId));
        return { productNodeId: product.id, itemId, unit: itemId === 995 ? 'gp' : 'item-units',
            producedQuantity: productionAvailable ? String(total) : null, productionEvidenceIds: sorted(proofs),
            consumedQuantity: productionAvailable ? quantities([...inputs.values()].flat().filter(edge => edge.itemId === itemId))[0]?.quantity ?? '0' : null,
            consumerEventIds: sorted(consumers), verifiedLotConsumerEventIds: sorted(linkedConsumers),
            businessConcentration: productionAvailable ? concentration(businessTotals) : null,
            registeredResponsibleAgentConcentration: productionAvailable && unattributed === 0n ? concentration(agentTotals) : null,
            unattributedResponsibleActorQuantity: productionAvailable ? String(unattributed) : null,
            singlePointOfFailure: { status: !productionAvailable ? 'unavailable' : total === 0n ? 'no-observed-producer'
                : businessTotals.size === 1 && linkedConsumers.size > 0 ? 'observed-single-producer-candidate'
                    : businessTotals.size > 1 ? 'multiple-observed-producers' : 'no-verified-downstream-lot-use',
                soleProducingBusinessNodeId: businessTotals.size === 1 ? sorted(businessTotals.keys())[0]! : null,
                globalVerdict: 'unknown' } };
    });
    const rank = (kind: Target['kind']) => scenarios.filter(row => row.targetKind === kind).sort((a, b) => b.affectedProductionEventCount - a.affectedProductionEventCount
        || b.canceledTradeReceiptCount - a.canceledTradeReceiptCount || compare(a.targetNodeId, b.targetNodeId))
        .map(row => ({ targetNodeId: row.targetNodeId, label: row.label, affectedProductionEventCount: row.affectedProductionEventCount,
            propagatedProductionEventCount: row.propagatedProductionEventCount, canceledTradeReceiptCount: row.canceledTradeReceiptCount }));
    const artifact = { schemaVersion: 1, artifactKind: 'observed-economic-structural-risk', dependencyGraph: graph,
        model: { version: 1, scope: 'selected-window-recorded-event-withdrawal', propagation: 'exact-wip-lot-only',
            stepFailure: 'any-withdrawn-required-lot-blocks-entire-recorded-step', alternatives: 'no-substitution-stock-buffer-or-adaptation-model',
            tradePropagation: 'no-resale-lineage', tradeAtomicity: 'any-withdrawn-leg-cancels-all-recorded-receipt-flows',
            productFailure: 'unavailable-inputs-and-atomic-trades-containing-that-product',
            depthUnit: 'production-stages-including-first-observed-stage', ranking: 'production-event-count-then-native-trade-receipt-count',
            actorRole: 'recorded-responsible-run-actor-not-certified-physical-executor' },
        measurementStatus: graph.measurementStatus, productionMetricsStatus, completeEconomyCoverage: false, predictsFutureOutage: false,
        products, singlePointOfFailureProducts: products.filter(row => row.singlePointOfFailure.status === 'observed-single-producer-candidate').map(row => row.productNodeId),
        supplyChain: { status: productionMetricsStatus, maximumObservedProductionStages: production.size ? [...depths.values()].reduce((a, b) => Math.max(a, b), 0) : null,
            fullChainDepthKnown: false, eventDepths: sorted(production.keys()).map(eventNodeId => ({ eventNodeId, stages: depths.get(eventNodeId)!,
                parentEventIds: sorted(parents.get(eventNodeId) ?? []), evidenceId: nodes.get(eventNodeId)!.metadata.evidenceId })),
            boundaryInputs: boundaryInputs.sort((a, b) => compare(digest(a), digest(b))), links: links.sort((a, b) => compare(digest(a), digest(b))) },
        criticalActors: { agents: rank('agent'), businesses: rank('business') }, productWithdrawalRanking: rank('product'), scenarios,
        limitations: ['All values describe observed channels in the selected window, not population-wide capacity or future demand.',
            'A single observed producing Business is a candidate, not proof of a global single point of failure; other suppliers remain unknown.',
            'Depth is the longest selected, verified WIP production path; unknown stock origin and window boundaries censor the full chain.',
            'Concentration uses gross produced units per item, including intermediates, not sales, net output, wealth or physical worker productivity.',
            'Outages withdraw recorded events for the entire window; existing inventories, replacement actors, alternate recipes and trade substitution are not simulated.',
            'Classification, money payments and matching item IDs never create causal lineage between trades or between production and sales.'] };
    return { ...artifact, digest: digest(artifact) };
}
