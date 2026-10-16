# Observer-specific underworld context

`projectAttestedObserverUnderworldContext` joins two independently checked
sources for one agent: that agent's direct, current relationship episode and a
currently source-attested, non-revoked possible-counterparty claim. A claim for
an unknown contact, a bare relationship tag, or a claim belonging to another
observer reveals no possible partner. The result contains only claim IDs; it
does not reveal a global registry, promise a fencing service, or authorize a
trade. The underlying agent-state and claim ledgers fail closed when their
audit/source checks fail.

This is a read-only composition with no schema change, so no migration is
needed. Rollback removes the projection and leaves both source ledgers intact.
Gameplay use still needs an independently trusted source adapter for claim
attestation and the normal finite-money, storage, capability and provenance
gates before any trade.
