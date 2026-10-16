# Audited reputation and reintegration

`crime-reintegration/` retains its versioned policy projection and now adds two
separate persistent v1 ledgers. The evidence ledger accepts only
typed, source-attested completed restitution, paid compensation, completed
community service, completed sentence, granted forgiveness, and completed
religious penance. A verifier must resolve the event against its authoritative
source; a digest-shaped string or client/LLM assertion is not proof. Observer and
community knowledge is a second attestation bound to the exact event and audience.
Both records are append-only and hash-chained; missing or damaged evidence fails
closed.

Reputation is observer- or community-scoped. It additionally requires an
independently verified knowledge receipt for that exact audience and event;
hidden events cannot change public reputation. Forgiveness affects only the
forgiving observer. Religious penance may change only the configured world
profile's optional moral-standing projection. Mere prayer is not an accepted
event and never increases anyone else's opinion.

The state ledger consumes an accepted policy projection exactly once per event,
subject, projection and audience. Reputation keys are observer- or
community-specific. Moral standing is keyed only to the configured world profile
and remains optional. There is deliberately no global subject score and no API
that converts these values into legal authority or sanctions.

The admin agent context reads only observer-scoped applied adjustments whose
event and knowledge records still pass both audit chains. It emits a bounded,
source-ID-bearing `Known completed reform effort` description. It never exposes
another observer's or community's knowledge. The existing personally witnessed
suspect description remains separate, so hidden theft cannot become public
reputation through this module.

The ledgers do not import or write jurisdiction findings, sentence history,
item title/custody/provenance, or agent identities. Consequently prayer is not an
event, penance can affect only configured moral standing, and neither penance nor
any social improvement erases legal or ownership history or rewrites
`personalityTraits`.

Persistence defaults to `.local/crime/reintegration-evidence.sqlite` and
`.local/crime/reintegration-state.sqlite`; both use schema version 1. There was no
earlier persistent reputation state to migrate. Deployment must back up both
files with WAL/SHM sidecars before policy or binary rollback. Rollback may stop
new consumers or restore an earlier policy, but committed evidence and adjustment
ledgers must be retained as audit history rather than deleted or backfilled from
free-form memories.
