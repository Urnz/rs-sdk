# Item lifecycle

The item-lifecycle domain gives selected non-stackable assets a stable instance
identity and persistent durability. A versioned catalog controls maximum
durability, wear per verified use and repairability. Instance state also reserves
basis-point quality and immutable provenance fields for later product-quality and
origin mechanics without making either economically active yet.

`config/item-state-policies.json` makes storage granularity an explicit decision
per supported item id. Reusable, independently wearing tools use `instance` and
must reference a real lifecycle definition. Fungible currency and ordinary
production inputs use `stack`. Food uses `batch`, preserving shared lot origin
and a future expiry-policy reference without creating one database row per fish.
Unknown items fail closed instead of silently receiving a default mode. In the
initial catalog coins and bronze bars are stacks, raw/cooked lobster are batches,
and the bronze pickaxe is an instance.

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
