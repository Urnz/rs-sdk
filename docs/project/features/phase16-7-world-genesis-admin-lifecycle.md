# Phase 16.7 – World genesis admin lifecycle

## Implemented control plane

The backend now exposes the bounded lifecycle needed by a world-genesis administrator:

- `GET /api/admin/world-genesis/profiles` lists the canonical profiles and digests;
- `GET /api/admin/world-genesis/runs` lists durable application/recovery state;
- `POST /api/admin/world-genesis/preview` performs adapter-defined read-only checks;
- `POST /api/admin/world-genesis/start` requires the exact preview result digest;
- `POST /api/admin/world-genesis/:resultId/reset` requires both the exact result digest and current revision.

All endpoints are behind the existing local-admin authorization boundary. Preview, start and reset write explicit
success/failure entries to the admin audit chain. The API does not include a bypass that turns preview into apply.

## Human approval

The human approves one immutable genesis result digest. That digest covers the seed, profile/version/digest,
world build, SimulationClock reference, parameters and exact generated output. Approval does not mean accepting a
profile name in general, nor permission for later changed output. Start rejects any digest other than the one shown
by preview. Reset separately requires the same digest plus optimistic concurrency revision.

## Durable recovery

`WorldGenesisRunStore` schema v1 journals `applying`, `applied`, `resetting`, `reset` and `rollback-required`.
The apply adapter must capture all rollback tokens before the journal enters `applying`. A successful domain apply
is followed by the immutable asset-provenance write and a verified receipt. Any error after journalling leaves an
explicit `rollback-required` state rather than claiming success.

Adapter outputs are untrusted at runtime: preview shape, canonical simulation time, rollback JSON and apply/reset
receipts are bounded and validated. Preview cannot create backups or mutate state by contract.

## Local LostCity adapter status

The production gateway now installs `LocalLostCityWorldGenesisAdapter`. It supports verified, additive player GP,
inventory, bank and slotted equipment allocations while the target save is exclusively offline. Prepare persists
the complete pre-genesis save in the rollback token; apply uses the engine offline-editor boundary and verifies the
returned save; reset writes and verifies the exact pre-genesis state. Capacity, stack overflow, occupied equipment
slots and online/missing saves fail during preview.

The adapter also supports property allocations through the authoritative property primitive below, genesis-created
businesses, business-stock items, business opening capital and explicit business/faction treasury allocations.
Business creation and every economic credit are atomic within their authoritative store and retain allocation-level
genesis receipts. Preview verifies business existence, opening-inventory digests, inventory/currency overflow and
treasury capacity before the application journal is opened.

A multi-domain failure remains in `rollback-required`; reset can restore from the persisted pre-state even when
apply failed before returning its final receipt. Missing receipts are treated as operations that were never reached,
so partial application is recoverable. Reset subtracts only the matching genesis stock/currency lots and refuses to
delete a genesis-created business if later activity left inventory, treasury funds, reservations, employment or
policy state behind.

## Authoritative property primitive

The first production adapter dependency is now implemented end to end as
`PropertyStore.assignGenesis` / `/api/internal/admin/properties/genesis-assign`. It atomically changes only an
`available`, unowned property at the expected version, records an immutable allocation receipt, and is idempotent
for the same request. It never creates a purchase record or debits a wallet, so bootstrap ownership cannot be
misreported as market activity. The existing optimistic `properties/reset` operation restores availability while
the genesis assignment remains as audit history.

The new `property_genesis_assignment` table is additive to the existing property SQLite database. Before deploying
this schema, back up the property `.sqlite`, `-wal` and `-shm` files with the stack stopped. Rollback must restore
that complete pre-change set; dropping only the assignment table after use would retain ownership without its
genesis receipt and is forbidden.

## Business and treasury schema additions

The existing business database gains `business_genesis_creation`, `business_inventory` and
`business_genesis_inventory`. The treasury database gains `institution_treasury_genesis`. These tables are additive
and are created with `CREATE TABLE IF NOT EXISTS`; the original business, employment, policy, treasury, reservation
and transfer rows are not rewritten.

Before deployment, stop the gateway and copy each affected `.sqlite`, `-wal` and `-shm` set. Rollback restores the
complete pre-upgrade file set together with a compatible binary. Do not drop only the genesis receipt tables after
an apply: doing so would preserve minted balances or inventory while deleting their origin and reset evidence.

## Migration and rollback

The dedicated run database uses `user_version = 1` and does not change existing domain schemas. Before an upgrade,
copy its `.sqlite`, `-wal` and `-shm` files while the stack is stopped. Rollback restores the full file set and a
compatible binary. If no apply has ever begun, the run database may be removed. Once an apply exists, retain both
run and provenance ledgers even after reset as audit evidence.

## Verification

- `bun run typecheck`
- `bun test world-genesis/test server/gateway/admin/world-genesis.test.ts server/gateway/admin/local-world-genesis-adapter.test.ts server/gateway/admin/business-manager.test.ts server/gateway/admin/institution-treasury.test.ts`
- read-only preview, digest confirmation, idempotent apply, durable provenance, verified reset, apply/reset failure
  recovery, partial multi-store recovery, player/property/business/stock/treasury lifecycle and invalid
  adapter-output rejection
