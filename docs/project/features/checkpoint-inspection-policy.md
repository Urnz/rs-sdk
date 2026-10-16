# Checkpoint inspection policy gate

`crime-checkpoints` is a read-only, versioned policy gate. It does not read player
inventories, item provenance or heat on behalf of an observer. A configured
jurisdiction/location/checkpoint triple only grants permission to inspect. The
default for an absent or denied checkpoint is no exposure.

An asset identifier is returned only after a separate trusted inspection record
and a matching, later, positive detection record have both been verified by
source-specific callbacks. They must agree on the inspection and subject. An
unrecognized item, location entry, possession, high heat or a stolen provenance
fact alone reveals nothing. The positive result is an observation, not proof
that the holder stole the item or knew its history; it cannot cause a finding,
arrest, fine or seizure.

The policy definition has schema version 1, semantic version, effective time
window and SHA-256 digest. This module has no database or persistent schema
change, so no data migration is needed. Rollback removes the unused projection;
it does not erase any inspection evidence held by a future trusted source.
Live use must supply audited source verifiers and a pinned, effective policy
version; this module does not create those sources or wire an engine search.
