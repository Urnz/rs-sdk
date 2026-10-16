import type { AgentStateStore } from '../agent-state/store.js';
import type { RightsViolationStore } from '../rights-violations/store.js';
import { recordEngineHousingEntryTrace } from '../housing/engine-entry-trace.js';
import type { HousingTraceRollStore } from '../housing/trace-roll-store.js';
import type { HousingEffectPolicy, HousingSecurityPolicy, HousingTierPolicy,
    HousingUnitCatalog } from '../housing/types.js';
import type { PropertyCatalog } from '../server/engine/src/mods/Properties.js';
import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome } from './engine-bridge.js';
import { projectPropertyEntryViolation } from './property-rights.js';
import type { ThievingProcedureStore } from './store.js';
import { projectThievingWitnessOpportunities, type WitnessAttentionPolicy } from './witness-attention.js';
import type { WitnessAttentionDecisionStore } from './witness-decision-store.js';

export interface ThievingEventProcessorDependencies {
    source: ThievingEvidenceStore;
    thieving: ThievingProcedureStore;
    agents: AgentStateStore;
    rights: RightsViolationStore;
    witnessDecisions: WitnessAttentionDecisionStore;
    traceRolls: HousingTraceRollStore;
    properties: PropertyCatalog;
    units: HousingUnitCatalog;
    hierarchy: HousingTierPolicy;
    effects: HousingEffectPolicy;
    securityPolicy: HousingSecurityPolicy;
    witnessPolicy: WitnessAttentionPolicy;
}
export interface ProcessedThievingEvent {
    sequence: number;
    eventId: string;
    outcomeReceiptId: string;
    traceDiscovered: boolean | null;
    noticedObservers: string[];
    playerOnlyObservers: string[];
    rightsProjection: 'not-required' | 'recorded' | 'unbound-player-owner';
}
export interface SkippedThievingEvent {
    sequence: number;
    eventId: string;
    sourceEvidenceDigest: string;
    reason: 'unbound-actor';
}
export interface ThievingBatchResult {
    nextSequence: number;
    processed: ProcessedThievingEvent[];
    skipped: SkippedThievingEvent[];
    /** Retained for callers from cursor v1; v2 never blocks the global prefix. */
    blockedEventId: string | null;
}

/** Uses the actual player control profile, never a coincidental username as an agent id. */
export function resolveBoundAvatarAgent(agents: AgentStateStore, username: string): string | null {
    const normalized = username.toLowerCase();
    const identity = agents.listIdentities().find(value => value.playerUsername === normalized);
    if (!identity) return null;
    const profile = agents.getControlProfile(identity.agentId);
    return profile?.role === 'player' && profile.subjectKind === 'player'
        && profile.avatarPlayerUsername === normalized && profile.subjectId === normalized
        ? identity.agentId : null;
}

/** Processes a bounded engine-event page; callers may persist nextSequence and retry safely after a crash. */
export function processEngineThievingBatch(deps: ThievingEventProcessorDependencies,
    afterSequence: number, limit = 100, recordedAt = new Date().toISOString()): ThievingBatchResult {
    if (!deps.source.verifyChain() || !deps.thieving.verifyAuditChain() || !deps.rights.verifyAuditChain())
        throw new Error('Thieving processor source audit is invalid');
    let nextSequence = afterSequence;
    const processed: ProcessedThievingEvent[] = [];
    const skipped: SkippedThievingEvent[] = [];
    for (const event of deps.source.listAfter(afterSequence, limit)) {
        const actorAgentId = resolveBoundAvatarAgent(deps.agents, event.playerUsername);
        if (!actorAgentId) {
            nextSequence = event.sequence;
            skipped.push({ sequence: event.sequence, eventId: event.eventId,
                sourceEvidenceDigest: event.eventDigest, reason: 'unbound-actor' });
            continue;
        }
        const denied = event.procedureKind === 'property-burglary' && event.effect === 'entry-completed'
            && event.propertyAccess?.actorAuthorized === false && !!event.propertyAccess.owner;
        const unboundPlayerOwner = denied && event.propertyAccess!.owner!.kind === 'player'
            && !resolveBoundAvatarAgent(deps.agents, event.propertyAccess!.owner!.id);
        const receipt = ingestEngineThievingOutcome(event.eventId, deps.source, deps.thieving,
            () => actorAgentId, recordedAt);
        if (denied && !unboundPlayerOwner) projectPropertyEntryViolation(receipt.receiptId, deps.source, deps.thieving,
            deps.rights, username => resolveBoundAvatarAgent(deps.agents, username), recordedAt);
        let traceDiscovered: boolean | null = null;
        const noticedObservers: string[] = [], playerOnlyObservers: string[] = [];
        if (denied && event.propertyAccess?.lockLevel !== undefined
            && deps.units.units.some(value => value.enabled && value.propertyId === event.propertyAccess?.propertyId)) {
            traceDiscovered = recordEngineHousingEntryTrace(event.eventId, deps.source, deps.thieving,
                deps.traceRolls, deps.properties, deps.securityPolicy, deps.hierarchy, deps.effects,
                deps.units, recordedAt).discovered;
        }
        const theft = event.effect === 'item-transfer' && event.transferredItems.length > 0
            && ((event.procedureKind === 'pickpocket' && event.target.kind === 'npc')
                || (event.procedureKind === 'container-theft' && event.target.kind === 'loc'))
            && event.propertyAccess?.actorAuthorized !== true;
        if ((denied || theft) && event.sightSnapshot) {
            const opportunities = projectThievingWitnessOpportunities(event.eventId, deps.source,
                deps.thieving, deps.witnessPolicy);
            for (const opportunity of opportunities) {
                const observerAgentId = resolveBoundAvatarAgent(deps.agents, opportunity.observerUsername);
                const result = deps.witnessDecisions.decide(event.eventId, opportunity.observerUsername,
                    () => observerAgentId, recordedAt);
                if (result.decision.observerAgentId === null)
                    playerOnlyObservers.push(opportunity.observerUsername);
                if (result.noticed) noticedObservers.push(opportunity.observerUsername);
            }
        }
        nextSequence = event.sequence;
        processed.push({ sequence: event.sequence, eventId: event.eventId,
            outcomeReceiptId: receipt.receiptId, traceDiscovered, noticedObservers, playerOnlyObservers,
            rightsProjection: !denied ? 'not-required' : unboundPlayerOwner ? 'unbound-player-owner' : 'recorded' });
    }
    return { nextSequence, processed, skipped, blockedEventId: null };
}
