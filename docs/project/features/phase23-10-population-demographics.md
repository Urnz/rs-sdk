# Phase 23.10 – verified demographic metrics

`GET /api/admin/population-demographics?fromSimulationTime=<canonical-UTC-ISO>`
returns demographic aggregates for all recorded finite memberships on the
gateway's exact shared clock/profile binding. The existing admin authorization
boundary applies. It exposes aggregate counts, coverage issues and provenance
digests; it does not return personal memories or skill lists.

The observation ends at the persisted common SimulationClock time, without
advancing it. Event windows are **(from,to]**: adjacent windows do not count a
boundary event twice. A from-time after the clock is rejected. The cohort includes
reset membership history, while current population, age structure and potential
workforce exclude reset and terminal avatars. Current living, current terminal
and reset membership counts partition recorded members; `recordedDeaths` also
includes deceased members later reset.

## Metrics and interpretation

- **Population and age structure:** current living/terminal/reset members,
  recorded engine deaths, pending AgentState death projections, and counts by
  configured age stage. Unknown birth remains an explicit unknown-age count.
  Stages and simulation year length come from the exact shared age policy.
- **Births and entries:** admissions, genesis admissions, seeded arrivals,
  population births and resets in the simulation-time window. Admission is
  counted once per member. A birth requires explicit `born` lifecycle origin,
  a known birth time within the window and birth on/after population entry.
  Adult imported arrivals are entries, never births. Backfilled pre-entry birth
  dates and identity registration are not population births. Birth is a separate
  event classification, not an extra admission added to population growth.
- **Deaths:** authoritative natural versus lethal engine deaths in the window.
  Engine-only terminal events already remove an avatar from living/workforce
  counts even before AgentState reconciliation. The read never projects them.
- **Specialist loss:** distinct people lost and per-specialism holder losses,
  based on their death-admission archived skill knowledge. Only exact configured
  skill IDs/versions with `known` or `preferred` status qualify. Several matching
  skills in one specialism count one person; one person can qualify for several
  specialisms. Missing or late-reconciliation archives are separate unknown
  profiles. Confirmed losses then form an explicit lower bound with `partial`
  status. Present-day skill records never stand in for a missing death profile.
- **Potential workforce and replenishment:** living people within the configured
  working-age range and workload-capacity threshold, unknown-age living members,
  eligible admissions, distinct existing members crossing into eligibility and
  eligible/unknown-age death losses. Eligibility is evaluated at admission,
  transition or death time as appropriate. An eligible arrival is not also
  counted as an existing member maturing at that same join instant. Per-specialism
  current potential holders use the live recorded skill-knowledge status.
  These are demographic capacity proxies, not employment, verified production,
  injury readiness, online status or permission to act.
- **Wealth inheritance:** current cumulative estate states, prepared/completed
  decisions, actual personal-Property title transfers, distinct heirs and native
  transfers awaiting coordinator acknowledgement. A prepared intent without title
  receipts transfers zero assets; an atomic title commit before acknowledgement
  counts its applied properties and remains explicitly awaiting completion.

Inheritance is limited to the implemented personal-Property MVP. Custody receipt,
approved plan, estate audit, engine death, source paths and immutable native title
history must agree. Replayed reads never double-count transfers, and a later
ordinary sale does not erase historical inheritance. Property counts are not GP:
`valueGp` remains `null` because verified monetary valuations are not recorded.
Inheritance receipts currently have audit wall times rather than simulation
event stamps, so `windowAttributedTransfers` is `null`. Their explicit basis is
`cumulative-native-property-history`; they are not silently assigned to the
simulation-time window. No currency, institutional wealth or business ownership
inheritance is inferred.

## Coverage and provenance

Each section has `status`, `value` and `issues`. `verified` zero is only emitted
after the necessary authoritative source was read and checked. Missing, stale,
unsupported or conflicting sources produce `unavailable` with `value: null`;
they never become empty replacement stores or zero metrics. A missing inheritance
source does not discard verified age/entry metrics. Missing engine authority
disables living/death/workforce metrics while persisted entry counts remain
available. Some missing death-time skill profiles produce `partial` loss metrics.
Malformed cohort/policy bindings reject the read rather than producing aggregates.

The report status is `complete`, `partial` or `unavailable`. HTTP is 200 for
complete/partial reports and 503 when every section is unavailable. Invalid
requests or conflicting gateway authority configuration are rejected. Source,
policy, age-policy and report digests preserve reproducible provenance for the
same observation/data; a different snapshot has a different digest.

The engine health/death source must be schema v2 and have its existing valid
producer heartbeat (30-second freshness with the existing 5-second future
tolerance). Its full audit chain is verified. Death IDs, immutable member binding,
shared clock and AgentState projections are cross-checked. A duplicate or orphan
death, mismatched projection or altered archive cannot establish a verified
demographic total. World-profile/lifecycle catalogs must match finite memberships
exactly. Other clocks are excluded.

An engine death observed beyond the reporting clock is rejected even if its
natural death event time is earlier: a clock rollback must not import a future
observation. An already projected death requires its terminal AgentState lifecycle;
reopening that lifecycle is an inconsistent source, not a live demographic member.

## Configuration and read-only operation

`config/population-demographics-policy.json` defines the working-age interval,
minimum workload capacity and explicit specialism skill references. Defaults:
18 inclusive to 70 exclusive simulation years, capacity at least 8000 basis
points, and configured gathering, fishing and bronze-production capabilities.
These descriptive rules grant no skill, role, asset or action authority. Policy
validation rejects duplicate/ambiguous definitions, invalid ranges and digest
drift. Specialisms compose skills; they are not profession-specific agent classes.

AgentState, engine evidence, estate coordinator and Property history are opened
read-only. Data is read in per-database SQLite snapshots with explicit statement
cleanup. No schema migration, journal-mode change, age observation write, memory
capture, death reconciliation, estate cycle, inheritance completion or live world
operation runs during a metric request. Missing directories/files are not created.
Read-only AgentState requires current schema v25; old stores report pending
migration rather than being modified by an observation endpoint. Existing writer
constructors retain their previous behavior.

The common clock is checked before and after collection. If simulation time
advances during the read, the report is unavailable instead of mixing two time
boundaries. Retry the request; pause the clock for a stable long observation if
needed. Source snapshots are per database, not a new global cross-database
transaction or a historical reconstruction of mutable skill state.

## Migration and rollback

No persistent schema or historical metric rows are introduced. AgentState stays
v25, engine authority v2 and estate coordinator v1. The added read-only constructor
mode and snapshot methods do not migrate or backfill. Deploying the endpoint
requires already migrated source stores. Rollback removes the endpoint/config and
read-only helpers without changing population, clock, assets or audit history;
no version marker downgrade or financial compensation is needed.

## Verification

Tests cover known/unknown ages, birth versus imported arrival, exact event-window
boundaries, seeded-entry replay, natural/lethal deaths, engine projection lag,
contemporaneous versus late skill archives, blocked/old skill versions,
specialism deduplication, eligibility transitions, reset history, missing/stale
sources, policy drift, source conflicts, stable report digests and empty verified
sources. Integration uses real isolated AgentState/clock/engine/archive stores,
checks the authenticated HTTP boundary and 503 response, and proves reads cannot
migrate, create or mutate source state. Real eight-source estate fixtures verify
completed and interrupted native inheritance without advancing the coordinator.
No production population, clock, bot or live engine is started for verification.

Final full `bun run verify:full`: **1623 pass / 0 fail / 0 skip**, exit 0,
including 31 new tests, format and root/engine/webclient typechecks. Evidence:
`.local/verification/20261014-193713-253-full.log`, with the native read-only cache
runner in `.local/verification/20261014-193712-320-phase23-10-full-consistency-final.log`.
The earlier full run also passed (1620 tests); the final run was warranted by
the added death-observation/lifecycle consistency guards and three regression
cases. The final aggregation/source/HTTP focus was **29 pass / 0 fail / 0 skip**
plus root typecheck (`.local/verification/20261014-193621-201-phase23-10-final-consistency.log`).
