# Phase 24.5 – observed economic dependency graph

`economic-dependency` builds a deterministic, read-only graph from committed
local engine trades and audited Business production steps. It exposes agent,
Business and product projections, with every flow linked to its native evidence.
It describes observed channels only; it does not certify a complete economy or
self-sufficiency. Phase 24.6 criticality, concentration, supply-chain metrics and
outage propagation remain separate work.

## Sources and authority

- `engine_trade_evidence`: native schema-1 rows, canonical event digests and
  reconciled audit chain. Each direction retains actual item quantities. Currency
  is item 995; `fromValue`/`toValue` estimates never become GP payments. A barter
  receives no invented price. An unidentified item is diagnosed, not named from
  an untrusted label.
- `business_production_evidence`: new native WIP step receipts containing the
  pinned workflow/catalog, responsible actor, Business, exact input/output
  material IDs, quantities and before/after balances. A frozen catalog, audit
  chain and independent tail are verified against native runs, steps and material
  balances. A recipe definition or stock reservation is not completed production.
- Canonical AgentState: current native schema, identities and immutable
  population membership. Trade attribution requires a matching membership that
  existed at event time, including its clock/profile and join/reset interval, or
  an unchanged revision-1 avatar identity created before the event. Ambiguous or
  changed historical mappings remain `player` nodes. Production records establish
  the assigned run actor; absent historical AgentState support yields an
  `actor-reference`, not an invented registered agent. The assigned actor is not
  proof of who physically executed a skill.
- Shared SimulationClock: native schema-4 event bindings matching the source
  event ID, digest and commit wall time, plus engine tick for trades. Production
  also requires an exact match to the binding retained in the atomic receipt.

Each source is read in a consistent SQLite snapshot. Publishers are read before
the clock registry. Independent sources are not a globally atomic world snapshot.
Missing files are not created, old schemas are not migrated by reporting and
invalid sources are withheld with a reason. An independent valid source remains
visible. If neither event source is available, `measurementStatus` is
`unavailable`; otherwise it is `partial-observed-channels` even for an empty
selected window. Resource limits fail explicitly instead of sampling silently.

## Graph semantics

Nodes are `agent`, `actor-reference`, `player`, `business`, `product`, `event`
and `wip-lot`. IDs are typed content digests. Sorted nodes, edges, evidence,
diagnostics and source snapshot digests contribute to the final artifact digest.
Repeated reads of unchanged snapshots and exact production replay are stable.

A trade item leg is `participant -> event -> participant`, with `supplied` and
`received` edges carrying the same actual quantity. The product-type edge is a
classification. `participantTransfers` retains unresolved native players;
`projections.agents.transfers` requires two verified agent endpoints. No Business
ownership is inferred from employment, a player name or the item being sold.

A completed WIP step has `production-business` and `production-run-actor`
incidence, `consumed-wip` input edges and `produced-wip` output edges. Exact
material IDs connect an observed intermediate lot to the later consuming step.
For example, the bronze bars created by a smelt step connect to a forge step
only through their actual WIP material ID. Product-type edges are explicitly
noncausal: two unrelated lots of bronze do not become the same supply chain.

Reserved input stock has `reserved-stock-origin-unproven` origin. A producer
outside the selected window is retained as lot context with its evidence ID,
without inserting its event into the selected graph. Old unaudited WIP has
`legacy-production-unverified` origin. Final release does not produce another
copy of the outputs. Matching item IDs never connects a Business output to a
later player trade, establishes cross-run/inter-Business lineage, labels an
import as domestic production or proves final consumption.

The output includes native record IDs/digests, event selection, source status,
unplaced event counts, legacy step counts and explicit limitations. Product and
Business projections retain incidence and classification rather than guessing
missing ownership or causal edges. `completeEconomyCoverage` and
`provesSelfSufficiency` are always false.

## Time and access

Windows are `(from,to]`. Canonical ISO timestamps are compared chronologically,
including extended ISO years. `basis: wall` selects by native commit wall time.
`basis: simulation` requires explicit `clockId` and `clockProfileDigest`; events
without matching native bindings remain unplaced. Wall time is never relabeled
as simulation time. A missing world clock is not created and an old untimed
production receipt cannot acquire a later clock binding through reporting.

Local CLI examples, run from the repository root:

```powershell
bun run economy:dependencies --from 2030-01-01T00:00:00.000Z --to 2030-01-02T00:00:00.000Z --basis wall
bun run economy:dependencies --from 2001-01-01T00:00:00.000Z --to 2001-01-02T00:00:00.000Z --basis simulation --clock-id local-world --clock-profile-digest <actual-profile-digest>
```

The simulation values are illustrative; use the actual existing world clock and
profile digest. JSON is written to stdout. Trusted local callers may override
`--engine-trades`, `--production`, `--agents` and `--clock`. Native defaults are:

- `server/engine/data/mods/trade-evidence.sqlite`
- `.local/economy/businesses.sqlite`
- `.local/agent-state/agents.sqlite`
- `.local/simulation/simulation-clock.sqlite`

The authenticated, read-only admin endpoint is
`GET /api/admin/economy/dependencies?from=...&to=...&basis=wall`.
Simulation queries use `basis=simulation&clockId=...&clockProfileDigest=...`.
HTTP parameters cannot choose source paths or provide evidence. There is no
write endpoint, graph database, UI or live benchmark in this phase.

## Native migration and rollback

Opening the native `ProductionWorkInProgressStore` installs additive source
schema 1, transactionally, in the existing Business database:

- `business_production_evidence_schema`: version and legacy-reference digest.
- `business_production_evidence_legacy`: only existing operation/run/step/digest
  references, counted as unverified; no fabricated historical receipts.
- `business_production_evidence_catalog`: frozen catalog snapshots by digest.
- `business_production_evidence`: immutable step receipts and hash chain.
- `business_production_evidence_head`: independent sequence/tail anchor.

The shared Business `user_version`, AgentState, trade and clock schema versions
are unchanged. Unsupported future evidence schemas are rejected before WIP
migration. The report reader performs no migration.

Every new completed step writes stock changes, native step, material allocations
and the audit receipt inside the same existing SQLite transaction. Audit failure
rolls them all back. Exact replay verifies the source and adds nothing; corrupt
balances, actor/recipe binding or audit tail block subsequent production. The
native Business database path uses the existing configured shared clock by
default. Custom stores are untimed unless a trusted caller supplies a binder.
Binding failure retains the production receipt as untimed.

The clock is a separate database. Its `business-production` binding is written
before native step publication and binds the facts digest, using a digest-derived
operation key. A later stock transaction failure can leave an orphan binding;
that stamp alone is never production evidence. Do not delete or repurpose it to
make a retry appear to be a different event. Trade bindings retain the existing
`engine-trade` behavior through the shared binding helper.

Before rollout, preserve the Business database together with its WAL state and
the related clock, AgentState and trade snapshots using the existing consistent
backup procedure. Code rollback can leave the additive tables intact. If older
code writes new unaudited steps, the newer reader will reject the source rather
than silently accepting them. Restoring a prior deployment therefore requires
the matching consistent source/clock backups when reverting persisted history;
do not drop audit tables, reset the tail or reinterpret old steps as a repair.
No live migration or live database mutation was performed during implementation.

## Verification

The 18 graph tests and authenticated gateway test cover real native WIP/trade
fixtures, exact intermediate lot flow, quantities/directions/GP, replay/restart,
window boundaries, identity history, missing sources, legacy migration without
backfill, clock/profile mismatch, native/catalog/tail tampering, atomic rollback,
unsafe numeric totals and absence of Phase 24.6 analytics. The affected domain
suite passed **71/71**, with root/engine/webclient typechecks and format PASS:
`.local/verification/20261015-180622-457-phase24-5-domain-quality.log`.

The documented CLI smoke passed with absent sources, explicit `unavailable`
coverage and no database creation:
`.local/verification/20261015-181016-036-phase24-5-cli-smoke.log`.
Full `bun run verify:full` / `bun run check` passed **1720 tests, 0 failures,
0 skips**, exit 0, including all three typechecks and format:
`.local/verification/20261015-180855-839-full.log`; outer wrapper:
`.local/verification/20261015-180851-733-phase24-5-full-final.log`.
