import type { AgentAssetPortfolio, AgentCommitment, AgentEconomicActorKind, AgentEconomicActorLink,
    AgentMoneyAsset, AgentPropertyAsset, AgentRelationship } from './types.js';
import { normalizeEconomicActorId } from './validation.js';

export interface AgentMoneyObservation extends AgentMoneyAsset {
    actor: { kind: AgentEconomicActorKind; id: string };
}

export interface AgentPropertyObservation {
    propertyId: string;
    displayName: string;
    type: string;
    region: string;
    acquiredAt: string | null;
    stateVersion: number;
    owner: { kind: AgentEconomicActorKind; id: string };
}

export interface AgentAssetSources {
    observedAt?: string;
    money?: readonly AgentMoneyObservation[];
    properties?: readonly AgentPropertyObservation[];
    unavailableSources?: readonly string[];
}

function actorKey(kind: AgentEconomicActorKind, id: string): string {
    return `${kind}:${normalizeEconomicActorId(id)}`;
}

function safeGp(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
        throw new Error(`${field} must be a non-negative GP integer`);
    }
    return value;
}

export function resolveAgentAssets(
    actorLinks: readonly AgentEconomicActorLink[],
    relationships: readonly AgentRelationship[],
    commitments: readonly AgentCommitment[],
    sources: AgentAssetSources = {}
): AgentAssetPortfolio {
    const observedAt = sources.observedAt ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(observedAt))) throw new Error('Asset observation time must be an ISO timestamp');
    const linkedActors = new Set(actorLinks.map(link => actorKey(link.actorKind, link.actorId)));
    const moneyCandidates = (sources.money ?? []).filter(item => linkedActors.has(actorKey(item.actor.kind, item.actor.id)))
        .sort((left, right) => Number(right.freshness === 'fresh') - Number(left.freshness === 'fresh')
            || right.observedAt.localeCompare(left.observedAt) || left.actor.id.localeCompare(right.actor.id));
    const money = moneyCandidates[0] ? {
        balanceGp: safeGp(moneyCandidates[0].balanceGp, 'balanceGp'),
        observedAt: moneyCandidates[0].observedAt,
        source: moneyCandidates[0].source,
        freshness: moneyCandidates[0].freshness
    } satisfies AgentMoneyAsset : null;
    if (money && Number.isNaN(Date.parse(money.observedAt))) throw new Error('Money observation time must be an ISO timestamp');

    const properties = (sources.properties ?? []).filter(item => linkedActors.has(actorKey(item.owner.kind, item.owner.id)))
        .map(item => ({ ...item, owner: { kind: item.owner.kind, id: normalizeEconomicActorId(item.owner.id) } }))
        .sort((left, right) => left.propertyId.localeCompare(right.propertyId)) satisfies AgentPropertyAsset[];
    const open = commitments.filter(item => item.status === 'open');
    const financialPosition = {
        receivablesGp: relationships.reduce((sum, item) => sum + safeGp(item.actorOwesGp, 'actorOwesGp'), 0),
        liabilitiesGp: relationships.reduce((sum, item) => sum + safeGp(item.agentOwesGp, 'agentOwesGp'), 0),
        openCommitmentReceivablesGp: open.filter(item => item.direction === 'owed-to-agent')
            .reduce((sum, item) => sum + safeGp(item.valueGp ?? 0, 'commitment.valueGp'), 0),
        openCommitmentLiabilitiesGp: open.filter(item => item.direction === 'owed-by-agent')
            .reduce((sum, item) => sum + safeGp(item.valueGp ?? 0, 'commitment.valueGp'), 0)
    };
    return { observedAt, actorLinks: [...actorLinks], money, properties, financialPosition,
        unavailableSources: [...new Set(sources.unavailableSources ?? [])].sort() };
}
