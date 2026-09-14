import { AgentStateStore } from '../../../agent-state/store.js';
import type { AgentAutonomyEnrollment, AgentPlayerActionRequest } from '../../../agent-state/types.js';
import type { LlmReplanEvent, LlmReplanEventType } from '../../../llm-runtime/events.js';
import { BusinessManagerStore, type Business } from './business-manager.js';
import { EconomicContractStore, type EconomicContract } from './economic-contracts.js';
import { GovernancePolicyStore } from './governance-policy.js';
import { GovernanceStore } from './governance.js';
import { ReplanInboxStore } from './replan-inbox.js';
import type { ReplanInboxSimulationClock } from './replan-inbox.js';
import { WorldDirectorStore } from './world-director-runtime.js';
import { BUILTIN_WORLD_EVENT_TEMPLATES } from './world-director.js';
import type { AdminPropertyList, AdminPropertyView } from './properties.js';
import { agentStateDbPath, businessManagerDbPath, economicContractsDbPath, governanceDbPath,
    worldDirectorDbPath } from './paths.js';

export interface DomainWakeupPaths {
    agentPath?: string;
    businessPath?: string;
    contractsPath?: string;
    governancePath?: string;
    worldDirectorPath?: string;
    simulationClock?: ReplanInboxSimulationClock;
}

export interface DomainWakeupRecoveryResult { scanned: number; created: number; existing: number }

interface EnrolledAgent { enrollment: AgentAutonomyEnrollment; profile: ReturnType<AgentStateStore['getControlProfile']> }

function timestampOfContract(value: EconomicContract): string {
    return [value.resolvedAt, value.fulfilledAt, ...value.evidence.map(item => item.recordedAt),
        ...value.settlements.map(item => item.updatedAt), ...value.playerEscrows.map(item => item.updatedAt),
        value.acceptedAt].filter((item): item is string => !!item).sort().at(-1)!;
}

function add(output: LlmReplanEvent[], enrollment: AgentAutonomyEnrollment, type: LlmReplanEventType,
    sourceKey: string, occurredAt: string, summary: string): void {
    if (occurredAt < enrollment.createdAt) return;
    // Revisions are unique only inside one restored domain generation. Including
    // the authoritative timestamp keeps replay idempotent while allowing a fully
    // rolled-back fixture generation to reuse the same logical ids safely.
    output.push({ eventId: crypto.randomUUID(), agentId: enrollment.agentId, type,
        sourceKey: `${sourceKey}:at:${occurredAt}`, occurredAt, summary });
}

function actionSummary(action: AgentPlayerActionRequest): string {
    return `Player action ${action.requestId} is ${action.status} at revision ${action.revision}.`;
}

/** Reconstructs meaningful domain wakeups from authoritative durable state after a crash or restart. */
export function recoverDomainEventWakeups(inboxPath: string, paths: DomainWakeupPaths = {},
    propertyState: AdminPropertyList | readonly AdminPropertyView[] = []): DomainWakeupRecoveryResult {
    const agentPath = paths.agentPath ?? agentStateDbPath;
    const agents = new AgentStateStore(agentPath, paths.simulationClock);
    const enrollments = agents.listAutonomyEnrollments()
        .filter(item => item.status === 'desired' || item.status === 'running');
    const enrolled = new Map(enrollments.map(enrollment => [enrollment.agentId,
        { enrollment, profile: agents.getControlProfile(enrollment.agentId) } satisfies EnrolledAgent]));
    const events: LlmReplanEvent[] = [];
    try {
        const contracts = new EconomicContractStore(paths.contractsPath ?? economicContractsDbPath);
        try {
            for (const offer of contracts.listOffers(500)) {
                const targets = offer.status === 'open' ? [offer.counterpartyAgentId]
                    : [offer.creatorAgentId, offer.counterpartyAgentId];
                for (const target of targets) {
                    const item = enrolled.get(target); if (!item) continue;
                    add(events, item.enrollment, offer.status === 'open' ? 'offer-received' : 'economic-contract-changed',
                        `economic-offer:${offer.offerId}:revision:${offer.revision}`, offer.updatedAt,
                        `Economic offer ${offer.offerId} is ${offer.status} at revision ${offer.revision}.`);
                }
            }
            for (const contract of contracts.listContracts(500)) for (const target of [contract.partyAAgentId, contract.partyBAgentId]) {
                const item = enrolled.get(target); if (!item) continue;
                const occurredAt = timestampOfContract(contract);
                add(events, item.enrollment, 'economic-contract-changed',
                    `economic-contract:${contract.contractId}:revision:${contract.revision}`, occurredAt,
                    `Economic contract ${contract.contractId} is ${contract.status} at revision ${contract.revision}.`);
            }
        } finally { contracts.close(); }

        const seenActions = new Set<string>();
        for (const item of enrolled.values()) for (const action of agents.listPlayerActionRequests(item.enrollment.agentId)) {
            const dedupe = `${item.enrollment.agentId}:${action.requestId}:${action.revision}`;
            if (seenActions.has(dedupe)) continue; seenActions.add(dedupe);
            add(events, item.enrollment, 'player-action-changed',
                `player-action:${action.requestId}:revision:${action.revision}`, action.updatedAt, actionSummary(action));
        }

        const businesses = new BusinessManagerStore(paths.businessPath ?? businessManagerDbPath);
        let businessValues: Business[] = [];
        try {
            businessValues = businesses.list(500);
            for (const business of businessValues) collectBusinessEvents(events, enrolled, agents, business);
        } finally { businesses.close(); }

        const governance = new GovernanceStore(paths.governancePath ?? governanceDbPath);
        const policies = new GovernancePolicyStore(paths.governancePath ?? governanceDbPath);
        try {
            for (const item of enrolled.values()) {
                if (item.profile?.subjectKind !== 'faction') continue;
                const faction = governance.getFaction(item.profile.subjectId);
                if (!faction) continue;
                add(events, item.enrollment, 'governance-changed',
                    `faction:${faction.factionId}:revision:${faction.revision}`, faction.updatedAt,
                    `Faction ${faction.factionId} is ${faction.status} at revision ${faction.revision}.`);
                for (const budget of governance.listBudgets(faction.factionId)) {
                    add(events, item.enrollment, 'governance-changed',
                        `governance-budget:${budget.budgetId}:revision:${budget.revision}`, budget.updatedAt,
                        `Governance budget ${budget.budgetId} is ${budget.status} at revision ${budget.revision}.`);
                }
                for (const jurisdiction of governance.listJurisdictions(faction.factionId, 100)) {
                    for (const policy of policies.listForJurisdiction(jurisdiction.jurisdictionId, 100)) {
                        add(events, item.enrollment, 'governance-changed',
                            `governance-policy:${policy.policyId}:revision:${policy.revision}`, policy.updatedAt,
                            `Governance policy ${policy.policyId} is ${policy.status} at revision ${policy.revision}.`);
                    }
                }
            }
        } finally { policies.close(); governance.close(); }

        const propertyList: AdminPropertyList = 'properties' in propertyState ? propertyState
            : { enabled: true, properties: [...propertyState], pendingPurchases: [] };
        const properties = propertyList.properties;
        const purchases = propertyList.pendingPurchases;
        for (const property of properties) for (const item of enrolled.values()) {
            const links = agents.listEconomicActorLinks(item.enrollment.agentId);
            const directlyRelevant = !!property.state.owner && links.some(link =>
                link.actorKind === property.state.owner!.kind && link.actorId === property.state.owner!.id);
            const businessRelevant = businessValues.some(business => business.propertyId === property.propertyId
                && (business.ownerAgentId === item.enrollment.agentId
                    || business.employments.some(employment => employment.workerAgentId === item.enrollment.agentId)));
            if (!directlyRelevant && !businessRelevant) continue;
            add(events, item.enrollment, 'property-changed',
                `property:${property.propertyId}:version:${property.state.version}`, property.state.updatedAt,
                `Property ${property.propertyId} is ${property.state.status} at version ${property.state.version}.`);
        }
        for (const purchase of purchases) for (const item of enrolled.values()) {
            const relevant = agents.listEconomicActorLinks(item.enrollment.agentId).some(link =>
                link.actorKind === purchase.buyer.kind && link.actorId === purchase.buyer.id);
            if (relevant) add(events, item.enrollment, 'property-changed',
                `property-purchase:${purchase.transactionId}:${purchase.status}`, purchase.updatedAt,
                `Property purchase ${purchase.transactionId} is ${purchase.status}.`);
        }

        const world = new WorldDirectorStore(paths.worldDirectorPath ?? worldDirectorDbPath, paths.simulationClock);
        try {
            const allowlist = new Set(BUILTIN_WORLD_EVENT_TEMPLATES.filter(item => item.status === 'approved')
                .map(item => `${item.templateId}@${item.version}`));
            for (const entry of world.listOutbox(500).filter(item => item.status === 'delivered'
                && allowlist.has(`${item.signal.templateId}@${item.signal.templateVersion}`))) {
                for (const item of enrolled.values()) {
                    const region = agents.getWorkingMemory(item.enrollment.agentId)?.location?.region?.toLowerCase();
                    if (!entry.signal.regions.includes('global') && (!region || !entry.signal.regions.includes(region))) continue;
                    add(events, item.enrollment, 'allowlisted-world-event',
                        `world-director:${entry.signal.eventId}:revision:${entry.revision}`, entry.updatedAt,
                        `${entry.signal.title}: ${entry.signal.summary}`);
                }
            }
        } finally { world.close(); }
    } finally { agents.close(); }

    if (events.length > 10_000) throw new Error('Domain wakeup recovery exceeds the bounded event limit');
    const inbox = new ReplanInboxStore(inboxPath, paths.simulationClock);
    const result = { scanned: events.length, created: 0, existing: 0 };
    try {
        for (const event of events) inbox.enqueue(event, event.occurredAt).created ? result.created++ : result.existing++;
        return result;
    } finally { inbox.close(); }
}

function collectBusinessEvents(events: LlmReplanEvent[], enrolled: Map<string, EnrolledAgent>,
    agents: AgentStateStore, business: Business): void {
    for (const employment of business.employments) {
        const worker = enrolled.get(employment.workerAgentId); if (!worker) continue;
        add(events, worker.enrollment, 'business-work-available',
            `business-employment:${employment.employmentId}:revision:${employment.revision}`, employment.updatedAt,
            `Employment ${employment.employmentId} is ${employment.status} at ${business.businessId}.`);
        if (employment.status !== 'active' || !business.activePolicy) continue;
        for (const action of agents.listPlayerActionRequests(employment.workerAgentId, 'incoming')
            .filter(action => action.requesterAgentId === business.ownerAgentId
                && (action.status === 'pending' || action.status === 'accepted'))) {
            add(events, worker.enrollment, 'business-work-available',
                `business-work-order:${business.businessId}:${business.activePolicy.proposalId}:${action.requestId}:revision:${action.revision}`,
                action.updatedAt, `Work order ${action.requestId} is available under approved policy ${business.activePolicy.proposalId}.`);
        }
    }
    if (business.activePolicy) {
        const owner = enrolled.get(business.ownerAgentId);
        if (owner) add(events, owner.enrollment, 'business-work-available',
            `business-policy:${business.activePolicy.proposalId}:revision:${business.activePolicy.revision}`,
            business.activePolicy.updatedAt, `Business policy ${business.activePolicy.proposalId} is approved.`);
    }
}
