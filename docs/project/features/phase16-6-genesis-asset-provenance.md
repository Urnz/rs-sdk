# Phase 16.6 – Genesis asset provenance

## Purpose

Bootstrap value must remain distinguishable from value produced by gameplay or the simulated economy.
`WorldGenesisProvenanceStore` is a dedicated append-only ledger for the initial lots created by a verified
genesis result. It supports four typed asset classes:

- currency, with an economic owner and exact GP amount;
- items, with owner, container, item id and count;
- property ownership, with owner and stable property id;
- businesses, with owner, business id, opening capital and opening-inventory digest.

Every row has the fixed source `world-genesis` and binds the immutable allocation to its result id, result digest,
configuration digest, simulation time and wall-clock audit time. The canonical asset payload has its own SHA-256
digest. Queries can separate genesis lots by result or by current bootstrap owner without treating the domain's
ordinary balance as proof of origin.

## Atomicity and trust boundary

`recordResult` first revalidates the complete genesis result and verifies that its digest-covered output contains
the exact bounded asset array. Duplicate allocation ids, result tampering, invalid owner kinds and invalid amounts
are rejected before the SQLite transaction starts. The complete asset set is then inserted in one immediate
transaction. Repeating the identical result and simulation time is idempotent; reusing an allocation with changed
provenance is rejected.

This ledger does not mint currency, edit a save, transfer property or create a business. The later apply
orchestrator must make the authoritative domain mutation and provenance registration one recoverable operation;
it must never create bootstrap value first and add provenance later as a best-effort side effect.

The ledger identifies initial genesis lots. Fungible coin and item movement after bootstrap still belongs in the
normal economic/audit ledgers; a current wallet balance must not be labelled wholly genesis-origin merely because
that owner once received a genesis lot.

## Migration and rollback

The dedicated SQLite schema starts at `user_version = 1` and creates `genesis_asset_provenance`, with a unique
`(result_digest, allocation_id)` key and an owner/kind index. It does not alter existing player, property,
treasury or business databases.

Before upgrading an existing genesis-provenance database, copy the `.sqlite`, `-wal` and `-shm` files while the
stack is stopped. Rollback requires stopping the stack, restoring that complete file set, and running code that
supports the restored `user_version`. For this initial additive database, rollback may instead remove only the
dedicated genesis-provenance database if no genesis apply has ever been committed. Never delete it after an apply,
because that would orphan bootstrap value from its origin evidence.

## Verification

- `bun run typecheck`
- `bun test world-genesis/test`
- four asset kinds, immutable/idempotent recording, atomic duplicate rejection, owner query, result-tamper and
  numeric-bound rejection
