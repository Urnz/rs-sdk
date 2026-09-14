# Phase 16.1: versioned simulation clock

## Boundary

`simulation-clock/` is a domain-level clock independent from the LostCity engine
tick and the host wall clock. A caller supplies wall time explicitly; the clock
maps it to simulation time through an integer ratio. An optional engine tick is
returned as correlation metadata only and never participates in that mapping.

Each exact profile contains a schema version, semantic profile version, seed and
rational rate. Its SHA-256 digest makes the temporal configuration suitable for
experiment manifests and later world-genesis evidence. Integer arithmetic makes
projection deterministic across restarts and avoids floating-point drift.

The first slice supports running, pausing, resuming and rate/profile changes.
Every transition anchors the new state at the simulation instant calculated by
the previous state, uses optimistic revision control and therefore cannot jump
simulation time. A regressing wall-clock observation fails closed. The durable
event-stamp allocator supplies one monotonic sequence and simulation timestamp;
the durable replan inbox, economy event ledger, World Director outbox,
AgentState goal-event ledger, verified governance source events, institution settlements and the banking journal are the first integrations.
They retain the source event's `occurredAt` wall time and separately record its
simulation time, sequence, clock revision/status and profile digest. Skill, goal
and world wakeups plus structured economic observations submitted by the gateway
therefore share one clock without rewriting audit evidence. Both live skill-run
ingestion and the admin history scan use that same clock binding. World Director
signals bind at queue time; retries and delivery-state changes retain that stamp.
Goal create, status-transition and skill-assignment events bind inside their
own state transaction, while the original `occurredAt` remains audit evidence.
The clock store exposes cursor-based sequence reads across domains, and
`GET /api/admin/simulation-clock?afterSequence=...&limit=...` returns the current
clock state plus that canonical ordered stream for diagnostics and later admin UI use.

## Persistence and migration

The store uses a dedicated SQLite database at
`.local/simulation/simulation-clock.sqlite`. Schema v1 creates the clock state;
schema v2 adds immutable domain-event bindings keyed by clock, domain and source
identity. The replan inbox and economy event ledger independently migrate from v1
to v2 with nullable simulation-stamp columns. The formerly unversioned World
Director database migrates in place to schema v1 with the same nullable stamp
shape. AgentState schema v20 added the same nullable columns and a per-clock
sequence uniqueness constraint to `agent_goal_event`; schema v21 adds the
player-only lifecycle baseline documented in `phase16-3-character-lifecycle.md`.
Existing rows retain their
wall-clock evidence and are backfilled idempotently from the trusted payload
digest when replayed. If a legacy World Director `queuedAt` predates the clock's
last wall observation, backfill binds at that last observation rather than
regressing the clock; the original `queuedAt` remains unchanged. Economy rows are inserted atomically with their clock
binding; a crash after reserving a binding but before the ledger transaction
leaves an idempotently reusable binding, never a duplicated economic event.
Startup rejects a database with a newer `user_version`; it never guesses a downgrade.
WAL mode and immediate transactions serialize observations, configuration
transitions and event sequence allocation.

Schema v3 adds the independent player presence/rest contract documented in
`phase16-2-player-time.md`. Logout changes presence only; it neither implies
sleep nor pauses or advances the world specially.

Before applying a future migration, stop every writer and copy the database plus
any `-wal` and `-shm` sidecars. A schema rollback is: stop all writers, archive
the newer files, restore that complete pre-migration set, then start the previous
binary. For a database used only by this feature, reverting it means stopping its
writers and archiving/removing the isolated clock database. Reverting the inbox,
economy-ledger, World Director or AgentState v21 reader leaves nullable stamp columns in place;
destructive column removal is not supported. None of these schema operations reverse
gameplay, economic or audit operations. Once later domains persist simulation
timestamps, those committed records must be retained and reconciled by a forward
fix rather than rewritten during clock rollback.

## Verification

`simulation-clock/test/simulation-clock.test.ts` covers strict profile
validation/digests, accelerated projection, engine-tick independence, wall-clock
regression, continuous reconfiguration, pause/resume, restart persistence,
monotonic event sequence, optimistic revisions and future-schema rejection.
`server/gateway/admin/transaction-telemetry.test.ts` additionally verifies
atomic stamp persistence, restart-safe replay and legacy economy-row backfill
without wall-time rewriting. `server/gateway/admin/world-director-runtime.test.ts`
verifies queue-time binding, replay, legacy backfill and the original unversioned
schema migration. `agent-state/test/framework.test.ts` verifies schema-v20 goal
event binding, historical backfill without wall-clock regression, new transition
ordering and restart-safe replay, plus the schema-v21 lifecycle baseline.
`server/gateway/admin/governance-obligations.test.ts` verifies governance
schema-v8 backfill, immutable replay and preservation of the original event
occurrence time.
`server/gateway/admin/banking-ledger.test.ts` verifies the additive journal
migration, deterministic legacy backfill, replay-safe ordering and preservation
of the pre-existing hash-chained accounting audit.
`server/gateway/admin/institution-settlement-orchestrator.test.ts` verifies that
settling/committed recovery and treasury replay retain one immutable sequence.
