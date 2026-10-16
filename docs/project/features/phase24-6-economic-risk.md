# Phase 24.6 – observed economic structural risk

`reportEconomicRisk` derives production concentration, supply-chain depth,
single-producer candidates and actor/Business/product withdrawal scenarios from
the [24.5 verified dependency graph](phase24-5-economic-dependency.md). It is
read-only and deterministic. The complete input graph, native evidence and source
coverage are embedded and bound by the report digest. This is a conditional
analysis of recorded events in one window, not a future outage prediction or a
claim that the whole economy has been measured.

## Production concentration

For each item separately, gross quantities on `produced-wip` edges are grouped
by the recorded producing Business. Intermediates count as production of their
own product; final release does not produce another copy. GP and different item
types are never combined into a monetary or physical total.

For Business quantities `q_i` and total `Q`, shares are `q_i / Q`, concentration
HHI is `sum(q_i²) / Q²`, and the largest share is `max(q_i) / Q`. A 3:1 split
has HHI `10/16 = 0.625` and largest share `3/4 = 0.75`. These are defined on
observed gross output, not sales, net value, installed capacity or market power.
There is no regulatory threshold or economy-wide classification.

Quantities and exact numerator/denominator pairs are decimal strings backed by
BigInt arithmetic. `approximate` is provided for display; it is not the authority
for an exact share. Canceled transfer quantities use the same exact arithmetic,
including totals above JavaScript's safe integer range.

The optional agent concentration groups the recorded responsible run actor.
It does not identify a certified physical skill executor. If any output lacks
verified historical AgentState support, that product's agent concentration is
null and the unattributed quantity is explicit. Business concentration remains
available independently. No observed output means null concentration, not zero
concentration or perfect diversification. An unavailable production source yields
null production quantities and unavailable product metrics, including when the
independent trade source remains valid.

## Single-point-of-failure candidates and chain depth

A product is an `observed-single-producer-candidate` only when the selected
production events show exactly one producing Business and at least one
downstream consumer linked through its exact WIP material ID. Matching item IDs
in unrelated reserved stock do not establish this dependency. Candidate rows
include the sole producing Business and evidence; `globalVerdict` is always
`unknown`. Multiple observed producing Businesses, no observed producer and no
verified downstream lot use are distinguished. Unobserved alternative suppliers,
inventory and capacity prevent a global single-point-of-failure verdict.

Supply-chain depth counts production stages along the longest selected,
verified `producer event -> WIP lot -> consumer event` path. The first observed
stage has depth 1. A smelt/forge chain has depth 2; a third stage consuming the
actual pickaxe lot has depth 3. Declared workflow ordering alone is not a
material-flow edge. Forks and joins count events once, and iterative topological
traversal rejects cycles rather than returning a finite depth.

Reserved stock, legacy WIP and producers outside `(from,to]` are boundary inputs.
They retain their origins and quantities but do not pull an out-of-window event
into the measured chain. The resulting depth is a lower bound on the full chain;
`fullChainDepthKnown` is false. Without selected production, maximum depth is
null, with status distinguishing unavailable sources from no observed production.

## Conditional withdrawal scenarios

Every observed registered agent, producing Business and product gets a separate
scenario. The scenario assumes its withdrawal applies to the whole selected
window. Completed source events are never changed or deleted.

- An agent withdrawal removes production events assigned to that verified
  responsible actor and native trades in which the agent is an endpoint.
- A Business withdrawal removes its recorded production events. Player trades
  are not assigned to a Business through employment or item similarity.
- Product unavailability blocks every selected production step requiring that
  item as input and cancels native trades containing it. It does not claim that
  all steps producing that item must fail.

A blocked production step withdraws all of its recorded output lots. Every
selected step requiring one of those exact lots is blocked in turn. Any missing
required lot blocks the entire observed step; the model does not prorate batches.
An event reached through several paths is counted once. Lost production is gross
output grouped by item, with direct and propagated event IDs, exact lot links and
native evidence IDs retained for inspection.

Trades are atomic: a withdrawn participant or required product cancels every
recorded item/coin leg of the same native receipt. A transfer is counted once,
not once on the supply edge and again on the receipt edge. Receipt count is
separate from flow count. A later resale is not automatically canceled merely
because an earlier seller disappears: there is no verified resale lot lineage.
Payments and product-type classification never propagate production failure.

`criticalActors` ranks agents and Businesses by affected production event count,
then canceled native trade receipt count, with deterministic ID tie-breaking.
`productWithdrawalRanking` uses the same ordering. These are structural exposure
rankings of the observed window, with scenario details available for every row.
No quantities of unlike products are added to create a severity score. A Business
whose whole run is removed may have zero *additional* propagated events, because
all its steps were already direct withdrawals.

The model has no stock buffers, alternate suppliers, replacement workers,
substitute recipes, adaptation, price response, consumption demand or recovery
time. It therefore neither forecasts lost future output nor proves that recorded
downstream activity would have been impossible under every alternative plan.
No Business-to-Business or trade-to-production lineage is invented to extend a
cascade beyond the available evidence.

## Use and bounds

The existing CLI adds `--risk`; all source/time options retain their 24.5 meaning:

```powershell
bun run economy:dependencies --risk --from 2030-01-01T00:00:00.000Z --to 2030-01-02T00:00:00.000Z --basis wall
```

For simulation time, use `--basis simulation --clock-id <actual-id>
--clock-profile-digest <actual-digest>`. Missing bindings remain unplaced and
cannot produce a healthy or complete economy result. Native default paths and
trusted local path overrides are unchanged. The new authenticated endpoint is
`GET /api/admin/economy/dependency-risk?from=...&to=...&basis=wall`; simulation
queries also require `clockId` and `clockProfileDigest`. HTTP cannot override
native source paths or submit a graph as evidence.

The pure internal analyzer accepts a freshly verified graph; a self-consistent
JSON digest alone is not native authority. Public runtime and HTTP/CLI entry
points always rebuild and verify the native graph. A changed artifact digest,
dangling incidence, duplicate producer or cyclic lineage is rejected.

All scenarios must fit 2,048 targets and a 20,000,000-unit work bound based on
targets times graph edges, lot links and event counts. The aggregate event/link
trace is capped at 1,000,000 entries. Exceeding a bound fails explicitly, without
sampling, omitting a target or returning a partial ranking.

No persistent model, schema or clock binding changed in this phase. There is no
migration. Rollback removes the derived analyzer and its entry points while
preserving all 24.5 source journals and historical records. No live stack or bot
was started, no live database was mutated, no benchmark was run and no
`.canvas.tsx` was created. Long controlled runs and comparisons remain 24.7+.

## Verification

Native integration fixtures cover linear and forked production, a real
three-stage material path, unequal producer shares, source and identity gaps,
atomic trade withdrawal, absence of fabricated resale or cross-run lineage,
window boundaries, unplaced simulation events, deterministic evidence-linked
reports, safe large totals, graph tampering/cycles and explicit resource limits.

The 21 new native risk tests and new authenticated gateway case passed in the
affected suite: **75 pass / 0 fail / 0 skip**, with root/engine/webclient
TypeScript checks and format PASS:
`.local/verification/20261015-182348-190-phase24-6-final-domain-quality.log`.
The documented `--risk` CLI smoke passed with missing sources, explicit
`unavailable` metrics and no database creation:
`.local/verification/20261015-182413-222-phase24-6-cli-smoke.log`.

Full `bun run verify:full` / `bun run check` passed **1742 tests, 0 failures,
0 skips**, exit 0, including all three typechecks and format:
`.local/verification/20261015-182516-848-full.log`; outer wrapper:
`.local/verification/20261015-182516-067-phase24-6-full-final.log`.
