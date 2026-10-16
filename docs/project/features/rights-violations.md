# Unified rights-violation events

The `rights-violations` domain records one immutable fact shape for denied use of
an owned item, Business storage, Property ownership or a Property-entry
entitlement. Each event identifies the actor, protected resource, legal owner,
attempted action, authoritative source domain and exact source-state version.
Only a trusted verifier for that source evidence can admit the event.

The boundary is deliberately narrower than a crime system. It proves that an
action violated the current ownership or access state, but does not classify an
offence, infer intent, select jurisdiction, create evidence beyond its source or
apply punishment. Later crime policy must consume these events without changing
their contents. Free text, chat, model output and matching identifiers are never
authorization evidence.

Every source evidence id and event id is single-use and replay-safe. A changed
retry fails closed. Events are persisted with a stable digest and a hash-chained
audit ledger. An agent cannot be recorded as violating its own directly owned
resource; Business and faction resources still require the source verifier to
prove that the acting agent lacked delegated authority.

## Migration and rollback

Schema version 1 additively creates `rights_violation_event` and
`rights_violation_audit` in a dedicated SQLite database; no existing domain row
is rewritten. Before rollback, stop violation writers and archive the database
with its WAL/SHM files. Older code may ignore this database, but it must not be
deleted after another domain references an event id. Restore the complete
database, never individual rows, and verify the audit chain after recovery.
