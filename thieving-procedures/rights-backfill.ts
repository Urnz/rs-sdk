import { projectPropertyEntryViolation } from './property-rights.js';
import { resolveBoundAvatarAgent, type ThievingEventProcessorDependencies } from './event-processor.js';

/** Writes missing rights facts for an already processed prefix; never moves the engine cursor. */
export function backfillPropertyEntryRights(deps: ThievingEventProcessorDependencies,
    afterSequence: number, throughSequence: number, limit = 100,
    recordedAt = new Date().toISOString(), isSkipped: (eventId: string, digest: string) => boolean = () => false): number {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0
        || !Number.isSafeInteger(throughSequence) || throughSequence < afterSequence
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new Error('Property rights backfill range is invalid');
    if (!deps.source.verifyChain() || !deps.thieving.verifyAuditChain() || !deps.rights.verifyAuditChain())
        throw new Error('Property rights backfill source audit is invalid');
    if (afterSequence === throughSequence) return afterSequence;
    const events = deps.source.listAfter(afterSequence, limit).filter(event => event.sequence <= throughSequence);
    if (!events.length) throw new Error('Property rights backfill prefix is unavailable');
    for (const event of events) {
        // Even non-burglary events must belong to the persisted, processed prefix.
        const receipt = deps.thieving.getOutcome(`outcome:${event.eventId}`);
        if (!receipt && isSkipped(event.eventId, event.eventDigest)) continue;
        if (!receipt || receipt.sourceEvidenceDigest !== event.eventDigest)
            throw new Error('Property rights backfill has no matching procedure receipt');
        if (event.procedureKind === 'property-burglary' && event.effect === 'entry-completed'
            && event.propertyAccess?.actorAuthorized === false && event.propertyAccess.owner
            && (event.propertyAccess.owner.kind !== 'player'
                || resolveBoundAvatarAgent(deps.agents, event.propertyAccess.owner.id)))
            projectPropertyEntryViolation(receipt.receiptId, deps.source, deps.thieving, deps.rights,
                username => resolveBoundAvatarAgent(deps.agents, username), recordedAt);
    }
    return events.at(-1)!.sequence;
}
