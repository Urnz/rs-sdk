# Phase 15.9 — bounded shared inference queue

## Implemented controls

- The gateway uses one shared inference scheduler with a hard maximum of 100 active plus waiting requests.
  Admission fails closed once the bound is reached.
- Each request carries its exact run id, normalized agent id, and the priority of its approved planning anchor.
  The scheduler serves the highest priority tier first and round-robins agents within that tier while retaining FIFO
  order for each individual agent.
- Admission and execution ownership are journaled in `.local/admin/inference-queue.sqlite`. A request must atomically
  acquire its exact owner/lease claim before provider work starts, and only that owner can record terminal status.
  Expired claims are failed during later admission and may then be retried under the same logical run id.
- OpenAI HTTP 429 responses become a sanitized typed rate-limit result. The shared queue honors `Retry-After`, applies
  bounded exponential backoff, retries at most twice, caps waits at 60 seconds, and remains abortable by the existing
  timeout and emergency stop.
- In addition to the existing per-run limits, every model-planning run atomically reserves an estimated amount in a
  server/fixture-scoped daily cost and decision budget before provider admission. A retry with the same run id reuses
  the reservation and therefore cannot consume a second decision or estimate. Deterministic planning is evaluated
  before this boundary and consumes no model budget.
- Provider usage replaces the estimate exactly once, keyed by run id and provider request id. Repeated identical
  reconciliation is accepted, while conflicting usage is rejected. The scope, daily limits, and admission estimate
  are validated configuration and are exposed by the existing admin LLM settings form.
- Active skill markers separate a five-second process heartbeat from journal progress. Every immutable skill event
  advances a monotonic progress sequence and timestamp; the 30-second autonomy scan now requires both a heartbeat
  no older than 15 seconds and journal/world evidence no older than five minutes. A live PID that misses either
  deadline is moved to `stopping` and terminated, remains blocking until its death is proven, and is then recovered
  through the existing terminal/orphan wake-up path. PID liveness alone is never accepted as forward progress.
- Failed planning outcomes are reduced to a stable SHA-256 fingerprint containing the event class, failure status,
  selected exact skill and normalized reason while excluding volatile run ids, timestamps and counters. The durable
  autonomy enrollment counts only consecutive identical fingerprints, retries them at 30s/60s/... with a 15-minute
  cap, and opens a fail-closed quarantine circuit on the third identical failure. Quarantine survives restart and
  requires the existing reviewed release action, which clears the old circuit history before a later resume.
- Terminal skill wake-ups now use the exact persisted run id and are reconciled into the outcome ledger before
  replanning. The failed exact skill is excluded from the goal's recent failure set: a different known, policy-safe
  skill with a compatible persisted parameter binding is assigned for the next bounded attempt when available;
  otherwise transient failures become an explicit bounded wait, input shortages become an acquisition request, and
  policy/capability failures become an operator warning. The scheduler cannot wake before the persisted exponential
  deadline, and the third identical result opens the circuit, excluding a zero-delay replan loop.

The process-local queue stores executable closures only in memory; durable replan intent remains in the existing
replan inbox. The SQLite ledger persists admission and claim ownership so a restart cannot silently treat an old
in-flight request as unclaimed work.

## Persistence and rollback

This slice introduces a separate schema-version-1 SQLite control database and does not alter player saves, economy
state, or the agent-state schema. It is created transactionally with WAL enabled. To roll back, stop the gateway and
remove `inference-queue.sqlite` together with its `-wal` and `-shm` sidecars, then restore the previous in-memory queue
implementation. No gameplay-data migration is required; losing this ledger only discards queue audit/claim metadata,
while durable replan events remain recoverable from the replan inbox.

Daily budget reservations are stored separately in `.local/admin/llm-budget.sqlite`, also as a WAL-enabled,
schema-version-1 control database. Rollback requires stopping the gateway and backing up or removing that database
and its `-wal`/`-shm` sidecars before restoring the previous runtime. Removing it resets only the inference accounting
ledger; it does not reverse provider charges or any gameplay/economy operation, so the backup remains the audit trail.
