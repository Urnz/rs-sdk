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

The admin snapshot also exposes `skillRelationships`: catalog existence/access is
reported separately from per-agent knowledge and final executability. An accessible
shared catalog entry remains `unlearned` until a separate knowledge update records
learning; it is never included in LLM tools merely because it exists globally.

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

## Episodic memory

Schema v4 adds immutable concrete events with timestamps, importance, goal links, actors, tags, provenance, trust and
optional expiry. An optional external key makes source-event ingestion idempotent and rejects content collisions. The
deterministic retriever ranks trusted, non-expired episodes by importance, recency and goal/actor/tag/text matches, then
passes only the bounded result into `buildDecisionContext`. Untrusted statements remain inspectable but are excluded by
default. Manual episodes can be added on the `Agentek` admin tab, and planner-approved skill starts create a linked
action episode automatically.

The gateway now reconciles immutable skill-run journals into episodic memory on startup and every 30 seconds. A run
owned by a persistent identity produces a trusted outcome episode; structured production, consumption, shop, player
trade and bank evidence produces separate economic episodes. Stable external keys make rescans idempotent, while the
existing collision check rejects a journal whose content changes after ingestion. Unknown player journals are skipped
and never create identities implicitly. This ingestion is deterministic and does not require an LLM.

Episode expiry is retrieval-time first: reaching `expiresAt` hides a memory from decision context without deleting it.
Physical cleanup requires an explicit audited admin action and deletes at most 500 expired, unreferenced episodes per
run. Semantic, relationship, commitment and consolidation evidence is protected, as are externally keyed episodes,
preventing broken history and delete/re-ingest loops. The admin preview reports eligible and protected records before
the action; there is no automatic background deletion.

## Semantic memory

Schema v5 stores durable world, economic, route and procedure knowledge as a structured subject-predicate-object fact
plus a readable summary, confidence, goal links, tags, validity and evidence episode ids. Evidence and goals must belong
to the same agent. Only one active fact may exist per agent and subject-predicate pair; replacement atomically marks the
previous fact superseded while retaining its history and revision. External ingestion can use the same collision-safe
idempotency key as episodic memory.

The semantic retriever excludes superseded, out-of-validity and low-confidence entries, and disputed facts unless they
are explicitly requested. It deterministically ranks remaining knowledge by confidence, bounded update freshness and goal/tag/text relevance,
then adds only the bounded result to the decision context. The `Agentek` admin tab can record evidence-backed knowledge
or select an active fact to supersede. Schema v8 adds a persistent consolidation-evidence ledger. Trusted, complete
production observations become procedure knowledge at 3, 5, 10 and 20 observations with increasing confidence. Each
tier preserves the previous semantic revision and its evidence; rescans are idempotent, and automatic consolidation
never supersedes an active manual or system-authored fact.

## Social memory

Schema v6 stores a directed relationship from an agent to a stable actor key. Trust and affinity use a -100..100 scale,
familiarity uses 0..100, and GP debt has separate `agent owes actor` and `actor owes agent` fields so its direction is
never ambiguous. Relationships may reference same-agent episodic evidence and carry notes, tags and the latest known
interaction time. Self-relationships and cross-agent evidence fail closed.

Relationships own immutable-history commitments. An open commitment records who owes the action, its description,
optional GP value, due time and episodic evidence. It may be resolved once as fulfilled, broken or cancelled; resolved
commitments cannot be rewritten. Relationship and commitment updates use optimistic revisions.

The deterministic social retriever ranks actor, tag, active-goal and current-context text matches together with
interaction freshness, familiarity, trust, affinity, debt and open commitments. Only bounded results and still-open commitments enter the decision context. The `Agentek` admin
tab supports audited relationship editing, commitment creation and explicit commitment resolution.

Trusted, complete player-trade journals also reconcile social memory automatically. Each unique trade contributes five
familiarity points up to 100, advances the last interaction time and attaches bounded episodic evidence. Rescans are
idempotent. Existing display names, higher familiarity, trust, affinity, debt and notes are preserved; a trade alone
never implies trust, affection, credit or a fulfilled commitment.

## Economic actors and assets

Schema v7 stores stable links from an agent to `player`, `business` and `faction` economic actors. The identity-owned
player link is created and migrated automatically, follows player-username changes transactionally and cannot be
edited independently. Additional links have explicit owner, manager, member or beneficiary roles and optimistic
revisions, providing the integration point for future Business and Governance domains.

Money and property ownership are deliberately not copied into the agent database. `resolveAgentAssets` builds a
read-only current portfolio from external observations matched through those actor links. The admin gateway supplies
the current bot-catalog balance and Property-mod ownership, marks unavailable sources instead of failing the complete
agent view, and places the bounded result early in the decision context. Relationship debts and valued open
commitments are summarized separately as receivables and liabilities; they are not silently netted or double-counted.

Schema v13 extends institution-to-player work with a durable settlement boundary. A paid successful run moves to
`settling` with a unique settlement id; only an idempotent engine receipt may mark it completed. The player coin
balance remains engine-owned and is never copied into AgentState. Failed work creates no settlement, and transient
payment failures preserve the payable request for retry.
