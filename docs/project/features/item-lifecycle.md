# Item lifecycle

The item-lifecycle domain gives selected non-stackable assets a stable instance
identity and persistent durability. A versioned catalog controls maximum
durability, wear per verified use and repairability. Instance state also reserves
basis-point quality and immutable provenance fields for later product-quality and
origin mechanics without making either economically active yet.

Creation, use, breakage and repair are atomic SQLite operations with optimistic
revisions, idempotent operation ids and a hash-chained audit trail. Use requires
an external evidence digest and automatically changes status to `broken` at zero;
a broken item cannot be used. Repair also requires a trusted evidence digest and
cannot exceed the snapshotted maximum. The next repair task must define and
verify the actual material, time, competence and facility receipt behind that
digest; this module never treats free-form model output as repair evidence.

Schema v1 is additive. Rollback requires stopping lifecycle writers and restoring
or archiving the SQLite database with WAL/SHM sidecars. Deleting it would lose
instance identity, wear, breakage and audit history; newer schemas fail closed.
