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
This intentionally provides a small housing capability layer instead of copying
RuneScape Construction mechanics.

These slices are configuration-only and create no persistent state, so no data
migration is required. Rollback removes the housing policy and module before a
consumer persists tier references. A future persistent reference must store the
exact policy identity and provide its own migration and rollback plan.

The tenancy database starts with additive tables; schema v2 snapshots the rent
period into every tenancy so later catalog edits cannot reinterpret it. Migration
is transactional and rejects missing referenced units or newer schemas. Rollback requires stopping tenancy
writers and restoring the database together with WAL/SHM sidecars; dropping the
ledger without archiving would destroy rent and entitlement audit history.

The furnishing ledger uses an additive schema-v1 database. Catalog changes affect
new placements only because active placements retain their capability snapshot.
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
