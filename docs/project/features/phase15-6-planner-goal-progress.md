# Phase 15.6 — planner parameters and goal progress

Phase 15.6 replaces implicit autonomous `{}` parameters with a typed, attributable execution chain:

`decision -> skill dispatch -> terminal outcome -> goal progress event -> durable replan inbox`

## Parameter authority

Every autonomous dispatch has exactly one parameter source: an exact goal, work order, contract obligation,
approved policy, or bounded LLM suggestion. The reviewed skill schema resolves defaults and rejects missing,
unknown, out-of-range, nested, or oversized values before a canonical SHA-256 digest is stored. The run ID links
that binding to the admitted decision, exact skill version, enrollment policy version, skill journal, and outcome.
An immediate skill goal without persisted execution metadata fails closed.

## Goal lifecycle

`agent_goal_execution` stores a machine-readable `successful-skill-runs` condition, progress, `one-shot` or
`recurring` policy, cooldown, last run, next eligibility, and the goal-owned parameter binding. A terminal journal
is accepted only when its exact skill and resolved parameter digest match the dispatch. Outcome insertion and goal
progress/status mutation are one SQLite transaction and idempotent by run ID. One-shot goals complete when their
required successes are reached; recurring goals stay active and receive a bounded cooldown. The resulting append-only
goal event is recovered into the same durable replan inbox used by ordinary goal changes.

The proto-society livelihood and production loops are recurring with a 60-second cooldown. The exact one-hammer
procurement is one-shot with `target-items=1`. Source-controlled goal templates are pinned to template, policy, policy
version, parent goal, skill, and parameter versions; they cannot replace free-form strategic goal-chain approval.

## Failure routing

Terminal failures are classified as `acquire-input`, `retry`, `capability-gap`, or `authorization`. Capability failures
are reported once through the existing fingerprint-deduplicated `CapabilityGapStore`. Journal/dispatch mismatch is an
authorization failure and never counts as progress. Missing inputs and transient world failures remain explicit typed
outcomes for the next high-level replan rather than causing tick-level LLM control.

## Migration and rollback

Schema v18 adds `agent_goal_execution`, `agent_skill_dispatch`, and `agent_skill_outcome`. Existing immediate skill goals
are backfilled deterministically: the reviewed hammer procurement is one-shot with exact quantity one; other existing
fixture-style livelihood goals are recurring with a 60-second cooldown. No existing identity, goal, decision, or journal
row is deleted.

Before production migration, stop the local stack and copy the AgentState SQLite database (including WAL/SHM files if
present). The supported rollback is to stop the stack and restore that pre-v18 copy. Dropping the three additive tables
and setting `user_version=17` is suitable only before any v18 run has updated goal progress/status; after execution,
restoring the backup is required so completed goal rows and append-only goal events remain consistent.
