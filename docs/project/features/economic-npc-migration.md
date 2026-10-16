# Economic NPC migration strategy

## Scope and first candidate

`config/economic-npc-migrations.json` is a strict, digest-bound planning catalog
for replacing economically significant static NPC services. It deliberately
accepts only `activation: "planning-only"` and candidate `status: "planned"`;
loading this file cannot change an engine shop, create an actor or move assets.

The first candidate is Lumbridge General Store. Its legacy service is identified
by `generalshopkeeper1`, `generalassistant1` and shared inventory `generalshop1`.
The current source configuration has automatic restocking and accepts arbitrary
stock, so it is a concrete infinite-stock/infinite-liquidity boundary rather
than an assumed abstraction. The target identities are reserved for one
Business, one owner agent, one exact Business institution agent, one Property
and the Business treasury. Reserving identifiers is not evidence that those
entities or assets already exist.

## Ordered migration

Every candidate must pass the same stages in order:

1. `audit`: capture exact stock, prices, buy/sell multipliers, restock behavior,
   transaction volume and source digests without changing the legacy service.
2. `shadow-accounting`: project observed legacy sales into a read-only Business
   ledger and reconcile every item and GP delta. The shadow side is never a
   second writer and cannot authorize a transaction.
3. `finite-pilot`: create the target identities and one-time bootstrap assets,
   then run a bounded pilot through typed, atomic item/GP settlement. Legacy
   writes for the pilot scope must be disabled before the first real settlement.
4. `cutover`: route the selected world profile to the Business service only
   after all readiness evidence is current and exact. The closed social profile
   must not fall through to automatic legacy restock when stock or money runs out.

The catalog requires all eight gates: legacy audit, persistent identity binding,
Property entitlement, provenance-bound finite bootstrap assets, atomic sale
settlement, verified procurement, shadow reconciliation and a rollback drill.
All are currently `pending`; therefore this task defines a migration strategy,
not a false readiness claim.

## Target authority boundaries

- The Business owns stock and storage; the owner or manager's personal
  inventory is not a substitute.
- The Business treasury is the only source of shop payouts and receives sale
  proceeds through audited settlement.
- The institution agent chooses high-level policy only. Physical procurement,
  stocking and delivery use exact verified player skills or trusted settlement.
- Property access and storage/facility use require evidence from their own
  domains; a matching string identifier grants no entitlement.
- An LLM response, NPC dialogue, animation, legacy shop view or inventory
  snapshot alone cannot mint stock, money or authority.

## Cutover, migration and rollback

The current planning catalog adds no persistent schema, so it needs no database
migration. The future executable cutover must stop writers, back up every
affected database with WAL/SHM sidecars, record the final legacy inventory and
price snapshot, create Business inventory and treasury exactly once with genesis
provenance, verify totals, then atomically switch routing. A stable migration ID
and source digest must make retries idempotent.

Before the first Business settlement, rollback may restore the backed-up routing
and databases. After any committed sale, wage, procurement or transfer, rollback
must not restore pre-cutover balances or legacy stock because that would duplicate
assets. The safe response is to make the service temporarily unavailable,
preserve both ledgers, reconcile forward with explicit compensating events, and
only enable a legacy fallback under a separately approved non-closed world
policy. A rollback drill proving this behavior is a mandatory gate.
