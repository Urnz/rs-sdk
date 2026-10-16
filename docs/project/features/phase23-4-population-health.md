# Phase 23.4 – authoritative injury health, recovery and care needs

The new `population-health` domain persists injury burden separately from
transient LostCity hitpoints. Each applied network-player damage creates an
engine-owned, append-only SQLite proof. The gateway reads that source
read-only, verifies its chain and maps the exact avatar to its active finite
`PopulationMember`. No reported client HP, chat, model output or generic skill
success can create an injury or a clinical treatment.

This is the injury/health MVP. It does not declare death, change character
lifecycle status, suppress classic respawn or settle an estate. Those remain
23.5+. No new personal medicine skill or profession-specific agent class is
introduced.

## Authoritative state and producer readiness

`NetworkPlayer.applyDamage` wraps the existing engine damage operation with
durable evidence persistence. A persistence failure restores HP, hitmark slots,
damage/type fields and masks and rethrows. The evidence is committed before
the engine operation succeeds; a failed write does not leave an unrecorded
injury. Only an actual positive HP decrease emits a damage event. HP zero is
recorded as damage evidence, not reinterpreted as an authoritative terminal
population death.

Engine source schema v1 stores exact username, session, engine tick, before/
after/base HP, damage type, wall audit time, event digest and a hash chain.
World ticks publish a protocol-1 producer heartbeat at most every ten wall
seconds. A heartbeat older than 30 seconds or more than five seconds in the
future is unavailable. A leftover file from a stopped/older engine is not
evidence of an active injury producer. Unsupported schema, altered evidence,
deleted/truncated cursor anchors and conflicting event-id replay fail closed.

Gateway source ingestion processes at most 1,000 events per cycle and persists
its exact sequence/digest cursor. An unmatched or pre-membership event creates
no population injury. Source replay is idempotent even after a crash between
health commit and cursor acknowledgement. Matched events bind to the actual
shared SimulationClock's `population-health-engine-damage` event namespace.
Delayed source effects are admitted at the current monotonic clock observation,
preserving the original engine audit time instead of guessing historical
recovery. A remaining backlog blocks recovery until it is drained.

Health state begins only with the first verified injury. Membership alone does
not synthesize a healthy baseline or historical injury record. Unknown health
is returned as unavailable/unobserved. Injuries retain source ids, initial and
remaining burden, treatment requirement and treatment state. Every state
mutation and resulting snapshot is committed atomically to a separate audit
chain. Snapshot deletion or alteration fails closed. Fully healed injuries
leave the active list while their original and recovery evidence remain in
history.

Burden is the applied damage/base-HP ratio in 0–10,000 units per injury. The
current aggregate is capped to 10,000, with well/injured/critical status, rest
and treatment needs, and a domain workload-capacity multiplier. These values
are not a second authoritative engine HP counter. The default critical burden
is 7,500, treatment is required for an individual injury of at least 5,000,
and at most 256 simultaneous open injuries are admitted. Capacity exhaustion
is explicit failure, never silent evidence loss.

## Recovery and persistent rest needs

Recovery requires a complete, ready source and an active finite lifecycle.
Unknown birth blocks recovery because the age-policy multiplier is unknown.
Only the common SimulationClock's current verified sleep context is used.
Sleep must begin after the latest injury; a hit during an existing sleep
episode requires a new sleep episode. Offline recovery requires a bed
entitlement; physical-presence access is usable only while online. The access
expiry clips the recovery interval. Awake, missing, mismatched or expired rest
evidence grants no extra recovery.

The MVP does not reconstruct past sleep episodes from a latest-state snapshot:
a sleep episode already ended before observation earns no speculative healing.
This is a conservative boundary, not a fabricated rest-history backfill.

The default recovery budget is 1,000 total burden units per simulation hour
of admitted sleep, scaled by the exact 23.2 age-stage regeneration multiplier.
The budget is global to the patient, not multiplied by the number of damage
events. Recovery splits an interval at age-stage boundaries instead of applying
the final age retroactively. BigInt arithmetic and a persisted fractional
remainder preserve direct/incremental/restart equivalence. Pausing the clock
stops recovery. Unused healing capacity is discarded at healed/care floors.

An untreated severe injury cannot fall below the configured 1,000-unit care
floor. Rest therefore cannot substitute for required treatment. A verified
treatment clears the care hold and applies only the configured bounded relief;
the remaining injury still needs rest. Reset/deceased memberships expose their
historical state as inactive and receive no new injury, treatment or recovery.

Missing/stale producer or an undrained backlog records a blocked observation
with no recovery segments. Recovery cannot be credited retrospectively for
that blocked period when the source resumes. Corrupt source intake also blocks
the current observation before propagating its integrity error.

## Treatment verification and medicine boundary

`PopulationHealthStore.treat` consumes an immutable clinical completion receipt
through an explicitly trusted `HealthTreatmentAuthority`. The receipt pins
patient, injury, practitioner, exact completed run, simulation clock/profile,
health-policy digest and genesis-membership source. Its time cannot precede
the injury or exceed the current clock observation. The state must already be
advanced to that observation, and a stale revision rejects mutation.

Admission additionally requires the configured exact **verified** skill version
and checksum, a successful run by the exact practitioner with patient/injury
parameters, sufficient existing Herblore competence in the clinical evidence,
and a trusted active facility grant for the configured medical capability at
completion. Personal skill cannot replace facility entitlement. A completed
generic run, caller-supplied receipt, missing clinical source, false grant,
foreign clock or changed policy cannot heal a patient. One run/receipt cannot
be consumed repeatedly. Health writes and their audit are atomic.

The shipped policy intentionally has `treatments: []`: this repository has no
already verified clinical procedure/completion source to bind. It does not
promote an unrelated skill, invent a clinic, consume/create medicines or expose
a raw “heal amount” RPC. The clinical admission path is tested with an explicit
source fixture; a deployable Herblore/facility treatment needs its own real
verified procedure and immutable completion authority before activation.
The injury, recovery, care-need domain is operational independently of that
optional medicine producer. In particular, severe injuries remain visibly
care-blocked while no verified treatment is configured.

Adding a real care protocol for an already injured population is an explicit
revision-checked `addTreatmentProtocols` migration. It requires a higher policy
version, retains every previous protocol unchanged, and permits only additive
treatments with unchanged age binding, biological rates, thresholds and limits.
The migration appends its policy references to the health audit and leaves
injuries and recovery remainder intact. Changing biological rules requires a
separate reviewed migration; it cannot be smuggled into treatment activation.

## Gateway integration

The gateway runs a ten-second health cycle against the actual AgentState path,
common clock, engine source and health database. The admin agent service also
uses that runtime, returns `populationHealth`, and places numeric care/rest/
capacity facts in trusted decision context. Missing/uninitialized/unready data
adds a `population-health` blocker; it never implies wellness. Errors are
logged and remain fail-closed. No bot is launched and no admin UI redesign is
included.
Runtime health views explicitly qualify their source as verified, unavailable
or pending. Stored values from a blocked source remain historical; they are not
presented as current wellness in trusted decision context.

## Schema migration, backup and rollback

AgentState remains v22 and SimulationClock remains schema v4. New stores migrate
atomically from absent/v0 to v1:

- `server/engine/data/mods/player-health-evidence.sqlite`: damage audit and live
  producer metadata, written only by the local engine;
- `.local/simulation/population-health.sqlite`: current injury snapshots,
  mutation audit and engine source cursor, written by the gateway/domain.

No player, population, birth, injury or treatment backfill runs on upgrade.
Empty stores convey no historical health assertion. Newer/unsupported store
schemas and stale state-policy bindings are rejected. Exact policy files must
be preserved with experiment evidence.

Before upgrade or a treatment-policy migration, stop engine/gateway and copy
both health databases together with their WAL/SHM sidecars, plus the associated
AgentState and SimulationClock databases. A coordinated application rollback
removes the new engine hook, heartbeat and gateway cycle/readers together. The
unused v1 stores may be retained as evidence; no AgentState schema downgrade is
necessary. Restore a complete consistent backup set to undo persisted health
mutations. Do not erase source events, change birth/genesis references, rewrite
audit hashes or reset only a cursor. A source backup older than the retained
cursor is deliberately rejected. Rollback after enabling care restores the
old policy and corresponding complete health-state backup, not a hand-edited
policy digest in individual rows.

## Verification

The engine suite checks exact replay/restart/read-only access, invalid damage,
tampered evidence and failure rollback of the actual HP/hitmark wrapper.
The domain suite checks authoritative initialization, persistent history,
awake vs. authorized rest, care floors, expired access, unknown birth,
fractional restart equivalence, age-stage integration, global recovery budget,
pause/reset, policy/clock/state corruption, verified treatment/source/run/
Herblore/facility admission, replay, protocol migration, actual ledger intake,
stale producer catch-up blocking and backend/decision-context parity.
