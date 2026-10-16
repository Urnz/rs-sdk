# Typed Thieving procedure drafts

Phase 22 begins by wrapping the existing RuneScript Thieving mechanics rather
than creating a second Thieving or Burglary personal skill. Four exact-version
agent-skill drafts now exist:

- `procedure.thieving.pickpocket@0.1.0`;
- `procedure.thieving.lockpick-door@0.1.0`;
- `procedure.thieving.container-theft@0.1.0`;
- `procedure.thieving.property-burglary@0.1.0`.

Each procedure has one bounded operation and an explicit `Thieving` level
precondition. NPC names must match exactly. Location targets additionally require
exact world coordinates, preventing a broad name such as `Door` or `Chest` from
selecting an unintended nearby object.

## Evidence boundary

The SDK runtime records the resolved NPC/loc ID, position, start/end tick,
Thieving XP delta, inventory delta, relevant system messages and the low-level
interaction result. Success requires an observed XP or item gain; sending an
interaction packet alone is not success.

The SDK-side evidence is deliberately marked:

- `source: sdk-observation`;
- `trusted: false`;
- `receiptEligible: false`.

It can diagnose and verify the declarative procedure, but it cannot create a
rights violation, discovery report, criminal allegation or punishment.

The engine now has a separate trusted path for successful vanilla interactions.
`thieving_evidence_begin` snapshots the authoritative target, inventory,
Thieving XP and world tick inside the running RuneScript. A matching
`thieving_evidence_commit` derives the delta after the effect and appends it to
the hash-chained `thieving_engine_evidence` SQLite journal. Pickpocket, stall,
trapped/locked chest and locked-door success paths are instrumented. A missing
item delta, mismatched effect or journal failure produces no trusted event and
never falls back to SDK observations.

Configured Property doors expose a separate `Pick-lock` interaction. Its lock
level, XP, success numerator/denominator and lockpick requirement come from each
Property catalog definition rather than a hard-coded building list. The engine
refuses this route for unowned properties and already authorised actors. On
success the vanilla door procedure physically moves the player through the door
before the script commits a `property-burglary` / `entry-completed` outcome.

For completed entry the engine snapshots the exact Property and entry point,
owner, Property state version and access decision at commit time. Consequently a
later ownership transfer cannot rewrite who owned the entitlement at the time
of entry. The `projectPropertyEntryViolation` adapter revalidates both audit
chains, the engine digest, procedure receipt and denied event-time snapshot. It
then creates one idempotent `entry-entitlement` / `enter` rights-violation event.
This is still a world-truth rights event, not discovery, guilt or punishment.

The engine journal deliberately identifies the player avatar, not an agent. The
gateway bridge requires an explicit current avatar-to-agent binding before it
can promote an engine event into a `ThievingProcedureStore` receipt. Promotion
rechecks the source hash chain and digest and is idempotent. This prevents the
engine from reading agent administration state and prevents a username from
silently becoming an agent identity.

Completed pickpocket and container/stall item transfers now capture the same
bounded engine line-of-sight snapshot as completed Property burglary. The
shared witness projection admits these audited transfer kinds, while retaining
the strict Property-only compatibility entry point. Authorized Property access
cannot become an item-theft witness opportunity; unlocking a door alone is not
treated as entry. The existing configured distance/attention rates are reused
without changing their policy ID, version or digest. Noticing a transfer creates
only an anonymous-actor discovery, never automatic recognition, a property
entitlement violation, or guilt. The normal processor and both explicit notice
ledgers accept these discoveries. The local live runner can include a separate
player-only observer; HTTP notice authentication is not part of that runner.

The dedicated `ThievingProcedureStore` is that persistence boundary. It accepts
an outcome only through an explicit trusted-server verifier, consumes every
source evidence ID once, stores the exact procedure/actor/target/effect/item
transfer and writes a hash-chained audit entry. Failed or blocked attempts cannot
claim XP, item movement or another completed effect; successful effects must
match the procedure kind.

Discovery remains a second record. An owner may discover a loss without naming a
suspect, while a direct witness may identify only the world-truth actor. The
discovery object never copies the hidden actor automatically, and every witness,
alarm, trace or report requires its own verifier and evidence digest. These
observations still are not legal findings.

All four definitions remain `draft`. Publication still requires two independent
matching live runs and the existing explicit human approval flow. No autonomous
authorization risk class currently permits the new `thieve-*` operations;
attempting to include one in a routine authorization fails closed.

## Migration and rollback

`WitnessRecognitionStore` now provides a separate v1 SQLite source journal.
It implements the recognition port, canonicalizes the exact typed fields,
computes the source digest and requires an independent server verifier even
on exact replay. Payload and append-only audit entries are committed in one
immediate transaction; missing/tampered audit coverage refuses reads and writes.
This durable derived source boundary is now backed by the independent
`EngineWitnessInspectionStore` through an explicitly dependency-verified engine
port. An echo-hash verifier is suitable only for tests, never production.

Migration creates `witness_recognition` and `witness_recognition_audit` in a
new dedicated database, sets `user_version=1` transactionally, and refuses newer
versions. Existing theft, attention and case schemas/rows are unchanged; no
historical recognition is backfilled. The gateway explicitly selects the
production `.local/crime/witness-recognition.sqlite` path; there is no automatic
watcher recognition enrollment. Rollback stops writers and preserves this database and
its WAL/SHM alongside the existing source/Thieving/case/evidence ledgers.

The gateway revalidates every `recognition:` case source against the independent
engine inspection, recognition, attention, Thieving and case sources before
report routing or replay. Missing or inconsistent sources refuse the report;
an intact derived discovery or a previously stored report does not bypass this
gate. Anonymous `witness:` reporting retains its existing checks.

The engine captures observer-visible person continuity at event time and
executes explicit bounded, authenticated person inspection on a world-tick
queue. Its opaque session token and anonymous visual digest do not use a player
slot alone or the username-bearing appearance suffix. The production capture
requires actual client visibility; the observer-local tracker invalidates older
continuity after visibility/LOS loss, appearance changes, disconnect or eviction.
Inspection enforces current session/appearance, LOS, distance and configured
time window. The gateway additionally checks prior noticed attention before
inspection and at the derived write. The engine independently samples the
selected live target identity; callers cannot supply recognized identities.
Historical snapshots without continuity, logout/slot reuse and pending commands
across restart cannot produce new recognition. Completed exact receipts replay
durably, including their original target-slot binding. Live acceptance is tracked
separately; this wiring description does not itself claim a passed live run.
See [the recognition API, policy and rollback contract](phase22-witness-recognition.md).

`recordWitnessIdentification` is a separate recognition adapter, not automatic
promotion of attention. It requires an independently retrieved, audit-valid
server recognition source bound to the exact event, observer, attention digest,
engine digest, recognized player/agent and non-retroactive recognition time.
The hidden world-truth actor is only a consistency check, never the positive
recognition source. A relationship note, LLM memory, username label or HTTP
argument cannot act as its source port. The legacy empty port remains a
fail-closed default for callers without explicit source dependencies. The
authenticated gateway uses `makeVerifiedEngineRecognitionPort` backed by both
the independent engine inspection journal and the derived recognition journal;
there is no implicit fallback or automatic identification from attention.

The adapter writes a new `recognition:` discovery using the existing Thieving
schema and does not edit the anonymous `witness:` observation. The existing
case cursor promotes the separate direct identification and corresponding
evidence without guilt. Exact replay is idempotent across store reopening;
knowledge remains scoped to the recognizing observer. The source is cloned
and rechecked at the write boundary so a changed proof cannot be accepted.
Integration tests exercise durable sources and exact identification/report
replay after reopening stores. The explicit login-authenticated HTTP action is
exposed through `sdk.recognizeWitness`; it is not an LLM attestation endpoint or
automatic watcher enrollment. Downstream report intake revalidates the
independent engine and recognition journals, not only a derived discovery hash.

No Thieving schema migration is required. Recognition observations are new
append-only rows in the existing audited store. Rollback stops recognition
writers and retains recognition source, Thieving, case and evidence databases
with their WAL/SHM files. Older code may read existing rows, but must not invent
or delete recognition sources to downgrade. Do not rewrite anonymous rows or
reuse a source ID for a different recognition.

The engine inspection journal is a separate versioned v1 database. Optional
continuity fields reuse the existing nullable sight JSON without rewriting
legacy event digests; missing historical continuity remains non-identifying.
For isolated local acceptance, the operator-only `PROPERTY_STATE_DB` override
selects a separate Property state database rather than modifying normal state.
The `start-local` `-GatewayLoginAuthentication` switch enables gateway login
authentication separately from the engine's file-backed `LOGIN_SERVER=false`
mode. On operational rollback, stop the scoped stack, remove acceptance-only
overrides and restore the intended login mode; retain all normal and acceptance
source databases and backups. Never select either override from HTTP input.

The 2026-09-27 theft-witness extension reuses the existing nullable engine
`sight_snapshot_json` and v2 witness decision schema. No schema migration or row
rewrite is required. Legacy theft events without a snapshot stay readable and
cannot be backfilled with invented historical observers. Existing Property
opportunity digests and discovery wording are unchanged. Restart the engine to
load the new capture behavior; no RuneScript pack rebuild is required for this
TypeScript-only change. For rollback, stop the watcher and engine and preserve
engine, procedure, witness and case/report databases with their WAL/SHM files.
Older code cannot process new theft witness decisions through its Property-only
path; fail closed and retain those facts rather than deleting or rehashing them.

The opt-in Thieving watcher now writes Property entry rights violations through
the existing projection before advancing its engine cursor. Its rights ledger
is `.local/crime/rights-violations.sqlite`, using the existing v1 schema. An
unbound player owner blocks the prefix rather than inventing an agent identity.
At startup an audited, already processed cursor prefix is backfilled in bounded
pages, using the original source digest and a current recording timestamp.
Stable event IDs make prefix retry and restart idempotent. Missing rights audit
coverage fails closed and is never rebuilt from the materialized row. No player
save, currency, inventory or schema version changes. Stop the watcher and retain
all ledgers for rollback; reverting the worker removes the automatic projection,
not previously recorded facts. This deterministic integration is not a live
gameplay acceptance or publication of the four draft skills.

Schema version 1 additively creates `thieving_outcome`, `thieving_discovery` and
`thieving_audit` in a dedicated SQLite database. The engine separately creates
`thieving_engine_evidence` in `data/mods/thieving-engine-evidence.sqlite`; the
additive Property-access migration adds nullable `property_access_json` so old
engine events retain their original digest shape. It does not alter player
saves, item rows, Property or Business state. Before
rollback, stop writers and archive both databases with their WAL/SHM sidecars.
Older code may ignore them, but both databases must remain available once a
rights/evidence domain references an engine event or receipt ID. Rolling back
the custom opcodes, Property security fields or `Pick-lock` option also requires
restoring the matching catalog and rebuilding the content pack from the
pre-change RuneScripts. The nullable evidence column may remain in place during
a code rollback; dropping it is unsafe after a rights event references its
digest. Existing skill journals remain readable because operation names are
stored as strings and no journal row is rewritten. Do not promote the drafts
before live trials pass.

The Property catalog moves from schema version 1 to 2. Migration consists of
adding an explicit `security` object to every property; no ownership-state row
is rewritten. A version-1 catalog now fails closed instead of inventing a lock
policy. Rollback requires restoring both the version-1 catalog and parser after
archiving any newer evidence that cites the configured security decision.
