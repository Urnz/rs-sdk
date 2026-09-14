# Phase 16.4 – World genesis profiles

## Scope

This slice introduces a versioned, declarative `WorldGenesisProfile` contract. It does not mutate a world,
create currency or items, or reset persistent state. Execution, provenance-tagged genesis results and the
admin dry-run/apply/reset workflow remain separate follow-up slices.

The canonical catalog is `config/world-genesis-profiles.json`. Each validated definition receives a SHA-256
digest over a canonical, key-sorted representation. The digest therefore identifies the complete policy and
changes whenever a profile field changes; versions are explicit semantic versions.

## Built-in profiles

- `blank-slate`: preserves existing world buildings but generates no ownership, starter inventory, business or
  economic network.
- `frontier`: supplies food, tools, shelter and a small stake without constructing an operating economy.
- `seeded-economy`: assigns professions and generates ownership, wealth, businesses and productive inventory.
- `mature-society`: additionally requests stratified wealth, contracts, leases and institutions.
- `historical-burn-in`: starts from `seeded-economy` and reserves ninety simulation days of `agent-only` access.

The burn-in duration is expressed in simulation milliseconds. Wall time and engine ticks must never be used to
decide when player access opens.

## Safety boundaries

Validation rejects unknown fields, missing built-in profiles, duplicate profile IDs, invalid semantic versions,
unbounded populations and recursive historical burn-in. The population cap is deliberately finite. A burn-in
source cannot itself be `historical-burn-in`.

No random seed belongs to the reusable profile definition. A later genesis request/result will bind the selected
profile digest, an explicit seed, the world build and the generated output digest. This prevents the same policy
from being needlessly duplicated for every seed while retaining reproducibility at execution time.

## Migration and rollback

This slice adds no persistent database schema and requires no data migration. Rollback consists of reverting the
`world-genesis` package, its catalog and test-script registration. Since no profile is executed by this slice,
rollback cannot remove or alter player saves, money, items, property or business state.

## Verification

- `bun run typecheck`
- `bun test world-genesis/test`
- catalog coverage, stable digest, required economic semantics, strict-field and bound rejection tests
