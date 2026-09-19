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

These slices are configuration-only and create no persistent state, so no data
migration is required. Rollback removes the housing policy and module before a
consumer persists tier references. A future persistent reference must store the
exact policy identity and provide its own migration and rollback plan.
