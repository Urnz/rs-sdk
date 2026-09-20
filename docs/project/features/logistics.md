# Bounded logistics domain

The `logistics` domain defines Property/storage endpoints, directed routes and
carrier modes in version-controlled data. A shipment plan derives exact cargo
units, capacity, simulation duration and GP cost. The initial route connects a
Varrock workshop loading bay to Falador delivery storage. A walking courier
carries 28 units, while a handcart carries 120 units and completes the route in
half the time at a higher explicit cost.

Planning is fail-closed. The actor needs a trusted Business-role evidence whose
role has `logistics.operate`, plus exact source and target Property/storage
entitlements. A vehicle additionally requires a trusted facility authorization
for `logistics.cart-bay` at the source Property. A high skill, a matching text
label or an LLM claim cannot replace these typed grants. Cargo above capacity,
foreign storage, missing vehicle authority and catalog tampering are rejected.

The plan is inert and contains a stable digest; it does not teleport goods or
charge money. Physical movement and settlement must later use a verified
transport skill and an atomic Business inventory/treasury operation.

## Migration and rollback

There is no persistent schema migration in this planning slice. Role definitions
gain an additive `logistics` permission domain, and the facility catalog gains
the `logistics.cart-bay` capability. Rollback disables new plans using these
entries. Retain already referenced catalog digests in shipment evidence and do
not reinterpret completed transport under a changed route distance or carrier
cost.
