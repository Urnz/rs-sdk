# Housing domain

Housing quality is a versioned security and comfort hierarchy independent from
Property ownership. The required baseline progresses through street, temporary
shelter, shared dormitory, rented room, owned home and fortified property.

Each tier has a stable id, contiguous rank, tenure category, comfort rating and
security rating. Core tiers cannot be reordered, and neither comfort nor security
may decrease at a higher rank. New tiers can be appended in a later policy
version without changing the domain shape. Display labels are descriptive only;
domain decisions use stable ids and numeric ratings.

A separate effect policy binds to the exact hierarchy digest and gives every tier
three monotonic capabilities: a basis-point multiplier for sleeping fatigue
recovery, a bounded private-storage capacity, and basis-point theft protection.
Recovery modifies only a non-positive recovery rate; it cannot turn ordinary
fatigue accumulation into recovery. Storage is unavailable at zero capacity.
Theft protection consumes an explicit deterministic 0-9999 roll, making the
outcome replayable without hiding randomness inside the domain function.

The versioned `config/housing-security-policy.json` adds a read-only attack
surface projection bound to the exact hierarchy and effect-policy digests.
Sleeping outside, a shared lockbox, a private room and a fortified storage
surface have distinct exposure, lock and trace parameters. It resolves the
housing tier and Property id through the data-driven HousingUnit catalog, so a
new house is added through Property/HousingUnit configuration rather than a
hardcoded city or building switch. A trusted observation verifier must attest
the actual location, housing access, placed storage and capacity; an attacker
does not learn these facts automatically. Property entry also requires the
authoritative door lock level in that snapshot and refuses a value below the
housing policy minimum. The projection does not override the Property lock,
open storage, perform Thieving or create witness knowledge by itself.

`recordHousingEntryTrace` is the first narrow evidence bridge. It requires an
audit-valid successful Property-burglary outcome, the matching denied Property
access snapshot, a matching trusted housing entry surface, and one immutable
server-attested detection roll. The roll verifier must bind a single roll to
the exact outcome, observation id and security projection. `HousingTraceRollStore`
now supplies that server-side source: it generates one 0-9999 roll per audited
successful entry, persists it with the outcome receipt and projection digests,
and returns the same roll on replay or restart. A changed binding is rejected;
callers must not reroll after a miss. The bridge still requires independent
trusted Property-access and surface verifiers; this ledger does not attest them. A
successful detection records only a `physical-trace` discovery in the existing
Thieving audit ledger. It contains no suspect id and can be admitted later as
separate case evidence. A miss returns a read-only decision and publishes no
observer knowledge. There is no current engine-owned storage-opening or actual
guard-line-of-sight snapshot, so neither is fabricated by this bridge.

This policy and projection add no persistent schema. Rollback disables its
consumer and removes the policy/module; existing HousingUnit, Property,
tenancy, furnishing and rights ledgers remain intact. A later execution adapter
must bind the projected surface to exact engine evidence and retain its own
migration/rollback plan if it persists new state.
The physical-trace bridge uses the existing Thieving discovery table, so no
schema migration is needed. Rollback disables only new bridge calls; already
recorded observations remain auditable and must not be deleted.
The roll ledger has a separate additive SQLite schema v1 with a one-to-one
roll/audit row and a hash chain. An empty database migrates transactionally;
newer schema versions are rejected. Rollback stops roll writers and bridge
consumers, then archives or restores the database together with WAL/SHM
sidecars. Never delete existing rolls while their outcomes remain usable: that
would permit a new draw after a previous miss.

`recordEngineHousingEntryTrace` connects the existing engine-owned Thieving
event to this bridge. It accepts only a persisted denied Property-burglary
entry with a matching procedure receipt, Property entry-point coordinates and
exactly one enabled housing unit. It derives the door security from the loaded
Property catalog, checks the engine hash chain before verification, and issues
the one-shot roll before publishing any trace. Replaying the same event returns
the same decision. New engine Property-access evidence includes the lock level
at event time, which the adapter uses even if the later Property catalog changes.
Legacy events remain readable and retain their original digest but cannot
produce a new trace without that snapshot. This is an additive JSON payload
change in the existing evidence table, with no table migration: new writers
include `lockLevel`, old rows are not rewritten. Rollback stops the new writer
and trace consumer; existing event digests and audit history must remain intact.
No engine-owned storage-open or actual witness/guard
line-of-sight event exists yet, so those remain separate work.

The engine now also records a bounded line-of-sight *candidate* snapshot on
successful Property-burglary entries. It stores the actor tile and active,
same-level player tiles within 15 squares that passed the engine's visibility
test. This is an opportunity to observe, not proof that a player paid attention,
recognized the actor or testified; it creates no discovery, case evidence or
automatic suspect. The existing engine evidence table gains a nullable
`sight_snapshot_json` column on startup; legacy rows retain their old event
digests and have no snapshot (different from an explicitly empty candidate
list). Rollback stops new snapshot writes and readers, and retains the added
column and audited rows; deleting or rewriting them would break the chain.

`config/thieving-witness-attention.json` is a versioned policy for those
candidate positions. The read-only projection verifies both engine and
procedure audit chains, the denied Property entry and the captured geometry,
then assigns a policy-bound attention probability by distance band. The
default 60%/30%/10% bands are provisional tuning values, not a witness event.
The projection alone creates no random decision or discovery.
This policy adds no persistent schema; rollback disables its consumer and
retains the underlying engine evidence and its audit history.

`WitnessAttentionDecisionStore` makes the separate server-owned decision:
one cryptographic random draw per event/observer pair, atomically stored with
the exact opportunity, outcome, policy and observer identity in a hash-chained
SQLite v2 ledger. The verified sight-snapshot username identifies a player
witness even without an agent binding; `observerAgentId` remains null rather
than inventing an agent. A later agent binding never rewrites that historical
decision. Replays, including after a miss or restart, reuse the original draw;
a changed policy or an existing agent binding cannot reroll it. A successful
draw writes a `direct-witness` Thieving discovery whose source digest links
back to the username-bearing decision, without revealing the offender's agent
id or creating legal evidence. A failed draw writes no observer knowledge.
Before enabling a v2 worker on a v1 ledger, stop writers and back up the v1
database together with its WAL/SHM sidecars. The v1-to-v2 migration
transactionally copies decisions and audit rows into a
nullable-agent schema and verifies both foreign keys and the audit chain before
commit; empty databases start at v2 and newer versions are rejected. Rollback
stops writers and consumers, archives the v2 database with WAL/SHM sidecars,
and restores a pre-migration v1 backup with its sidecars before using old code.
New player-only v2 decisions cannot be silently downgraded to v1; retain the
archive for a deliberate replay/migration instead of deleting issued draws.

`processEngineThievingBatch` is the bounded integration adapter for engine
evidence. It resolves avatars through `AgentStateStore` player control profiles,
ingests outcome receipts, and runs housing trace and player-witness decisions
only for applicable denied Property entries. An unbound offender stops the page
before its sequence is acknowledged. A sight candidate without an agent
binding is processed as a player-only witness, with the username from the
verified engine snapshot as identity and no invented agent. The function
returns a resume sequence and is
idempotent across retries, but it is not yet a background scheduler or durable
cursor service. No new schema is introduced by this adapter; rollback disables
its caller and preserves all source and decision ledgers.

`ThievingEventCursorStore` adds a separate append-only SQLite v1 cursor ledger.
It advances only across the next verified engine-event prefix after the batch
effects have completed. A crash between effects and cursor advance simply
replays the idempotent effects; an unbound offender leaves the cursor before
that event. The standalone `bun run thieving:watch` worker polls this cursor
until stopped, or processes one page with `--once`. The general local-stack
launcher starts it only with `scripts/start-local.ps1 -EnableThievingProcessor`;
without the switch, the worker remains off. The agent identity database must
already exist; the worker may initialize an empty engine evidence ledger at its
fixed local path before the first theft. A running stack without the worker must
be stopped and explicitly restarted with the switch to enable it. The status
command reports whether the worker was requested and whether its managed process
is still running; a stopped requested worker makes the stack unhealthy. The
worker does not receive the engine admin mutation token. Migration creates the
cursor table transactionally, rejects newer schemas, and leaves all previous ledgers
untouched. Rollback stops the worker and archives/restores the cursor database
with WAL/SHM sidecars; it must never be silently reset to skip an event.

`HousingUnit` references a stable Property id and contains an exact-capacity set
of `BedSlot` records. The separate SQLite tenancy ledger reserves a bed and tenant
atomically, snapshots rent terms and the unit-catalog digest, accrues rent on
simulation time, records arrears, and issues access only until the next rent due
time or fixed tenancy end. Rent payments require an immutable external payment
digest, are idempotent, and update tenancy plus a hash-chained audit entry in one
transaction. The resulting bed entitlement can be passed directly to the sleep
admission boundary; connectivity never creates tenancy or access.

Housing placement is data-driven in `config/housing-units.json`; no building id,
city or coordinate is compiled into the housing domain. Each entry references an
existing Property and can be enabled or disabled by configuration. Adding a later
built house means adding its Property definition and then a housing-unit entry.
Startup validation rejects unknown Property ids, duplicate beds and capacity
mismatches. Existing tenancies retain their snapshotted rent period and terms if
the editable catalog later changes; only new tenancies use the new configuration.

Furnishings are a separate data-driven extension in
`config/housing-furnishings.json`. The catalog defines the allowed bed, chest,
table or other furnishing types, their domain capabilities, and typed placement
slots inside known Properties. Placement requires immutable purchase evidence
for the concrete asset plus a digest from the Property authorization boundary;
neither untrusted chat nor an LLM can mint either proof. A SQLite ledger prevents
one active asset or slot from being used twice, snapshots capabilities at
placement time, and records placement/removal in a hash-chained audit trail.
Before a placement mutation or capability read, the ledger now replays its
audit entries against the materialized placement rows, including status,
revision and storage capacity. A modified row cannot silently advertise more
storage. New placement audit entries include the original capability snapshot,
so later catalog edits do not reinterpret it. Legacy entries without that
snapshot are checked against the original furnishing catalog and fail closed if
that definition is no longer available. Keep the old catalog until those
entries receive an explicit migration; do not weaken verification to accept a
changed capacity. This is not yet an engine-owned storage container, inventory
or access event. This intentionally provides a small housing capability layer instead of copying
RuneScape Construction mechanics.

`config/housing-storage-bindings.json` now connects each eligible placement slot
to one enabled HousingUnit and one security surface allowed at that unit's tier.
`projectPlacedStorageSecurity` requires the exact active placement, verifies the
furnishing ledger, binds its audited slot and capacity to that configuration,
then calls the existing security projection. Its digest identifies the placement
snapshot and binding version; an aggregate Property capacity, an empty slot, a
removed furnishing or a vanilla Thieving chest cannot stand in for the placed
storage. New houses need Property, HousingUnit, furnishing slot and storage
binding configuration, with no building id compiled into the adapter. This is
read-only: it neither asserts who owns deposited items nor opens a container,
moves items or creates a theft/discovery event. The binding catalog and adapter
add no persistent schema. Rollback removes their use and keeps the furnishing
audit intact; any later storage-content ledger needs its own migration and
rollback plan.

The hierarchy and effect policy definitions themselves create no persistent
state, so no data migration is required. Rollback removes those policies before a
consumer persists tier references. A future persistent reference must store the
exact policy identity and provide its own migration and rollback plan.

The tenancy database starts with additive tables; schema v2 snapshots the rent
period into every tenancy so later catalog edits cannot reinterpret it. Migration
is transactional and rejects missing referenced units or newer schemas. Rollback requires stopping tenancy
writers and restoring the database together with WAL/SHM sidecars; dropping the
ledger without archiving would destroy rent and entitlement audit history.

The furnishing ledger uses an additive schema-v1 database. This verification
change adds fields to new audit payloads but changes no table schema. Old and
new audit entries remain readable by the current verifier; reverting code does
not require a database migration, but it also removes the materialized-state
check. Existing placements retain their snapshotted capacity; legacy audit
entries require their original catalog definitions for verification until a
dedicated migration records those snapshots in the audit.
For rollback, stop furnishing writers and restore or archive the SQLite database
together with its WAL/SHM sidecars; deleting it loses placement and audit history.

Future land purchase and new construction remain an isolated extension boundary.
`config/land-construction.json` declares disabled land parcels, bounded world
rectangles and versioned blueprints/stages. The planning function accepts a
parcel only after configuration enables it and a trusted ownership-evidence
digest is supplied, then reserves a future Property id that must not already
exist. It returns an inert `planned` reference: no coins, map data or Property
state are changed. A later implementation must add its own atomic purchase and
construction ledgers, migration/rollback plan, map-content validation and trusted
completion adapter before any candidate becomes a real Property. Therefore this
preparation adds no persistent state and needs no data migration or rollback.
