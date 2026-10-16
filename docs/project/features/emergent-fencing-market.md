# Emergent fencing market

`fencing-market` is an opportunity projection, not an NPC class, permanent shop
or personal Fencing skill. It evaluates ordinary active agents and Businesses
from evidence-bound snapshots of their available GP, free storage, learned
relationship to the seller and ordinary capabilities such as appraisal.

A candidate participates only when it can fund the exact acquisition, store the
goods, satisfy the required capabilities and relationship thresholds, and retain
the configured minimum expected profit after estimated risk cost. The decision
binds the candidate and opportunity evidence digests and exposes the finite
capital commitment. Higher margins can therefore attract already existing,
capable candidates without spawning a replacement actor.

Deceased, imprisoned, insolvent or inactive candidates are ineligible. If every
candidate leaves or declines, the projection returns `unavailable`; there is no
fallback fence. An empty local candidate set is a valid market state.

A positive decision is now executable only through `FencingSettlementCoordinator`.
It accepts an exact, verifier-approved and complete player-trade receipt. For a
tracked asset it first transfers custody without changing legal title. A Business
candidate then receives the exact quantity into its ordinary finite inventory or
storage and commits an already funded treasury reservation. A personal agent's
physical trade already moved its own coins and inventory, so the coordinator does
not duplicate those mutations.

Each underlying ledger mutation is atomic and idempotent. Because provenance,
Business assets and treasury are separate SQLite databases, the complete flow is
a persisted restart-safe saga rather than a fictitious cross-database
transaction. Its hash-chained journal records each successful boundary. On retry
it resumes only missing steps; a completed step cannot debit funds or add stock
twice. Free-form model output cannot serve as a trade receipt.

Schema v1 creates a dedicated `fencing_settlement` database and audit chain.
Business asset databases add `business_asset_receipt` and its audit table with
`CREATE TABLE IF NOT EXISTS`; existing inventory is not rewritten and receives
no invented provenance. Before deployment or rollback, stop writers and back up
each database with WAL/SHM sidecars. Reconcile every `settling` row before rolling
back. Older Business code safely ignores the additive receipt tables, but the
settlement and receipt ledgers must be retained as audit evidence and must never
be deleted after a committed trade.
