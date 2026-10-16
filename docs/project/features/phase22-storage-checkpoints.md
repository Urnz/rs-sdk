# Phase 22.2 – protected storage and checkpoint evidence

## Storage lifecycle

`config/housing-engine-storage-locations.json` maps an exact engine loc
(type and tile) to one Housing placement ID. A configured loc is usable as a
Thieving container only when the furnishing journal still contains that exact,
active storage placement and its slot, HousingUnit and security-surface binding
all validate. The engine snapshots placement revision, Property state version,
owner, actor entitlement, lock level and trace policy before the transfer.

Authorized access is not recorded as theft. An unauthorized actor must meet the
configured Housing lock level before the vanilla reward step can continue.
Successful transfers retain the snapshot in the append-only Thieving evidence
journal. Existing sight-candidate capture supplies the real witness/guard path;
the separate server-owned one-shot trace roll can supply anonymous physical
trace evidence. A missed roll is persisted and replayed, not rerolled.

Adding another protected building is data work: Property, HousingUnit,
furnishing slot, storage-surface binding and exact engine-loc mapping. The
runtime contains no building-ID exception.

## Checkpoint lifecycle

`config/crime-checkpoints.json` binds a permitted policy rule to one exact
checkpoint tile and configured inspector. Merely entering the area creates no
event. An explicit server search at the world-tick boundary captures only the
subject's then-present inventory item IDs and quantities in the engine journal.

Recognition is a second typed operation. It can refer only to an item captured
by that search. Positive and negative results are both durable, and
`inspectionId + assetId` is unique, so a failed recognition cannot be retried
under a new detection ID. The independent checkpoint ledger accepts only exact
facts re-read from the chain-verified engine journal. Only a positive detection
combined with its permitted search projects exposure. Heat, proximity and an
unsearched inventory item are never recognition sources.

The two internal engine endpoints are authenticated by `ENGINE_ADMIN_TOKEN`:

- `POST /api/internal/admin/checkpoint/search`
- `POST /api/internal/admin/checkpoint/detection`

They create evidence only. Findings, guilt, sanctions and money movement remain
separate later-phase authority decisions.

## Persistence migration and rollback

The Thieving journal migration is additive: `storage_access_json` is nullable,
so legacy rows keep their original digest and remain readable. Rollback uses the
previous binary against the same database; SQLite ignores the unused extra
column. Do not remove or rewrite historical rows.

Checkpoint engine evidence uses a new schema-v1 SQLite file. Rollback disables
the two checkpoint operations and preserves the file. An older build does not
open it. Restore by redeploying the new build and reopening the same file; its
hash chain and negative decisions remain intact. Corrupt or newer schemas fail
closed for reads and writes.
