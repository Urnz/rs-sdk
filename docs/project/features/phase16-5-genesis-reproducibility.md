# Phase 16.5 – Reproducible genesis result envelope

## Contract

`WorldGenesisRunConfiguration` binds a genesis run to all inputs that may affect generated state:

- the explicit seed;
- profile id, semantic version and verified profile digest;
- the local LostCity world build;
- simulation clock id, profile digest and canonical initial simulation time;
- a bounded, canonical JSON parameter object for future generator-specific inputs.

`WorldGenesisResult` records the canonical configuration digest, canonical output digest and a final result digest.
Its `resultId` is derived from the final digest. `generatedAtAudit` is retained as wall-clock audit metadata but is
deliberately excluded from all deterministic digests, so rerunning identical inputs remains reproducible.

## Deterministic entropy

`worldGenesisEntropy` derives bounded integers from SHA-256 using the configuration digest, seed, namespace and
stable entity key. Generators must request high-level namespaces such as `profession` or `property-owner`; they
must not consume a shared sequential random stream. This prevents insertion or reordering of one entity from
silently changing every later assignment.

The algorithm is explicitly identified as `sha256-v1`. Changing it requires a new algorithm identifier and must
not reinterpret persisted results.

## Trust and bounds

Runtime validation is applied again before digesting a configuration or building a result. It rejects unknown
fields, non-canonical timestamps, invalid profile/clock digests, unsafe or fractional numbers, non-plain objects,
oversized strings and excessively deep or large JSON trees. Profile definition tampering is rejected before a
configuration can be built.

## Persistence, migration and rollback

This slice does not add a database or write engine/domain state, so no persistent migration is required. Results
are immutable value objects ready for the later dry-run/apply store. Rollback removes the result-envelope module
and its tests; no save, currency, inventory, property or business rollback is involved.

## Verification

- `bun run typecheck`
- `bun test world-genesis/test`
- stable key-order-independent digests, seed-sensitive namespaced entropy, audit-time independence and hostile
  input rejection
