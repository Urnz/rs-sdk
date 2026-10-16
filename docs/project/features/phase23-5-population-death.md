# Phase 23.5 – authoritative death and terminal physical lifecycle

Finite population members now have an authoritative engine death journal and
a permanent avatar closure latch. A due 23.3 mortality candidate remains a
proposal until an engine tick admits it. Actual lethal HP loss supplies the
second supported cause. Arbitrary admin input, model output, a health burden,
missing birth or an unverified clock cannot create an AgentState death.

## Authority and evidence

`PopulationDeathRuntime` uses the actual AgentState database, the common
SimulationClock and the exact age/mortality/world-profile bindings. It checks
all members before world scripts, client packets and NPC processing, including
offline members. Natural death consumes the original seeded candidate and
records its exact simulation timestamp; delayed observation does not resample
the candidate or move death to the observation time. Unknown birth prevents
natural death without preventing verified lethal combat death.

The engine health source upgrades additively from v1 to v2. In one SQLite
transaction it records a real positive HP decrease to zero and the terminal
death latch. Username, session, engine tick and damage event must match. If
that transaction fails, both durable effects roll back and the existing damage
wrapper restores HP and hitmarks. No death or injury is fabricated from a
failed write. Scripted finite HP drains use the same audited damage path.

`engine_population_death` stores an immutable hash chain, one event per agent
and avatar. Audit tail anchors detect removed suffixes, including deletion of
the only death. The engine also retains an exact finite-avatar identity binding
independent of birth registration. Losing AgentState cannot downgrade an
engine-known finite avatar into compatibility respawn. Binding replacement,
source corruption and unsupported schemas fail closed.

Events pin the immutable membership/genesis digest, member and lifecycle
revisions, age-policy digest, shared clock observation and cause. Natural
events additionally pin their mortality candidate and policy digest; lethal
events reference the engine-owned HP proof. Audit wall time is distinct from
the effective simulation death timestamp.

## Physical closure

The engine closure takes effect before gateway reconciliation. Terminal
sessions cannot execute gameplay packets, movement, protected access, queued
scripts, timers, interactions or exchange work. The script runner checks both
player pointers and the original player actor before every opcode, preventing
a lethal opcode from continuing into respawn or later physical operations in
the same script. Player processing rechecks the latch between queue/timer/
interaction stages. World removal skips the classic logout/death script route
and saves/disconnects the avatar through the normal engine removal mechanism.

Login and reconnect consult the persistent latch before admitting a player or
running its login script. Closed avatars are excluded from username-based
admin lookup, and offline save edits/restores are blocked. A finite save already
at zero HP without an admissible lethal proof is blocked; it does not invent a
historical death. Authority failures block/remove affected sessions without
writing a death event. Compatibility avatars retain their existing classic
HP-zero behavior when no finite membership exists.

The gateway checks the authoritative source before SDK action forwarding,
managed bot spawn and skill start. Finite execution requires a ready v2
producer. The lifecycle therefore remains closed during ingestion delays,
gateway restart, stale producer state or a failed projection. No raw death
admin endpoint was added. Once reconciled, managed skills are stopped and bots
are despawned; the engine barrier remains authoritative throughout.

## AgentState projection

AgentState schema v23 adds `agent_population_death` without changing existing
membership or birth records. `consumePopulationDeath` accepts an actual
read-only engine store and a journal event id, then validates the real entry,
current membership/revisions, shared clock and recomputed policy evidence.
Its transaction atomically inserts the immutable receipt, marks the character
`deceased`, freezes age at the effective death time and pauses autonomy while
clearing its lease and next wakeup. Exact replay does not increment revisions;
conflicting or stale evidence leaves the character unchanged and the engine
latch closed. The stored receipt checksum also covers source sequence metadata.

Deceased autonomy cannot be resumed. Finite player identity/control bindings
cannot be changed to bypass closure. The admin view exposes `populationDeath`
and reports lifecycle/authority blockers in the trusted decision context.
Reset/deceased histories remain readable. A conflict between birth/reset and
an already emitted engine receipt requires explicit operator reconciliation;
the code never repairs it by rewriting immutable history or reviving an avatar.

Avatar action prechecks open AgentState read-only and never migrate it. The
short-lived AgentState writer/admin store explicitly finalizes its cached
statements before closing SQLite; this prevents retained connections during
reconciliation and fixes the reproduced Windows health-admin teardown failure.

This slice does not settle contracts, debts, employment, Business roles,
treasury rights, Property or inheritance, and does not archive/transfer memory.
Those remain 23.6+. Ordinary engine save/session cleanup continues, but no
estate settlement or new economic transfer is introduced here.

## Upgrade and rollback

Stop engine and gateway writers before upgrading; back up AgentState, the
common clock, engine health source and player saves together, including WAL/
SHM sidecars. Engine v2 preserves v1 damage events and starts with empty death
and finite-binding history. AgentState v23 adds an empty death table. Neither
migration infers births, historical injuries or deaths. On the first new
engine tick, active members are bound and any currently due natural candidate
is authoritatively admitted, including old imported members.

Restart engine and gateway with the same version/configuration. A v1 reader
can still inspect old damage evidence; it cannot authorize finite death or
physical execution. Keep the exact world, lifecycle, age, mortality and clock
configurations with the experiment. SimulationClock remains schema v4 and the
separate population-health domain store remains v1.

Do not downgrade schema markers, delete terminal receipts or restore a player
save alone to reanimate a closed avatar. Pre-23.5 application rollback is not
safe for finite populations: it lacks the physical closure barriers. Keep
finite services stopped or retain a closure-capable engine/gateway. If a
separate pre-upgrade experiment must be restored, preserve the current audit
archive and restore the complete coordinated snapshot into that experiment;
never mix its avatars, clock or sources with the terminal population.

## Verification

The death suite exercises offline natural admission, exact seeded timestamps,
unknown birth, lethal HP proof, session matching, transactional failure on both
engine and AgentState, age freezing, restart, replay, paused autonomy, stale
birth revisions, reset, forged receipts, identity rebinding, missing/stale
authority, compatibility behavior, audit suffix deletion, lost membership
source and additive v22/v1 upgrades. The existing age, mortality, genesis,
health and engine evidence suites are also included in regression checks.

No bot or live gameplay session is started by this implementation verification.
