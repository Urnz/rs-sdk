import type { EngineThievingEvidenceRecord } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from './store.js';
import type { ThievingOutcomeEvidence, ThievingOutcomeReceipt, ThievingProcedureKind } from './types.js';

export type ResolveThievingAgent = (playerUsername: string) => string | null;

const procedures: Record<ThievingProcedureKind, { id: string; version: string }> = {
    pickpocket: { id: 'procedure.thieving.pickpocket', version: '1.0.0' },
    'lockpick-door': { id: 'procedure.thieving.lockpick-door', version: '1.0.0' },
    'container-theft': { id: 'procedure.thieving.container-theft', version: '1.0.0' },
    'property-burglary': { id: 'procedure.thieving.property-burglary', version: '1.0.0' }
};

function outcome(source: EngineThievingEvidenceRecord, actorAgentId: string): ThievingOutcomeEvidence {
    const procedure = procedures[source.procedureKind];
    return {
        evidenceId: `engine:${source.eventId}`,
        procedureId: procedure.id,
        procedureVersion: procedure.version,
        procedureKind: source.procedureKind,
        actorAgentId,
        playerUsername: source.playerUsername,
        target: source.target,
        result: 'succeeded',
        effect: source.effect,
        transferredItems: source.transferredItems,
        thievingXpDelta: source.thievingXpDelta,
        startedAtEngineTick: source.startedAtEngineTick,
        endedAtEngineTick: source.endedAtEngineTick,
        sourceEventId: source.eventId,
        sourceEvidenceDigest: source.eventDigest,
        occurredAt: source.occurredAt
    };
}

/**
 * Promotes an engine-owned event into the procedure ledger. The resolver is the explicit avatar-to-agent
 * identity boundary; no username is silently treated as an agent id.
 */
export function ingestEngineThievingOutcome(eventId: string, sourceStore: ThievingEvidenceStore,
    destinationStore: ThievingProcedureStore, resolveAgent: ResolveThievingAgent,
    recordedAt = new Date().toISOString()): ThievingOutcomeReceipt {
    if (!sourceStore.verifyChain()) throw new Error('Thieving engine evidence chain is invalid');
    const source = sourceStore.get(eventId);
    if (!source) throw new Error('Thieving engine event was not found');
    const actorAgentId = resolveAgent(source.playerUsername);
    if (!actorAgentId) throw new Error('Thieving player avatar is not bound to an agent');
    const receiptId = `outcome:${source.eventId}`;
    const existing = destinationStore.getOutcome(receiptId);
    if (existing) {
        if (!destinationStore.verifyAuditChain() || existing.sourceEventId !== source.eventId
            || existing.sourceEvidenceDigest !== source.eventDigest || existing.playerUsername !== source.playerUsername
            || existing.procedureKind !== source.procedureKind || existing.actorAgentId !== actorAgentId
            || existing.procedureId !== procedures[source.procedureKind].id
            || !['0.1.0', '1.0.0'].includes(existing.procedureVersion))
            throw new Error('Existing Thieving receipt does not match the trusted engine event');
        return existing;
    }
    const evidence = outcome(source, actorAgentId);
    return destinationStore.recordOutcome(receiptId, evidence, candidate => {
        const persisted = sourceStore.get(source.eventId);
        return persisted?.eventDigest === candidate.sourceEvidenceDigest
            && persisted.playerUsername === candidate.playerUsername
            && persisted.procedureKind === candidate.procedureKind;
    }, recordedAt);
}
