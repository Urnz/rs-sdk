# Persistent agent state

This engine-independent module owns stable agent identity, goal hierarchy and working memory used by deterministic
planners and, later, the LLM context builder. Runtime bot sessions are replaceable; the SQLite state in
`.local/agent-state/agents.sqlite` is the durable source of truth.

The v1 hierarchy is deliberately strict:

`life -> long-term -> current -> immediate`

An agent can have one active life goal. Every lower goal must reference an active parent owned by the same agent and
at the immediately preceding horizon. A parent cannot end while an active child remains. Identity and goal records use
optimistic revisions so an admin or planner cannot silently overwrite a concurrent update.

`buildCoreIdentity` returns the small, deterministic identity-and-active-goals context intended for every strategic
decision. `buildDecisionContext` may append fresh working memory: current situation, activity, location and at most 12
short observations. Stale working memory is omitted rather than misleading the planner. Both outputs are character
bounded. Long-lived memory retrieval will be added as separate Phase 10 layers instead of growing the always-present
context without limit.

Goals may reference an exact immutable agent-skill version. Knowledge of those skills is stored per agent as `known`,
`preferred` or `blocked`; recording knowledge does not publish or mutate the shared skill definition. The first
`planNextAction` policy selects the highest-priority active immediate goal. It executes only when working memory is fresh
and that exact skill version is known, not blocked and present in the caller's trusted catalog. Every result has a
replayable decision key derived from the input
revisions. Missing state, goals or knowledge produce explicit non-execution decisions instead of guesses.

## Live cycle

Once an identity, goal hierarchy and known skill have been configured in the state database, a single live cycle can be
inspected without taking game actions:

```text
bun run agent:cycle <bot-name> [agent-id]
```

Add `--execute` to permit the selected verified skill to run. The command requires a fresh gateway state, verifies that
the connected player belongs to the persistent identity, writes a bounded working-memory observation, loads only exact
verified skills from the trusted/agent-visible catalog, runs one planner decision and exits. Executed skills use the
existing active-run marker and immutable run journal, so they remain visible in the admin history. Player-authored chat
is deliberately excluded from the always-present working memory.

## Admin UI

The local admin panel has an `Agentek` tab for creating an identity linked to an existing bot, editing identity fields,
building the four-level goal hierarchy and assigning exact verified skill knowledge. Each card exposes the bounded
decision context and current planner preview. A dry-run refreshes working memory from a fresh online bot without taking
an action; execution is a separate confirmed, audited operation and still uses the existing supervised skill runner.
