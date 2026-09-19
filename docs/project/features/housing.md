# Housing domain

Housing quality is a versioned security and comfort hierarchy independent from
Property ownership. The required baseline progresses through street, temporary
shelter, shared dormitory, rented room, owned home and fortified property.

Each tier has a stable id, contiguous rank, tenure category, comfort rating and
security rating. Core tiers cannot be reordered, and neither comfort nor security
may decrease at a higher rank. New tiers can be appended in a later policy
version without changing the domain shape. Display labels are descriptive only;
domain decisions use stable ids and numeric ratings.

This slice is configuration-only and creates no persistent state, so no data
migration is required. Rollback removes the housing policy and module before a
consumer persists tier references. A future persistent reference must store the
exact policy identity and provide its own migration and rollback plan.
