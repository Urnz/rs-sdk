# Observer-scoped underworld claim ledger (v1)

The `UnderworldClaimStore` is a separate SQLite, append-only source-attestation
ledger. It does not parse memory, tags, chat or model output into a fence role.
Only a trusted `UnderworldClaimVerifier` adapter can attest the typed
`fencing-candidate` or `observed-counterparty-action` source and return an
observer, counterparty, source digest and bounded validity interval. A current
source verification is required again on every active read; missing, changed,
expired or explicitly revoked evidence fails closed. Claims are visible only
to their observer and mean *possible* counterparty, not a globally known fence.

The record is not an authorization to advertise a service, initiate a trade,
settle stolen goods or make a legal finding. The existing fencing market still
requires its own capability, relationship, funds, storage, provenance and
atomic settlement checks. A concrete trusted source adapter and explicit
composition into gameplay are follow-up work; accepting a caller-created
`FencingCandidateSnapshot` alone is not sufficient attestation.

## Migration and rollback

Schema `PRAGMA user_version = 1` creates only `underworld_claim_event` in a
separate database file. No existing agent-state or fencing-market schema is
modified. The constructor refuses newer versions; it does not silently
downgrade. Back up the file before deployment. Rollback is to disable the
consumer and restore that backup (or retain the file unused), rather than
rewrite or truncate the append-only audit. The v1 event chain and exact
idempotency keys are verified before reads/writes. As with the other local
hash chains, an external signed checkpoint is needed to defend against an
attacker who can rewrite the entire database and recompute every hash.
