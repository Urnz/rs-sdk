import type { AgentStateStore } from './store.js';
import type { UnderworldClaimStore, UnderworldClaimVerifier } from './underworld-claims.js';
import { projectObserverUnderworldKnowledge,
    type ObserverContactKnowledge } from './underworld-knowledge.js';

export interface AttestedObserverContact extends ObserverContactKnowledge {
    /** Possible partner only; never a trade permission or guaranteed service. */
    possibleFenceClaimIds: string[];
}

export interface AttestedObserverUnderworldContext {
    observerAgentId: string;
    asOf: string;
    contacts: AttestedObserverContact[];
}

/** Join only this observer's own direct memory and currently source-attested claims. */
export function projectAttestedObserverUnderworldContext(agentState: AgentStateStore,
    claimStore: UnderworldClaimStore, verifier: UnderworldClaimVerifier,
    observerAgentId: string, asOf: string): AttestedObserverUnderworldContext {
    const memory = projectObserverUnderworldKnowledge(agentState, observerAgentId, asOf);
    const claims = claimStore.listActive(memory.observerAgentId, asOf, verifier);
    const byActor = new Map<string, string[]>();
    for (const claim of claims) {
        const ids = byActor.get(claim.actorKey) ?? [];
        ids.push(claim.claimId);
        byActor.set(claim.actorKey, ids);
    }
    const contacts = memory.contacts.map(contact => {
        const possibleFenceClaimIds = contact.directEpisodeIds.length > 0
            ? (byActor.get(contact.actorKey) ?? []).sort() : [];
        return { ...contact, possibleFenceClaimIds,
            blockers: possibleFenceClaimIds.length > 0
                ? contact.blockers.filter(value => value !== 'underworld-claim-not-attested')
                : contact.blockers };
    });
    return { observerAgentId: memory.observerAgentId, asOf, contacts };
}
