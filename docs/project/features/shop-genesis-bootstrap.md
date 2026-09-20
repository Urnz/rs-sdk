# Shop genesis bootstrap

## Purpose

`config/shop-genesis-bootstraps.json` is the data-driven bridge between an
economic-NPC migration candidate and the existing World Genesis asset model. It
does not mutate a running world. It compiles one configured shop seed into:

- one Business creation allocation whose owner is the planned persistent owner
  agent;
- a finite opening-capital amount credited to that exact Business treasury by
  the existing genesis adapter;
- finite `business-stock` item allocations owned by the Business; and
- an opening-inventory digest that covers the complete aggregated stock.

The first template covers Lumbridge General Store. Its eight item IDs and
symbols are checked against the checked-in revision-274 object symbol table, so
a later vendor update cannot silently assign the seed quantities to different
items. The amounts and capital are configuration, not shop-script constants;
another shop or a revised balance can be added as another versioned template.

## Activation boundary

The catalog accepts only `activation: "genesis-only"`. A template is allowed
only for `seeded-economy`, `mature-society` and `historical-burn-in`; it is
rejected for `blank-slate` and `frontier`. Compilation always returns
`replenishmentPolicy: "verified-procurement-only"` and has no runtime grant or
restock operation.

Applying the compiled allocations uses the already existing World Genesis admin
lifecycle. `BusinessManagerStore` and `InstitutionTreasuryStore` write durable,
single-use allocation receipts. Replaying the same allocation is idempotent and
does not add a second item stack or a second treasury credit. A reset allocation
cannot later be replayed as stock replenishment. Separately, the closed-society
shop policy disables the legacy shared-inventory restock loop.

This task prepares and proves finite bootstrap assets; it does not claim that
the Lumbridge migration's `finite-bootstrap-assets` readiness gate has passed in
a live world. That gate remains pending until an exact World Genesis result is
applied, its provenance rows and receipts are inspected, and the later atomic
Business shop settlement is ready.

## Migration and rollback

No new database schema is introduced. The compiled plan reuses:

- `genesis_asset_provenance` for immutable world-genesis origin;
- `business_genesis_creation` and `business_genesis_inventory` for Business and
  stock allocation receipts; and
- `institution_treasury_genesis` for opening capital.

Before applying a shop seed, stop conflicting writers and back up the world
genesis, Business and treasury SQLite databases together with WAL/SHM sidecars.
The standard World Genesis application journal coordinates partial failure and
marks it `rollback-required` until reset succeeds.

Reset is safe only while the exact genesis stock and treasury lot are still
available and unreserved. After stock is consumed, funds are spent or a later
shop transaction commits, do not restore the pre-run databases or reapply the
seed: that would duplicate assets. Preserve the receipts and reconcile forward.

## Verification

The shop-bootstrap tests verify the source symbol bindings, exact target
Business, finite stock, allowed profile set, catalog digest, single-use Business
inventory receipts and single-use treasury receipt. They also prove that a reset
allocation cannot be reused as a refill operation.
