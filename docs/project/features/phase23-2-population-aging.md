# Phase 23.2 – birth-derived age and configurable stages

`PopulationMember` age is calculated from the immutable character birth time
and its exact shared SimulationClock. `AgentStateStore.getPopulationAge` is the
backend entry point; `evaluatePopulationAge` is the deterministic domain
projection. Cached age observations do not override a recorded birth time.
The existing observation-anchor calculation remains available for legacy
character records, but a population member with no recorded birth is explicitly
`unknown`, with no stage or modifiers. Creation or membership time is not birth
evidence. Birth registration uses the existing revision-checked
`setCharacterBirth` operation; future birth, replacement birth and invalid
origin are rejected.

## Policy and domain contract

`config/population-age-policy.json` binds by exact id/version/digest to the
finite lifecycle policy introduced in 23.1. It leaves those existing policy and
world-profile digests intact. The age policy has its own version and computed
digest, both returned with every observation. A policy change must use a new
version; consumers comparing observations must compare their policy references.
The loader validates every field and produces a stable digest regardless of
JSON object key order. Stale lifecycle or age-policy digests, mismatched agent
identity and another/reconfigured clock fail closed.

An age year is an explicit duration, initially 365 simulation days
(`31,536,000,000` ms), rather than a wall-time or calendar anniversary. The clock
rate controls acceleration; pausing the clock pauses aging. Default stages are
child (0), adolescent (12), adult (18), older-adult (50), and elder (70).
Each lower boundary is inclusive; the next lower boundary is exclusive for the
preceding stage. The last stage has no upper limit and does not cause death.
Configuration may change the year duration, stage ids and strictly ascending
integer boundaries. Stages must start at zero, have unique ids, and remain
within safe integer millisecond arithmetic.

Every known active observation exposes typed regeneration, workload capacity
and risk modifiers in basis points (10,000 = 1×), bounded to 0–40,000.
This is a domain interface for later health/work/risk consumers, not merely a
display field. This slice does not yet apply these modifiers to game mechanics,
sample mortality, create health state or perform death/estate transitions.

Reset population observations freeze at the recorded reset time and return no
active modifiers. Deceased character observations freeze age at the recorded
status-change time and also return no active modifiers. This projection does
not introduce a death operation. The underlying 23.1 membership history is
preserved across restart and reset.

The admin agents API and autonomy status route pass the real AgentState path
and shared clock to the backend; agent results include `populationAge` alongside
the existing lifecycle and membership. A missing clock exposes unavailable
population-age data, and missing birth remains visibly unknown. No admin UI
redesign is included.

## Persistence and rollback

No persisted model or schema changes are needed: AgentState remains v22.
Birth, cached age observations, membership and clock references use existing
columns; stages and modifiers are derived on demand and are not rewritten into
SQLite. Upgrading performs no birth backfill and invents no historical ages.
Existing read-only calls without a clock retain the stored observation view.

Before changing birth records, stop writers and back up the AgentState database
with its WAL/SHM sidecars using the established 23.1 procedure. Application
rollback removes the age projection/configuration and restores the earlier
code; it requires no schema downgrade. Valid birth/age records written through
the existing API remain compatible with the previous v22 reader. To reverse
birth registration itself, restore the complete backup rather than editing the
immutable birth column or deleting membership history.

## Verification

`population-lifecycle/test/age.test.ts` checks every exact boundary, configurable
scale/stages/modifiers, digest stability, missing birth, unsafe configuration,
future/overflow times, stale bindings and historical projections.
`agent-state/test/population-aging.test.ts` checks accelerated shared-clock
aging, pause/resume, restart, reset, immutable birth, revision conflicts,
authoritative birth over cache, unavailable/reconfigured clocks and admin API
parity. Existing lifecycle and genesis suites cover compatibility with 23.1.
