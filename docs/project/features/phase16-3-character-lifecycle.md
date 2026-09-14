# Phase 16.3: lifecycle-compatible character identity

## Model boundary

Biological lifecycle belongs only to an agent whose control profile role is
`player`. Institution, service and World Director identities do not receive a
fictional age. `AgentCharacterLifecycle` is stored separately from descriptive
identity and contains:

- simulation time when the character record was created;
- an optional immutable birth simulation time;
- age accumulated at a named simulation-time observation;
- current age projected from that observation through the shared clock;
- lifecycle status (`active` now, with `deceased` reserved for a later verified
  death transition);
- origin (`created`, `imported` or `born`) and optimistic revision metadata.

Age is measured as non-negative integer simulation milliseconds. Wall clock and
engine tick never age a character directly. While status is active, reads derive
current age from the clock's latest canonical simulation time; an explicit age
observation can persist that derived value as a new revision. Recording a birth
time recomputes age at the current simulation observation and rejects a future or
non-canonical timestamp. Once present, birth time cannot be rewritten.

This slice stores lifecycle status but deliberately does not implement aging
effects, death detection, respawn policy or inheritance. Those require later
verified domain events and policy. No LLM or chat input can mutate lifecycle
state through a free-form tool.

## Migration and rollback

AgentState schema v21 adds `agent_character_lifecycle`. When an existing database
is opened with the shared clock, player identities missing a lifecycle row are
backfilled deterministically in agent-ID order at the clock's current simulation
instant. They use `imported` origin, unknown birth time and zero baseline age;
the migration never invents historical age. New player identities created while
the clock is available receive a `created` lifecycle in the same AgentState
transaction. Existing wall-clock identity timestamps remain unchanged.

Before migration, stop AgentState writers and copy the SQLite database plus WAL
and SHM sidecars. Application rollback may leave the additive v21 table in place.
For a physical downgrade, archive v21 and restore the complete v20 backup. Never
derive or erase a birth time during rollback; reconcile lifecycle metadata
forward after restoring service. No player save, economy balance or world-clock
record is changed by this migration.

## Verification

`agent-state/test/framework.test.ts` covers player-only legacy backfill,
institution exclusion, immutable birth registration, accelerated simulation-age
projection, persisted age observation and optimistic revision behavior. Existing
AgentState control and autonomy suites provide regression coverage for the v21
migration path.
