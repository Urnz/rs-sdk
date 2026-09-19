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

These slices are configuration-only and create no persistent state, so no data
migration is required. Rollback removes the housing policy and module before a
consumer persists tier references. A future persistent reference must store the
exact policy identity and provide its own migration and rollback plan.

The tenancy database starts at schema v1 in new additive tables. Migration is
transactional and rejects newer schemas. Rollback requires stopping tenancy
writers and restoring the database together with WAL/SHM sidecars; dropping the
ledger without archiving would destroy rent and entitlement audit history.
