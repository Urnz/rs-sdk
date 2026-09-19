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

Creation, use, breakage and authorized repair are atomic SQLite operations with optimistic
revisions, idempotent operation ids and a hash-chained audit trail. Use requires
an external evidence digest and automatically changes status to `broken` at zero;
a broken item cannot be used. The store exposes no unrestricted `repair(...)`
operation and never treats free-form model output as repair evidence.

The first complete production-tool slice is configured in
`config/production-tool-cycles.json`. A bronze pickaxe accepts only a typed,
evidence-bound Mining receipt for configured ore outputs. Every successful
action applies the catalogued wear; one hundred verified actions therefore
break the initial tool. Replacement requires a separate receipt proving the
acquisition of exactly one matching item. The broken instance and its successor
are linked atomically, the old instance becomes ineligible for later use or
repair, and an exact retry returns the original successor. This closes the
use → wear → break → replacement path without treating replacement as a free
durability reset.

Repair is exposed only through the evidence-gated service configured by
`config/item-repair-policies.json`. The initial bronze-pickaxe policy consumes
one bronze bar through an exact trusted inventory receipt, requires ten minutes
of simulation time, personal Smithing level 1 or higher, and a live
`work-surface` facility grant covering the complete repair interval. The
competence snapshot, material-consumption receipt, facility receipt and policy
digest are bound into one internal authorization and one audit entry. Each
material receipt id is consumed once in a database-enforced ledger. Missing,
foreign, expired or altered evidence fails closed, while an exact retry returns
the original repair result without consuming another input.

Schema v2 adds the `item_replacement` relation and schema v3 adds the
`item_repair_evidence` single-consumption ledger. Opening an older database
creates each table transactionally without rewriting existing instances or audit
history. To roll back the code, stop lifecycle writers and restore the
pre-migration database backup with its WAL/SHM sidecars; older binaries
intentionally reject the newer file.
Deleting the database would lose instance identity, wear, breakage, replacement
links and audit history; newer schemas fail closed.
