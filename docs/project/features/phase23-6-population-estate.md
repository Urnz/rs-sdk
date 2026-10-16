# Phase 23.6 – verified estate custody

A verified terminal death opens a durable estate case and puts the affected
economic records into custody. The deceased loses economic grants and active
employment; owned Businesses become dormant. Contracts, funding, loans,
reported debts and Property retain their history and enter explicit holds.
`custody-ready` means that all required sources have supplied consistent custody
receipts. Distribution, debt repayment, forgiveness, successors and inheritance
policy belong to 23.7; custody does not perform those operations.

## Admission and source boundaries

`VerifiedEstateDeath.load` requires the original engine death journal and the
AgentState v23 receipt to agree exactly with the current deceased membership.
The authority and ownership context are immutable, runtime-branded values.
Caller-created objects, a model assertion or a mortality candidate cannot
authorize custody. The estate ID derives from the verified event and digest;
its case binds the exact death, estate-policy digest and all source paths,
including the engine death path. A conflicting binding fails closed.

`population-estate-policy.json` requires eight existing sources: AgentState,
Business, contracts, treasury, banking, Property, governance and shared engine
escrow. Each source must have its expected schema and pass SQLite integrity
checks. A missing file/table, row-limit breach, invalid audit or ambiguous
in-flight economic operation blocks completion. A missing source is never
created as an empty ledger or treated as proof that no liabilities exist.

The source receipts preserve original IDs and facts:

- AgentState archives and revokes non-self economic grants, retains reported
  social debts/receivables and commitments, and cancels pending action requests.
  Running or settling requests require reconciliation.
- Business ends the deceased's employment and makes owned Businesses dormant.
  Their inventory and legal identity remain distinct from the personal estate.
- Contracts withdraw open offers and hold affected contracts, evidence and
  funding. Related institution agents are resolved from actual control profiles.
- Treasury preserves balances and reservations, with held actors projecting
  zero spendable funds. A counterparty's related reservation is held without
  freezing that counterparty's unrelated account activity.
- Banking preserves loans, principal, collateral, deposits and settlement
  records belonging to affected institutions. Institutional debt is not
  reclassified as personal debt.
- Property keeps its original owner and title history, becomes locked and is
  linked to the estate. Pending purchases require reconciliation.
- Governance retains affected obligations and their resolution history.
- Shared engine escrow preserves affected payer/payee and contract escrow rows
  and verifies the native authority marker, legacy baseline and audit chain.

These are source-specific claims, not an aggregate inheritance valuation.
Relationship observations and explicit commitments can describe the same debt;
the system does not add them together or declare them legally adjudicated.
Specialized downstream liability stores need their own explicit adapter before
their records can authorize a later distribution policy.

## Transactions, replay and persistent barriers

All reachable sources receive persistent holds before economic effects begin.
SQLite triggers reject ordinary inserts, updates and deletes involving held
subjects, including attempts to regrant another agent rights over an owned
Business. Updates check both their old and new subject. Ordinary store APIs
remain subject to the same barriers after restart.

Each source applies its effects, archives original claims, seals resulting rows
and writes a checksum-protected receipt in one immediate transaction. A temporary
write permit exists only inside that transaction and is removed before commit;
a failure rolls it back with the effects and receipt. A persisted permit is an
integrity error. Prior custody holds remain in place if effects fail.

The coordinator stores source receipt digests with a hash-chained audit and tail
anchor. It does not claim atomicity across independent databases. If a source
commits before the coordinator acknowledges it, replay validates the existing
receipt and sealed rows, then resumes without repeating effects. Missing or
changed rows, receipt corruption and audit truncation block the case.

Readiness also checks funded contract amounts, payer identities, settlement IDs
and statuses against the real treasury reservations, and player escrow assets
against the independent engine ledger. A funded contract alone is insufficient
proof. Loss of death authority after readiness returns the case to `blocked`.

## Runtime integration and activation

The gateway runs custody after death reconciliation in its existing ten-second
population cycle. Estate failure is caught separately so health processing can
continue. The admin agents output includes `populationEstate`; a deceased agent
without ready custody has an explicit trusted decision blocker.

Default coordinator storage is `.local/simulation/population-estates.sqlite`.
Sources use the real admin databases, `.local/economy/banking.sqlite`, Property's
`PROPERTY_STATE_DB` override or `.local/admin/properties.sqlite`, and the shared
`PLAYER_CHECKPOINT_DATABASE` / `GE_DATABASE` override or
`server/engine/data/player-checkpoints.sqlite`. The engine death source uses the
existing population-health evidence path. Provision the real banking/governance
schemas and the verified shared escrow authority before relying on readiness;
an unprovisioned source deliberately leaves the estate blocked.

Implementation tests do not restart live engine/gateway processes or run bots.
Activation requires the coordinated 23.5-capable engine/gateway deployment and
matching source paths. The current live processes were not restarted here.

## Migration and rollback

The coordinator starts at schema v1 with empty case/audit tables. Each economic
source adds namespaced `population_estate_*` schema v1 tables and guard triggers
in an atomic schema transaction. Existing domain schema markers are unchanged:
AgentState remains v23, engine death journal v2 and SimulationClock v4. No
historical death, birth, debt or estate is inferred during migration. Source
rows change only after a currently verified deceased member is admitted.

Stop all engine/gateway/economic writers and take one coordinated backup of the
eight source databases, estate coordinator, engine death source, common clock
and player checkpoints/saves, including WAL/SHM sidecars. Preserve the exact
policy configuration and paths with that snapshot. Restart matching versions
against those sources; interrupted cases resume from their durable receipts.

For application rollback, retain the terminal avatar and estate barriers and
keep economic writers stopped if the older application cannot interpret them.
Do not delete holds, lower schema versions, discard receipts, reopen Businesses
or restore a Property/wallet independently. Those actions could reactivate
rights or mix already committed source stages. Preserve the current audit
archive; restoring a separate pre-upgrade experiment requires the complete
coordinated snapshot, never a partial source restore into the current estate.

## Verification

The estate integration suite uses real AgentState, Business, contract, treasury,
banking, governance and Property stores plus actual engine death and shared
wallet escrow evidence. It covers readiness without asset distribution,
restart/idempotence, missing-source recovery, source-commit/coordinator-crash
recovery, transactional rollback, role/fund/debt/Property mutation rejection,
funding mismatches, ambiguous settlement, forged context, lost death authority,
sealed-row corruption, audit truncation and admin blockers. The real wallet
test confirms that an escrow release rejected by custody rolls back the wallet
and retains the held funds. Complete run results are in PHASE23_PROGRESS.md.
