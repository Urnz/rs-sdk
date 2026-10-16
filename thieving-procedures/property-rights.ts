import { createHash } from 'node:crypto';

import { RightsViolationStore, type RightsOwner, type RightsViolationEvent } from '../rights-violations/index.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from './store.js';
import type { ResolveThievingAgent } from './engine-bridge.js';

function stableId(prefix: string, source: string): string {
    const direct = `${prefix}:${source}`;
    return direct.length <= 128 ? direct
        : `${prefix}:${createHash('sha256').update(source).digest('hex')}`;
}

/** Projects only a completed, engine-attested, unauthorised Property entry. It makes no legal finding. */
export function projectPropertyEntryViolation(outcomeReceiptId: string, sourceStore: ThievingEvidenceStore,
    procedureStore: ThievingProcedureStore, rightsStore: RightsViolationStore,
    resolveAgent: ResolveThievingAgent, recordedAt = new Date().toISOString()): RightsViolationEvent {
    if (!sourceStore.verifyChain() || !procedureStore.verifyAuditChain() || !rightsStore.verifyAuditChain()) {
        throw new Error('Property entry projection requires intact evidence chains');
    }
    const outcome = procedureStore.getOutcome(outcomeReceiptId);
    if (!outcome || outcome.procedureKind !== 'property-burglary' || outcome.result !== 'succeeded'
        || outcome.effect !== 'entry-completed') {
        throw new Error('Property entry projection requires a successful burglary entry receipt');
    }
    const source = sourceStore.get(outcome.sourceEventId);
    if (!source || source.eventDigest !== outcome.sourceEvidenceDigest
        || source.playerUsername !== outcome.playerUsername || source.procedureKind !== outcome.procedureKind) {
        throw new Error('Property entry source evidence does not match its procedure receipt');
    }
    const access = source.propertyAccess;
    if (!access || access.actorAuthorized || !access.owner) {
        throw new Error('Property entry was not an owned, denied entitlement at the event boundary');
    }
    const owner: RightsOwner = access.owner.kind === 'player'
        ? { kind: 'agent', id: resolveAgent(access.owner.id) ?? '' }
        : { kind: access.owner.kind, id: access.owner.id };
    if (!owner.id) throw new Error('Property owner avatar is not bound to an agent');
    const evidence = {
        evidenceId: stableId('thieving', outcome.receiptId),
        resourceKind: 'entry-entitlement' as const,
        resourceId: `${access.propertyId}.${access.entryPointId}`,
        owner,
        actorAgentId: outcome.actorAgentId,
        action: 'enter' as const,
        authorizationDecision: 'denied' as const,
        sourceDomain: 'property-access' as const,
        sourceStateVersion: access.propertyStateVersion,
        sourceEvidenceDigest: source.eventDigest,
        occurredAt: outcome.occurredAt
    };
    return rightsStore.record({ eventId: stableId('rights', outcome.receiptId), evidence }, candidate => {
        const persistedOutcome = procedureStore.getOutcome(outcome.receiptId);
        const persistedSource = sourceStore.get(source.eventId);
        return persistedOutcome?.receiptDigest === outcome.receiptDigest
            && persistedSource?.eventDigest === candidate.sourceEvidenceDigest
            && persistedSource.propertyAccess?.propertyId === access.propertyId
            && persistedSource.propertyAccess?.entryPointId === access.entryPointId
            && persistedSource.propertyAccess?.actorAuthorized === false;
    }, recordedAt);
}
