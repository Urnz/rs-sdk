# Item title, custody and provenance

The `item-provenance` domain separates three facts that must not be collapsed:
legal title, current physical custody and historical origin. Its strict versioned
policy reuses `item-lifecycle`'s existing `stack` / `batch` / `instance`
classification rather than creating a second granularity decision.

- Ordinary stacks use `value-restitution`. A verified theft creates an
  attributable quantity and coin-value claim, but no identity for each coin or
  production input.
- Batches use `provenance-lot`. A lot has one title owner, one holder and shared
  origin. The first schema deliberately allows only whole-lot theft; splitting a
  lot requires a later atomic split operation so quantity cannot be duplicated.
- Durable instances use `identified-asset`. Title and holder are independently
  revisioned while lifecycle wear remains in the existing lifecycle store.

Asset registration and transfers require typed, verifier-approved evidence.
Theft additionally requires an exact successful `ThievingOutcomeReceipt` whose
actor, item id and quantity match the requested mutation. For tracked assets,
the receipt must also match the current title, holder and optimistic revision.
For a fungible stack it instead creates an open value-restitution claim. The
ledger never infers an NPC, Business or storage owner merely from an inventory
gain.

Title transfer and custody transfer are separate operations. A direct player
trade can move custody, but it does not rewrite title, the provenance root, the
append-only event history or `theftHistoryCount`. Future merchant inspection and
fencing policy can therefore reason from the history without treating every
merchant or guard as omniscient. The policy contains no automatic stolen flag
visible to all observers.

Every mutation is one immediate SQLite transaction with an idempotent event id,
single-consumption evidence id, optimistic asset revision and hash-chained audit
entry. Free-form model output is not accepted as evidence.

## Migration and rollback

Schema v1 is a new, isolated database containing `item_provenance_asset`,
`item_provenance_event`, `item_restitution_claim` and
`item_provenance_audit`. Deployment does not rewrite the lifecycle, inventory or
Business storage databases. Existing durable instances and batches are imported
only after a trusted source can attest their item id, quantity, title and current
holder; missing facts fail closed instead of being invented. Existing fungible
stacks need no backfill because they acquire a claim only when a verified theft
occurs.

Before rollback, stop provenance writers and back up the database together with
its WAL/SHM sidecars. Disable provenance-dependent sale or enforcement decisions,
then return to the previous application version while retaining the v1 database
as immutable audit evidence. Do not project custody back into legal title and do
not delete the ledger: either action would erase theft history. A binary seeing a
newer schema version fails closed.
