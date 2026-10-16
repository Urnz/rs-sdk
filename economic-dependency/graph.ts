import { digest, integer, key, hash, time } from '../external-trade/policy.js';
import { check } from '../external-trade/source.js';
import { productionSourceId } from '../production-workflow/evidence.js';
import type { BoundSimulationEventStamp } from '../simulation-clock/types.js';
import type { DependencySources, Observation } from './sources.js';
import type { DependencyQuery, GraphNode, GraphEdge, GraphEvidence } from './types.js';

const id = (kind: string, ...parts: unknown[]) => `${kind}:${digest(parts)}`;
export function validateDependencyQuery(query: DependencyQuery): void {
    time(query.from); time(query.to);
    check(Date.parse(query.from) < Date.parse(query.to) && Number.isSafeInteger(Date.parse(query.to) - Date.parse(query.from)), 'Invalid dependency window');
    check(query.basis === 'wall' || query.basis === 'simulation', 'Invalid dependency time basis');
    if (query.basis === 'simulation') { key(query.clockId); hash(query.clockProfileDigest); }
}
export function buildDependencyGraph(query: DependencyQuery, sources: DependencySources) {
    validateDependencyQuery(query);
    const nodes = new Map<string, GraphNode>(), edges = new Map<string, GraphEdge>(), evidence = new Map<string, GraphEvidence>(),
        diagnostics: Array<{ evidenceId: string; reason: string }> = [], agentTransfers: Array<{ from: string; to: string; itemId: number; quantity: number; evidenceId: string }> = [];
    function node(kind: GraphNode['kind'], identity: unknown, label: string, metadata: Record<string, unknown> = {}) {
        const nodeId = id(kind, identity), prior = nodes.get(nodeId);
        if (!prior) nodes.set(nodeId, { id: nodeId, kind, label, metadata }); return nodeId;
    }
    function edge(from: string, to: string, relation: GraphEdge['relation'], itemId: number | null, quantity: number | null, evidenceId: string) {
        if (quantity !== null) check(integer(quantity) > 0, 'Graph quantity is invalid');
        const edgeId = id('edge', from, to, relation, itemId, evidenceId);
        const value: GraphEdge = { id: edgeId, from, to, relation, itemId, quantity, unit: quantity === null ? null : itemId === 995 ? 'gp' : 'item-units', evidenceId };
        const prior = edges.get(edgeId);
        check(!prior || digest(prior) === digest(value), 'Conflicting duplicate graph edge'); edges.set(edgeId, value);
    }
    function stamp(domain: string, sourceId: string, sourceDigest: string, wallTime: string, tick?: number | null) {
        if (sources.clock.status !== 'available') return null;
        const candidates = sources.clock.value.filter(item => item.domain === domain && item.sourceId === sourceId
            && (query.basis === 'wall' || item.clockId === query.clockId));
        if (candidates.length !== 1) return null;
        const candidate = candidates[0]!;
        if (candidate.sourceDigest !== sourceDigest || candidate.wallTime !== wallTime || (tick !== undefined && candidate.engineTick !== tick)) return null;
        if (query.basis === 'simulation' && candidate.profileDigest !== query.clockProfileDigest) return null;
        return candidate;
    }
    function proof(channel: GraphEvidence['channel'], recordId: string, sourceDigest: string, wallTime: string,
        sequence: number, bound: BoundSimulationEventStamp | null, issues: string[] = []) {
        const evidenceId = id('evidence', channel, recordId), selectedTime = query.basis === 'wall' ? wallTime : bound?.simulationTime;
        const selected = selectedTime !== undefined && Date.parse(selectedTime) > Date.parse(query.from) && Date.parse(selectedTime) <= Date.parse(query.to);
        if (query.basis === 'simulation' && !bound) issues.push('no-verified-simulation-binding');
        const value: GraphEvidence = { id: evidenceId, channel, recordId, digest: sourceDigest, wallTime, simulationTime: bound?.simulationTime ?? null,
            nativeSequence: sequence, selected, issues };
        evidence.set(evidenceId, value); if (!selectedTime) diagnostics.push({ evidenceId, reason: 'unplaced-event' }); return value;
    }
    function participant(username: string, eventWallTime: string, bound: BoundSimulationEventStamp | null, evidenceId: string) {
        const actors = sources.agents.status === 'available' ? sources.agents.value : null;
        const member = bound ? actors?.memberships.filter(row => row.player_username === username && row.simulation_clock_id === bound.clockId
            && row.simulation_clock_profile_digest === bound.profileDigest && Date.parse(row.joined_at_simulation_time) <= Date.parse(bound.simulationTime)
            && Date.parse(row.created_at) <= Date.parse(eventWallTime)
            && (row.reset_at_simulation_time === null || Date.parse(bound.simulationTime) < Date.parse(row.reset_at_simulation_time))) : [];
        const unchanged = actors?.identities.filter(row => row.player_username === username && row.revision === 1 && row.created_at === row.updated_at
            && Date.parse(row.created_at) <= Date.parse(eventWallTime)) ?? [];
        const candidates = member?.length === 1 ? [member[0]!.agent_id] : member && member.length > 1 ? [] : unchanged.map(row => row.agent_id);
        if (new Set(candidates).size === 1 && candidates.length === 1) return node('agent', candidates[0], candidates[0], { identityAuthority: member?.length === 1 ? 'native-population-membership' : 'unchanged-native-identity' });
        diagnostics.push({ evidenceId, reason: `unresolved-historical-agent:${username}` });
        return node('player', username, username, { identityAuthority: 'native-engine-username', agentId: null });
    }
    if (sources.trades.status === 'available') for (const native of sources.trades.value) {
        const e = native.event, bound = stamp('engine-trade', e.eventId, e.eventDigest, e.committedAt, e.tick),
            p = proof('engine-trade', e.eventId, e.eventDigest, e.committedAt, native.sequence, bound);
        if (!p.selected) continue;
        const from = participant(e.fromUsername, e.committedAt, bound, p.id), to = participant(e.toUsername, e.committedAt, bound, p.id);
        for (const [items, sender, receiver, leg] of [[e.fromItems, from, to, 'from'], [e.toItems, to, from, 'to']] as const) {
            const totals = new Map<number, number>();
            for (const item of items) {
                if (item.id === undefined) { p.issues.push('unidentified-traded-item'); diagnostics.push({ evidenceId: p.id, reason: 'unidentified-traded-item' }); continue; }
                totals.set(item.id, integer((totals.get(item.id) ?? 0) + item.count));
            }
            for (const [itemId, quantity] of [...totals].sort(([a], [b]) => a - b)) {
                const flow = node('event', ['trade-flow', e.eventId, leg, itemId], `trade ${e.eventId} ${leg} ${itemId}`, { eventKind: 'committed-player-transfer', evidenceId: p.id });
                edge(sender, flow, 'supplied', itemId, quantity, p.id); edge(flow, receiver, 'received', itemId, quantity, p.id);
                edge(flow, node('product', itemId, String(itemId), { itemId }), 'product-type', itemId, null, p.id);
                agentTransfers.push({ from: sender, to: receiver, itemId, quantity, evidenceId: p.id });
            }
        }
    }
    if (sources.production.status === 'available') {
        const receipts = sources.production.value.receipts, producer = new Map<number, typeof receipts[number]>();
        for (const receipt of receipts) for (const lot of receipt.facts.producedLots) producer.set(lot.materialId, receipt);
        const sourceProof = new Map<string, GraphEvidence>();
        for (const [index, receipt] of receipts.entries()) {
            const f = receipt.facts, candidate = stamp('business-production', productionSourceId(f.evidence.operationId), receipt.factsDigest, f.recordedAt, null),
                bound = receipt.simulationStamp && candidate && digest(candidate) === digest(receipt.simulationStamp) ? candidate : null;
            sourceProof.set(f.evidence.operationId, proof('business-production', f.evidence.operationId, receipt.factsDigest, f.recordedAt, index + 1, bound));
        }
        for (const receipt of receipts) {
            const f = receipt.facts, p = sourceProof.get(f.evidence.operationId)!; if (!p.selected) continue;
            const event = node('event', ['production', f.evidence.operationId], `production ${f.evidence.operationId}`, { eventKind: 'committed-business-wip-step', evidenceId: p.id,
                runId: f.runId, stepId: f.evidence.stepId, recipe: f.plan.steps.find(step => step.stepId === f.evidence.stepId)!.recipe });
            edge(node('business', f.businessId, f.businessId), event, 'production-business', null, null, p.id);
            const knownActor = sources.agents.status === 'available' && sources.agents.value.identities.some(actor => actor.agent_id === f.recordedActorAgentId
                && Date.parse(actor.created_at) <= Date.parse(f.recordedAt));
            if (!knownActor) diagnostics.push({ evidenceId: p.id, reason: `unverified-production-agent:${f.recordedActorAgentId}` });
            edge(node(knownActor ? 'agent' : 'actor-reference', f.recordedActorAgentId, f.recordedActorAgentId,
                { identityAuthority: knownActor ? 'native-agent-id-and-recorded-production-role' : 'native-workflow-reference-only' }), event, 'production-run-actor', null, null, p.id);
            for (const [lots, produced] of [[f.consumedLots, false], [f.producedLots, true]] as const) for (const lot of lots) {
                const origin = producer.get(lot.materialId), originProof = origin ? sourceProof.get(origin.facts.evidence.operationId)! : null;
                const lotNode = node('wip-lot', lot.materialId, `WIP ${lot.materialId}`, { materialId: lot.materialId, itemId: lot.itemId, runId: f.runId,
                    origin: originProof ? originProof.selected ? 'observed-production' : 'observed-production-outside-window'
                        : lot.originStepId === null ? 'reserved-stock-origin-unproven' : 'legacy-production-unverified', originEvidenceId: originProof?.id ?? null });
                edge(lotNode, node('product', lot.itemId, String(lot.itemId), { itemId: lot.itemId }), 'product-type', lot.itemId, null, p.id);
                edge(produced ? event : lotNode, produced ? lotNode : event, produced ? 'produced-wip' : 'consumed-wip', lot.itemId, lot.quantity, p.id);
            }
        }
    }
    check(nodes.size <= 100000 && edges.size <= 200000 && evidence.size <= 100000, 'Dependency graph exceeds limits; no partial sampling');
    const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    const view = (source: Observation<unknown>) => source.status === 'available' ? { status: source.status, snapshotDigest: source.digest } : source;
    const sourceViews = { trades: view(sources.trades), production: view(sources.production), agents: view(sources.agents), clock: view(sources.clock) };
    const definition = { schemaVersion: 1, artifactKind: 'observed-economic-dependency-graph', scope: query, eventBounds: '(start,end]',
        nodes: nodeList, edges: edgeList, evidence: [...evidence.values()].sort((a, b) => a.id.localeCompare(b.id)), diagnostics: diagnostics.sort((a, b) => digest(a).localeCompare(digest(b))),
        participantTransfers: agentTransfers.sort((a, b) => digest(a).localeCompare(digest(b))),
        projections: { agents: { nodeIds: nodeList.filter(node => node.kind === 'agent').map(node => node.id),
            transfers: agentTransfers.filter(transfer => nodes.get(transfer.from)!.kind === 'agent' && nodes.get(transfer.to)!.kind === 'agent') },
            businesses: { nodeIds: nodeList.filter(node => node.kind === 'business').map(node => node.id), incidenceEdgeIds: edgeList.filter(edge => edge.relation === 'production-business').map(edge => edge.id) },
            products: { nodeIds: nodeList.filter(node => node.kind === 'product').map(node => node.id), classificationIsNotCausalFlow: true } },
        sources: sourceViews, legacyUnlinkedProductionSteps: sources.production.status === 'available' ? sources.production.value.legacyStepCount : sources.production.unverifiedRows ?? null,
        eventCoverage: { selected: [...evidence.values()].filter(item => item.selected).length,
            unplaced: diagnostics.filter(item => item.reason === 'unplaced-event').length,
            totalSourceEvents: evidence.size },
        measurementStatus: sources.trades.status !== 'available' && sources.production.status !== 'available' ? 'unavailable' : 'partial-observed-channels',
        provesSelfSufficiency: false, completeEconomyCoverage: false,
        limitations: ['Product-type classification is not lot lineage. Trade receipt quantities are not proof of production or final use.',
            'Production-run actor is the recorded responsible actor, not a certified physical skill executor.',
            'No Business ownership is inferred from employment or item names; no criticality, failure simulation or concentration metrics.',
            'Reserved stock origin and cross-run/inter-Business material lineage remain unproven.',
            'Sources are independent consistent snapshots; graph is not a global atomic world snapshot or an all-channel completeness certificate.'] };
    return { ...definition, digest: digest(definition) };
}
