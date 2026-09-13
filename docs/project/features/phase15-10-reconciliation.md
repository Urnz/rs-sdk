# Phase 15.10 — unified autonomy reconciliation

## Implemented startup flow

The gateway now has one fail-closed reconciliation pipeline. It processes trusted active-skill markers first, then
terminal skill journals and orphan evidence, committed contract settlement state, goal events and domain state, and only after all those
phases succeed may the autonomy supervisor recover/claim enrollments and reconcile the avatar bot session. This keeps
process state, run/decision evidence and durable domain state in a deterministic order instead of allowing planning
from a partially recovered prefix.

The same ordered function is used by the periodic 30-second scan and the startup scan. Its structured report retains
the result of every phase, including adopted/stalled processes and created versus existing durable wake-ups. A failed
authoritative phase aborts before enrollment claims; retries remain idempotent through the existing source keys,
exact run ids and optimistic revisions.

Terminal journals produced while the gateway is unavailable are matched to the still-running durable enrollment and
exact dispatch before they create completion/failure wake-ups. Conversely, a surviving skill process is adopted only
when its run id, avatar, PID, heartbeat and journal-progress marker all validate. A legacy, malformed, stale or
otherwise uncertain marker remains blocked and cannot authorize a replacement skill; a proven-dead marker follows
the idempotent orphan path.

An enrolled avatar whose bot exited with the engine is restarted only through the existing local `bot.env` boundary.
Spawn/failure attempts persist on the enrollment and use the same bounded 30s/60s exponential schedule and
three-attempt quarantine circuit. A running process is only a `starting` condition: no autonomy lease is claimed and
no planner runs until the gateway receives a fresh, controller-free world state. Successful fresh-state adoption
clears the avatar-recovery fingerprint before normal planning resumes.

Accepted economic contracts, their exact obligations and all reserved institution/player consideration remain in
their existing SQLite ledgers across restart. The bounded settlement scan examines at most 500 contracts and attempts
at most 100 ready contracts per pass. It calls only the existing typed, idempotent treasury reward/transfer and engine
player-escrow ports, reusing the already persisted settlement, reservation and escrow IDs. It never derives a new ID
during replay. A failed external call leaves the item `settling`, records the error, and blocks cancellation/default
from treating the ambiguous transfer as absent. Tests cover engine failure followed by restart recovery for both an
institution→player payment and a bilateral player escrow, plus a second empty replay proving no duplicate transfer.

Paid Business/Faction→player work orders use the same rule. Terminal-journal recovery first reconciles an exact
running request to `settling`; that transaction persists its settlement ID before any engine reward call. The next
ordered phase scans at most 100 already-settling player actions and invokes only the existing typed reward plus
treasury commit path with that persisted ID. Engine failure keeps the reservation and settlement record pending;
the next pass retries the same ID. Tests cover a journal completed while the gateway is absent, stable ID preservation
across repeated journal scans, automatic payment recovery, and an empty second payment scan without another engine
call. Accepted but not-yet-running orders remain durable and are re-emitted by the domain-event recovery for normal
policy admission; restart does not mint a new request, approval, run or settlement ID.

## Migration and rollback

AgentState migrations are additive and versioned with SQLite `user_version`. A known v15 database upgrades in separate
transactions through v16 (autonomy enrollment), v17 (global autonomy control), and v18 (goal execution, exact skill
dispatch and terminal outcome). Existing identities are not enrolled implicitly. The migration test then closes and
reopens the database through `AgentStateStore`, verifies all five new tables, the preserved enrollment/policy and the
global control record. The replan inbox and economic ledgers keep their own versioned databases; this reconciliation
slice adds no column or player-save field to them.

Rollback procedure:

1. Activate the global emergency stop and stop gateway/autonomy writers.
2. Back up every `.local` SQLite database together with its WAL/SHM companions before changing binaries or schemas.
3. Let live leases expire or run the same reconciliation with the compatible version; never delete a lease to make
   uncertain work look idle.
4. Restore only to a binary that supports the database `user_version`; otherwise restore the complete pre-upgrade
   database set from backup. Do not perform an in-place schema downgrade.
5. Never reverse a committed reward, escrow, treasury transfer or other economic entry as part of schema rollback.
   Any correction is a new, explicitly authorized, audited compensating transaction with its own stable ID.

The orchestration-only code can be rolled back after writers stop, but existing journals, inbox records, leases,
reservations, settlements and audit data remain authoritative and must not be deleted or rewritten.
