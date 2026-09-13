# Phase 15.11 — autonomy observability

## Unified per-agent timeline

`GET /api/admin/agents/:agentId/timeline?limit=200` returns one newest-first, bounded projection over the existing
authoritative ledgers. It does not copy or mutate their data. Every entry has a stable projection ID, timestamp, kind,
status, summary, typed correlation IDs and structured details. The projection currently includes:

- durable wake-ups and their payload digests, attempts, lease result and terminal policy/decision result;
- admitted decisions, LLM/GP admission amounts and the exact trusted-context SHA-256 digest;
- exact skill/version, policy, parameter-source, parameter digest, decision/run/goal/source correlation;
- pending skill dispatch or terminal outcome evidence and classification;
- append-only goal events and episodic-memory updates;
- player-action work orders and economic contracts with evidence, settlement and escrow IDs;
- the enrollment's current status, policy, lease, failure count and next wake-up.

The raw trusted context and untrusted chat/model text are not copied into the timeline. AgentState schema v19 adds only
the nullable `agent_decision_ledger.context_digest` column. Old decisions remain valid with a null digest; new automatic
decisions calculate the digest immediately before admission. The v15 migration regression upgrades through v16–v19,
verifies the new column, closes the database and reopens it through `AgentStateStore`.

Unknown agents and limits outside 1–1000 fail closed. The default response is limited to 200 entries. Contract scans
are capped at 500 records, while the other source queries already use their own bounded limits.

## Autonomy dashboard

`GET /api/admin/autonomy/status` builds a read-only, per-agent operational projection for the admin UI. The Agents tab
shows the enrolled, idle, planning, executing, backoff, quarantined, offline, recovering and paused states together with
the durable replan and inference queue counts, enrollment lease owner/expiry, today's admitted LLM and operational GP
cost, the last trusted skill progress and the next scheduled wake-up.

The same card displays a separate waiting reason when the agent needs admin approval, fresh online state, a missing
capability, or fail-closed reconciliation. Waiting reason and runtime state are intentionally separate: for example an
agent may be in backoff while waiting for fresh state. The projection opens the ledgers only for the duration of the
request and closes them before returning; it does not claim queue work, renew leases or change enrollment state.

## Economy provenance metrics

Completed multi-agent experiments now persist an `economyProvenance` block inside their existing metrics JSON. It keeps
four sources separate instead of presenting every gain as endogenous proto-society output:

- declared vanilla NPC-shop dependencies and the observed buy/sell transaction, item and GP flows;
- fixture-bootstrap participant coins, participant item units and Business treasury;
- agent-to-agent player trades and contracts;
- agent-to-Business contracts, committed GP, evidenced item units and service evidence.

Bootstrap attribution fails closed. It is emitted only when every experiment participant belongs to the validated
fixture and `fixture-bootstrap.sqlite` contains a completed application for the exact manifest baseline digest. Business
metrics likewise require the exact fixture institution agent plus durable contracts/evidence/committed settlements in
the experiment time window. The calculation never infers a Business interaction from an unexplained balance change.
Contract reads are bounded to the newest 500 records; experiment skill journals remain the authoritative source for
NPC-shop and direct player-trade events. The Experiments tab renders these provenance figures in a separate expandable
section.

## Exportable acceptance bundle

`GET /api/admin/multi-agent-experiments/:experimentId/acceptance-bundle` exports a self-digested JSON artifact for a
finalized experiment. The Experiments tab exposes the same operation as an **Acceptance bundle export** download. Its
manifest includes the experiment seed and definition digest, private LostCity world build/source revision, exact
world-mod and data-schema versions, parameter-profile version/digest, and the policy/version recovered from each
durable skill dispatch. It also includes every participant avatar baseline digest, event/run/decision/goal correlation
ID, the final measured outcome, relevant admin audit entries and the verified audit-chain head.

New admin audit entries form a process-serialized SHA-256 chain. Pre-existing unhashed records remain explicitly counted
as `legacyEntries`; they may precede but never follow the chained suffix. Malformed records, a modified link, missing
per-agent policy evidence, missing baseline digests, a non-final experiment or relevant legacy/unhashed audit evidence
all make acceptance export fail closed. The bundle's own `bundleDigest` detects changes after export.

## Rollback

Stop autonomy writers and back up the AgentState SQLite database with WAL/SHM companions. A previous binary must use
the complete pre-v19 backup rather than an in-place schema downgrade. The nullable digest contains no gameplay or
economic state, so restoring the pre-migration database cannot reverse a committed gameplay operation. Timeline and
dashboard API code can be removed independently because both are read-only projections. The economy provenance block
is additive JSON in experiment records and has no gameplay-side migration. Rolling back the reader leaves existing
experiment rows intact; older readers ignore the extra metrics field.
Rolling back hashed audit writes does not remove or rewrite audit history. A previous writer must not append legacy
records after the hash chain has started; retain the new writer or explicitly archive the log before rollback.
