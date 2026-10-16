# Underworld claim source audit: no production attestation yet

The observer-scoped claim ledger needs evidence that **this agent learned this
counterparty** through a committed game event. No current production source
establishes that proposition. `createCurrentUnderworldClaimVerifier` therefore
rejects both claims and revocations. A test fixture that returns a claim is not
an implementation of source verification.

The existing sources fail the boundary for different reasons:

- `FencingCandidateSnapshot` is a caller-built economic opportunity input. Its
  relationship and evidence digest are not a durable observer-specific
  encounter. The snapshot cannot be promoted into a claim.
- `FencingSettlementCoordinator` records a restart-safe settlement and a
  receipt reference, but has no production call site or concrete engine trade
  receipt verifier. Its test callbacks cannot establish a real encounter.
- Economic-contract records may prove contractual parties, not that either
  party learned an *underworld* counterparty. Title, summary and service text
  are user/model-controlled and cannot supply the role.
- Economy transaction telemetry is extracted from bot skill journals. Its
  `counterparty` field is not an engine-committed, identity-bound observation.
- Agent episodes, relationship tags and semantic memory can be manually
  entered; `trusted` in that store is not independent source attestation.

The missing source is a durable engine-side encounter or trade event with a
stable ID/revision and integrity check, committed participant identities and a
specific observer-to-counterparty visibility fact. A future read-only adapter
must fetch that event by ID, verify the engine journal/receipt and identity
binding, then derive a short-lived, revocable **possible** counterparty claim.
The source must also expose loss or revocation so `listActive` can fail closed.
Even then, a claim is not a trade permission: funding, storage, relationship,
provenance and settlement gates remain separate.

This slice adds no persistent schema and no economic mutation. Rollback removes
the default verifier/contract; the existing claim ledger remains intact and
must not be truncated or converted from test-only claims.
