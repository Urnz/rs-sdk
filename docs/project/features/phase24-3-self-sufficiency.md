# Phase 24.3 – self-sufficiency observations

`society-metrics` produces a digest-bound diagnostic report for food,
tool/maintenance, housing and five configurable input categories. It reads the
existing domain ledgers without migrations, writes or fabricated historical
records. This is a measurement surface, not a claim that a society has passed
the [24.1 minimum](phase24-1-society-minimum.md).

## Scope and measurement semantics

The request explicitly selects actor IDs, a clock ID and canonical UTC simulation
endpoints. Events use `(start,end]`; reservations use `[start,end)`. Adjacent
windows therefore cannot double-count a boundary event. Every required food
chain and tool cycle is reported separately for every selected actor. Selecting
actors is diagnostic scope, not proof of the frozen founder cohort. The report
binds the resolved 24.1 contract, food/lifecycle/cycle/repair/housing catalogs,
input taxonomy and each source snapshot by digest.

- Food records expose consumed units, effective hunger relief from actual
  persisted before/after values, closure IDs and digests. Nominal food relief is
  never substituted for a clipped delta. Exact closure replay remains one event.
  Caller-supplied receipt digests do not prove native gathering, inventory
  removal, lineage or total hunger demand, so `internalFinalUseShare` remains
  inconclusive. Current usable reserves and reserve hours are unavailable without
  native boundary inventory and demand evidence.
- Tools replay use/wear, repairs and replacements. Opening and closing service
  capacity use `floor(durability / wearPerUse) * outputQuantityPerAction` per
  unreplaced instance. Future operations do not change an earlier boundary.
  Diagnostics include worn/restored durability, repair/replacement counts,
  maintenance-to-wear ratio, capacity retention and cycles with resumed use after
  in-window wear and maintenance. Replacement retires the old instance; a repair
  without subsequent use is not a completed service cycle. Maintenance-to-wear
  may exceed 100% and does not mean internal sourcing. Input lot origin, actual
  native input consumption, successor production and demanded service coverage
  are not established by this ledger; `internalMaintenanceShare` stays unknown.
- Housing integrates documented initial reservations at or above the contract's
  minimum tier. Actor reservations are unioned, and conflicting reservations
  receive no coverage during the conflict, including competing actors outside
  the selected cohort. Paid tenancies contribute only through their first rent
  due boundary; arrears payments are not treated as historical access grants.
  Free tenancies may contribute through their documented end. Early termination
  cuts the interval. Disabled units provide no reservation coverage. This metric
  is named `declaredInitialReservationCoverage`: it proves neither legal access,
  historical capacity, actual rest nor fatigue recovery. `legalAccessShare`
  therefore remains inconclusive.
- Inputs retain separate categories and item IDs: raw food, mineral ores,
  maintenance metal, replacement tools and construction materials. Food closures
  associate one raw input with final use; maintenance associates exact pinned
  policy quantities or one successor. These are
  `associatedRequirementUnits`, **not measured consumption at that time**: food
  stages and repair material consumption timestamps/lots were not persisted in
  these records. Missing associations remain `null`. An ore/material category
  cannot disappear because no supported native evidence exists. Wall-time-only
  production records are not silently assigned simulation timestamps. Each item's
  `internalSupplyShare` remains inconclusive until a native, time-bound input and
  origin bridge exists. Unlike item units are never summed into one category
  sufficiency score; food surplus cannot cancel a tool/material deficit.

`null` means unavailable or unproven, while zero means zero observations in an
available, reconciled ledger. Zero recorded demand never produces 100% internal
sufficiency. Ratios retain numerator/denominator and compute basis points with
BigInt integer division rounded downward; unsafe totals fail instead of rounding.
All confirmed internal-origin ratios are deliberately unavailable with these
legacy sources. The top-level assessment is always `inconclusive`; numeric
diagnostics, including an observed capacity loss, remain visible. It cannot issue
a society-wide PASS or hide incomplete evidence behind one blended score.

## Native evidence and read-only behavior

Adapters support food schema 1, item lifecycle schema 3 and housing tenancy schema
2. They open SQLite with `readonly: true` and use a consistent transaction per
source. No domain store constructor is invoked by reporting. Unknown schemas,
malformed/corrupt DBs and inconsistent evidence become `invalid`; absent or
unconfigured DBs become `unavailable`. They never cause a migration or creation.
There is a 100,000-row limit per source table; oversized sources are invalid
rather than partly sampled. Statements are cleared and connections closed after
each report, including failures.

The reader verifies audit sequence/hash links and reconciles relevant source rows:
food closures, effective deltas, needs policy/clock, events and receipt references;
tool operations, replayed terminal state, replacements and repair evidence;
housing creation/schedule/catalog, termination and payment references. A changed
event row, missing receipt, unmatched operation, modified terminal durability or
missing repair evidence cannot become a zero-demand result. Policy changes do
not reinterpret an old repair under the current material quantities.

These checks are not an externally anchored completeness certificate. A deleted
suffix accompanied by matching deletion/rewrite of all dependent rows cannot
always be discovered without an independent head watermark. Old tool creation
audits also do not anchor every immutable actor/type field. The report labels
coverage `partial`, retains snapshot/head hashes and never promotes a digest to
native origin authority. Separate DB snapshots are not one atomic world
snapshot. Full run/genesis, fixed roster, clock-profile, integrity-window and
all-path coverage must be supplied by later experiment assessment; the 24.2
observer's absence of detected injection does not fill those gaps.

## Use

From the repository root, supply paths to the **actual** existing domain stores:

```powershell
bun run society:metrics --from 2030-01-01T00:00:00.000Z --to 2030-01-02T00:00:00.000Z --clock-id world --actor ada --actor bea --food C:/path/to/food.sqlite --tools C:/path/to/items.sqlite --housing C:/path/to/tenancies.sqlite
```

The CLI prints JSON and does not start the engine, advance the clock or mutate
ledgers. Omit a source to see its explicit unavailable state. No default paths
are invented for standalone domain stores that have not been deployed as native
collectors. `config/self-sufficiency-inputs.json` is strict, digest-bound and
requires disjoint item classifications. Omitting a configured food/maintenance
input fails validation.

Authenticated GET `/api/admin/society/self-sufficiency` accepts `from`, `to`,
`clockId` and repeated `actor` query parameters. It uses only server-supplied
`AdminContext.selfSufficiencySources`; HTTP cannot select DB paths. Without source
configuration the report explicitly returns unavailable sources. Local admin
authorization and `Cache-Control: no-store` follow the existing admin boundary.
This phase does not add UI, persistence, runtime grants, import/export accounting,
dependency graphs or a live society benchmark.

## Rollback and verification

There is no persistent schema change. Remove `society-metrics`, its CLI, taxonomy
and admin route to roll back; native ledgers and their history stay intact.

The new module and authenticated endpoint passed **19 tests / 0 failures /
0 skips** within the affected domain suite (**139 / 0 / 0**), followed by root,
engine and webclient TypeScript checks and formatting
(`.local/verification/20261015-170335-434-phase24-3-domain-quality.log`). The
documented CLI passed with unavailable sources, producing explicit inconclusive
JSON without database creation
(`.local/verification/20261015-170621-686-phase24-3-cli-smoke.log`).

The complete `bun run verify:full` / `bun run check` regression passed
**1676 tests / 0 failures / 0 skips**, exit 0
(`.local/verification/20261015-170517-967-full.log`, outer runner
`.local/verification/20261015-170517-173-phase24-3-full-final.log`). Tests use
isolated stores and the actual packed local cache served read-only; no live
engine, bot or society benchmark was started. These results verify the metrics
implementation, not a society meeting the minimum.
