# Phase 24.4 – finite external trade accounting

`external-trade` measures imports and exports as a separate, audited domain over
actual committed trades on the local/private emulator. It never creates stock,
money, an NPC shop or an automatic replenishment source. The supplied policy and
world-profile binding catalogs are empty: **every shipped profile remains denied
by default**. Existing world profile digests and population bindings are unchanged.

## Explicit permission and finite limits

`config/external-trade-policies.json` holds schema-1 policies. Each policy requires
`policyId`, semantic `version`, settlement `committed-engine-player-trade`,
`automaticRestock: "forbidden"`, a positive bounded
`maximumSimulationMilliseconds` and named `counterparties`. A counterparty has:

- A unique `counterpartyId` and exact local player `username`.
- A positive `maximumTrades` and nonnegative `maximumImportedGp` and
  `maximumExportedGp` for the whole registered experiment.
- Explicit commodity limits: `itemId`, `maximumImportedUnits` and
  `maximumExportedUnits`. Item 995 is currency and must use GP limits.

Limits are finite gross quantities, independent in both directions. Exporting an
imported commodity does not renew its import quota. A new report window, process
restart or repeated observation does not renew any quota. Barter and gifts are
still transfers; no coin payment does not exempt their item quantities.

`config/external-trade-world-profile-bindings.json` grants permission only through
the exact tuple `worldProfileId`, `worldProfileVersion`, `worldProfileDigest`,
`policyId`, `policyVersion`, `policyDigest`. Both content digests are recomputed and
checked. Missing binding denies permission; stale/conflicting bindings fail
closed. This separate binding is the profile's explicit external-trade opt-in.
It does not silently change the built-in profile definition or its existing
population lifecycle binding. Operator-selected real counterparties and limits
must be declared before registration; no sample merchant is activated by default.

The closed [24.1 society minimum](phase24-1-society-minimum.md) now pins the
external-trade configuration and rejects an external-enabled required profile.
An experiment permitting imports cannot acquire the closed-economy qualification.
Existing saved contract digests change when this new dependency snapshot is
resolved; an old digest is not accepted as a binding to the new contract.

## Native evidence and registration

Only the engine-owned `engine_trade_evidence` and its reconciled audit chain
establish that a transfer happened. Skill telemetry, chat, model output, offer
messages, GP valuations and arbitrary HTTP item lists are not settlement evidence.
Both trade orientations are supported. Coin quantities come exclusively from
item 995 on the actual exchange legs; `fromValue`/`toValue` are never prices.

The native trade writer now binds each **new** committed receipt to the existing
shared SimulationClock under `engine-trade`, with exact event ID/digest, engine
tick and commit wall time. It publishes the native row only after attempting this
binding, preventing an observer from racing a late stamp. If the clock is absent
or binding fails, the committed native exchange is preserved but remains untimed.
Exact replay never backfills historical timestamps. The bridge does not create a
missing clock or reinterpret an existing clock with a different configured
profile. Normal engine restart is required to load changed engine code; this task
did not restart a live engine.

An observation registration requires a native applied genesis result/receipt,
exact current profile permission, its clock/profile and a frozen registry of all
AgentState identities with player usernames. An internal AgentState account
cannot also be an external counterparty. The registration freezes the policy,
native source-path digest, participants, current simulation/wall observation and
native trade audit prefix. Existing source history before that prefix is excluded
explicitly; registration never pretends to have observed from genesis.

Registration also adds an `external-trade-registration` marker to the shared
clock at its already-observed wall time. The marker binds the complete frozen
definition without advancing simulation time. It is independent of the new
accounting DB: deleting that DB or its run row cannot open a fresh quota under
the same genesis. Missing/conflicting markers or lost registered history require
restoration, not automatic re-registration. Genesis reset blocks observation and
leaves already recorded measurements intact; reports retain the native reset
status when their backing sources remain verifiable.

## Measurement and audit behavior

Observation copies a contiguous source suffix into an atomic, hash-linked journal
with a separate tail anchor. Exact replay is idempotent. The source prefix,
copied receipts and clock bindings are rechecked against the actual native stores
on every report. Native row changes, removed source suffixes, changed copied clock
bindings, local suffix deletion or changed source paths fail closed. A backed
report verifies and reads one consistent accounting transaction. Native trade
rows are snapshotted before clock stamps, matching the engine publication order.
The different native DBs are not one global atomic world snapshot.

The policy budget is evaluated over the entire recorded run. A **completed**
exchange exceeding a quota, time window or declared partner/item scope is retained
and reported as a violation. Accounting does not retroactively undo a native
exchange. These limits are an auditable experiment boundary, not a new trade
execution service or a claim that the engine blocks a player before settlement.
Existing closed-society shop guards remain unchanged; opening the explicit trade
domain never enables legacy NPC buying, selling, payouts or automatic restock.

The report retains:

- Per-item gross imported/exported units and actual GP inflow/outflow/net flow.
- `recordedRunTotals` for the whole copied suffix, independent of the selected
  window, including untimed exchanges. Registered and unregistered totals remain
  separate; these totals do not fill excluded pre-registration history.
- Per-partner and per-agent measurements, exact event IDs and issues.
- `(start,end]` simulation windows; untimed registered exchanges separately.
  Canonical extended ISO years use chronological numeric comparisons, not string
  ordering; reversed or unsafe windows are rejected.
- Nonregistered boundary counterparties separately from registered imports and
  exports. A human outside AgentState is not silently called a foreign economy.
- Pending source events, excluded native prefix size, registration and journal
  hashes, roster-match status and explicit unavailable full-run coverage.

Unknown item IDs are never guessed from names, and untimed exchanges are never
placed in a simulation bucket. These evidence gaps yield `inconclusive` unless a
separate violation is proven. Violations remain visible even when a narrow report
window excludes their event. All totals require safe integers; overflow rolls
back the observation batch and retains its prior checkpoint. Unlike commodity
units are not merged into one economic quantity or assigned invented GP prices.

`no-observed-policy-violation` means only that the retained registered channel has
no observed violation. It is not a complete clean-world certificate. Other shop,
drop, bank, admin and fallback paths are not covered by this domain, and missing
history/source lag cannot prove zero external dependence. The report always has
`provesSelfSufficiency: false`; imports never become verified internal origin in
the [24.3 metrics](phase24-3-self-sufficiency.md).

## Admin API and configuration

Authenticated POST
`/api/admin/world-genesis/:resultId/external-trade/observe`, with JSON
`{ "reason": "Observe declared external exchanges" }`, registers on first use
and observes on later calls. Without exact profile opt-in it fails before creating
an accounting DB. An existing run freezes its original policy, registry and quota.

Authenticated GET
`/api/admin/world-genesis/:resultId/external-trade?from=<UTC-ISO>&to=<UTC-ISO>`
returns a read-only, digest-bound report. Missing accounting history returns
`unavailable` without creating/migrating stores. HTTP cannot provide source paths,
timestamps, item transfers or counterparty overrides. Server-side
`AdminRouteContext.externalTradeOptions` supplies paths; defaults use the actual
local genesis, AgentState, engine trade and clock stores and
`.local/simulation/external-trade.sqlite`. No bot or external network is involved.

## Migration and rollback

The new accounting DB starts at schema 1 and contains `external_trade_run`,
`external_trade_event` and `external_trade_head`. Its first write creates only
this independent DB. Read-only access requires exactly schema 1; a future version
is rejected. Native trade schema 1, clock schema 4 and the current AgentState
schema are unchanged. Clock event domains are additive rows in the existing
generic stamp model. No historical external transactions or clock stamps are
manufactured during migration.

Before any operational rollback, stop writers and retain a coherent backup of
the accounting DB, native trade source, shared clock and genesis/AgentState
bindings, including SQLite sidecars. Removing the module/routes/config disables
accounting without altering assets or history. Keep existing registration markers
and the journal together; deleting one side is deliberately not a supported quota
reset. Restore paired backups after an interrupted registration or storage loss.
Unreferenced clock markers may remain after code rollback; they do not create
economic value. Do not delete shared clock stamps to make re-registration pass.

The affected integration suite passed **119 tests / 0 failures / 0 skips**, with
root, engine and webclient TypeScript checks and format validation
(`.local/verification/20261015-173326-651-phase24-4-final-domain-quality.log`).
The final chronological-window regression and full-run totals were then checked
with the complete external-trade/admin suite: **25 / 0 / 0**, followed by all three
TypeScript checks and formatting
(`.local/verification/20261015-173843-866-phase24-4-chronological-final.log`).

The complete `bun run verify:full` / `bun run check` regression passed
**1701 tests / 0 failures / 0 skips**, exit 0, including the final extended-year
regression (`.local/verification/20261015-173625-107-full.log`, outer runner
`.local/verification/20261015-173624-191-phase24-4-full-final.log`). Tests use
temporary native stores and the actual packed local cache served read-only.
No live engine/bot, external-trade experiment or society benchmark was started.
