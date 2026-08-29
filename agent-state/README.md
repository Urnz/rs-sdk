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
