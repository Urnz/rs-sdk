# Agent-operated finite shop lifecycle

The `agent-operated-shop` coordinator joins verified stock movements, finite
Business treasury money, role-bound paid work and Business-owned storage into a
restart-safe lifecycle. The institution agent may choose the high-level stock
decision, but it cannot manufacture a sale, procurement or wage receipt.

Every physical player mutation must arrive as exact committed evidence through
a trusted adapter. Stock authorization is checked before a journal row is
created. Each irreversible step has a stable settlement id and can be replayed
without applying inventory or money twice. A stopped process resumes from the
persisted step instead of constructing new ids.

The first configured candidate is the Lumbridge General Store and hammer policy:

1. a verified sale reduces finite Business inventory and credits only the exact
   buyer-payment settlement to the Business treasury;
2. reaching the minimum creates a reorder decision;
3. verified procurement replenishes stock and debits a pre-funded treasury
   reservation;
4. stock can be staged in and returned from Business-owned Property storage;
5. verified role-bound work earns a wage, and only an exact committed player
   payment may mark it paid;
6. gross revenue, procurement cost, wage cost and operating profit are derived
   from the immutable operation journal.

## Live acceptance run

The first end-to-end pilot completed on 2026-09-20 in the `closed-society`
world profile with `VRTrader1` as the employed clerk and `VRWorker1` as the
customer and supplier avatar. The Business started with five hammers and
1,000 GP. It sold three hammers for 15 GP, issued the exact six-hammer reorder,
paid 60 GP for verified procurement, moved those goods through the Business
stockroom, and paid 20 GP for a separately verified one-minute counter shift.
The final snapshot contained eight hammers, 935 GP, no outstanding reorder and
an operating result of -65 GP. Three lifecycle operations and both storage
movements were committed exactly once.

The immutable local acceptance report is written to
`.local/economy/agent-shop-live/acceptance-report.json`; the directory is
intentionally ignored because it contains local world evidence rather than
source. Its accepted evidence digest was
`447ceae4f641edc94a512bb907b85382a46ed8c8f4fe091cf2bc63018ecb2427`.
The pilot used the existing persistent owner agent `ferrye14`; it does not claim
that the separately documented production NPC cutover gates have been approved.

## Migration and rollback

The migration is additive. `agent_shop_schema` and `agent_shop_operation` are
created in a separate lifecycle database, while
`institution_treasury_external_credit` is added to the treasury database. Old
worlds are not backfilled and no runtime stock or money is seeded by this module.

Rollback may stop new lifecycle calls and retain the tables for audit. Committed
stock, treasury and wage entries must never be deleted or rewound independently.
An interrupted operation is replayed with the same ids; an irreconcilable
external receipt requires a forward compensating settlement and operator review.
Before an actual NPC cutover, the relevant databases and WAL/SHM sidecars must be
backed up and legacy writers disabled for the selected shop scope.
