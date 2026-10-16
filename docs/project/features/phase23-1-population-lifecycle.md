# Phase 23.1 – finite population membership

## Contract and boundary

Phase 23.1 binds character lifecycle records to an explicit world-profile
policy. `mature-society@1.0.0` and `historical-burn-in@1.0.0` are the current
social-simulation profiles and resolve, by exact profile and policy digest, to
`finite-population@1.0.0`. That policy has terminal death semantics and forbids
respawn. `classic-respawn-compatibility@1.0.0` is a separate, unbound
compatibility/experiment policy and cannot create a `PopulationMember`.

This slice does not implement age stages, mortality, health, death transitions,
estate settlement, inheritance, memory transfer or population replenishment.
Those remain the subsequent Phase 23 tasks.

## Genesis lifecycle

A finite-profile genesis result must contain a unique `populationMembers` list
within the selected profile's population bounds. Each entry names an existing
agent and its exact player avatar. Preview fails closed unless all of the
following agree:

- the configured profile, binding and lifecycle-policy digests;
- the genesis result and live shared SimulationClock identity/profile;
- player identity, player control profile and avatar username;
- an active `AgentCharacterLifecycle` whose creation precedes membership;
- either no previous membership or the exact same active genesis binding.

Apply persists one `PopulationMember` per entry with the exact profile, policy,
clock and genesis result references. Exact apply replay is idempotent; a
different or already-reset membership is rejected. Gateway startup supplies the
real AgentState database and shared SimulationClock to the local genesis
adapter. Reset preserves the row as historical evidence and changes its status
to `reset`; it does not delete the agent or its character lifecycle. Rollback
tokens are version 2, while the adapter still accepts version-1 tokens from
pre-23.1 asset-only runs as containing no population members.

## Persistence migration and rollback

AgentState schema v22 adds `agent_population_member` and an index for exact
genesis-result membership. The migration is additive and intentionally performs
no historical backfill: an existing player identity or character lifecycle is
not proof that it belonged to a finite genesis population.

Before upgrade, stop AgentState writers and copy the SQLite database together
with its WAL and SHM sidecars. Application rollback may leave the unused v22
table in place. For a physical schema downgrade, archive the v22 files and
restore the complete v21 backup. Do not synthesize membership rows, delete reset
history or rewrite the genesis/clock references during rollback.

The two policy catalogs are versioned source configuration. Changing a profile
or policy requires an explicit new version/digest and updated binding; stale
bindings fail closed.

## Verification

- `population-lifecycle/test/policy.test.ts` covers exact policy/profile binding,
  bounded membership and the unbound classic compatibility policy.
- `agent-state/test/population-membership.test.ts` covers schema migration
  without backfill, exact replay, conflict rejection, restart, snapshot exposure
  and auditable reset.
- `server/gateway/admin/local-world-genesis-adapter.test.ts` covers the complete
  preview/apply/replay/restart/reset path for a four-member mature society.

