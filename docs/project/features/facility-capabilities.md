# Facility capabilities and access

The `facility-capability` domain defines version-controlled facilities bound to
an existing Property and, where supplied by trusted runtime configuration, one
exact Business. Each facility grants named capabilities with bounded capacity;
the initial catalog includes `smithing.basic-furnace`,
`smithing.basic-forging`, `storage.secure` and
`cooking.commercial-kitchen`.

Possessing a high personal skill never grants infrastructure access. A request
must match the actor, facility and capability of an active, time-bounded grant
whose kind is allowed by that facility. Employment, lease, contract and
explicit entitlements use the same typed authorization boundary, and an
external trusted adapter must verify their source evidence. Missing, expired,
malformed, foreign and unverified grants fail closed. The authorization result
snapshots the Property, optional Business, capacity, access kind, source
evidence and catalog digest for later work-order evidence.

The source catalog contains no persistent ownership or access grants. Business
bindings are accepted only when the caller supplies the exact known Business
set from authoritative domain state; unknown Property and Business references
are rejected.

## Migration and rollback

There is no persistent schema migration in this slice. Catalog changes are
additive and should introduce new facility or capability identities rather than
silently changing evidence already referenced by work. Rollback disables new
authorization against a newly introduced entry but retains any downstream work
records and their snapshotted catalog digest for audit.
