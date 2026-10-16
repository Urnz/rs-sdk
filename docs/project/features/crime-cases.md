# Crime case discovery and identification journal

The first `crime-cases` slice keeps observer knowledge separate from hidden
Thieving world truth. It accepts only persisted, audit-valid Thieving discovery
observations. Recording a discovery produces no suspect. A separate
`suspect-identified` event is possible only after that observation has been
recorded in the case and the trusted observation explicitly names a suspect.
An inferred suspect need not be the actual offender. The case state never reads
the outcome's hidden actor field into observer knowledge.

Case events are append-only, idempotent and hash-chain audited. A transactional
binding table ties each case id to one outcome even under concurrent writers;
one observation cannot be admitted twice for the same
stage. The projection's `legalFinding` remains null. Possession, provenance,
heat and a named suspect do not produce a finding or sanction. Independent
material evidence and a jurisdiction finding gate are in the next ledger, not
inferred from this case projection.

This new SQLite ledger starts at `PRAGMA user_version = 1`. Migration from an
empty file creates the case binding, event and audit tables; a newer schema is
rejected. There is no migration of existing Thieving or Property data. Rollback:
stop case consumers, retain the database as historical evidence, and revert the
module; do not delete or rewrite source Thieving observations. A future schema
change must be additive or provide an explicit data migration and restore plan.

`getWitnessSuspectDescription` is a read-only, observer-scoped precursor to
dynamic social descriptions. It returns a neutral, source-linked description
only for the exact agent who directly identified the suspect; anonymous
discovery, inferred identity and another witness's knowledge do not qualify.
It does not label anyone guilty or change base personality traits. The local
admin decision-context builder now loads the existing case and Thieving ledgers
once per snapshot, verifies their audit chains, and injects each description
only into the exact observer agent's own context. A missing source contributes
nothing; a partial or damaged source contributes nothing and surfaces a
`crime-case-knowledge` blocker. Other agents do not learn the hidden thief or
the witness's private observation. This is not an admin/client filing endpoint.
No schema change is needed; rollback removes the read-only context adapter.

## Evidence and findings

`CrimeEvidenceStore` is a separate SQLite v1 ledger. It admits a direct witness
identification only from an audit-valid case identification and a physical trace
only from a recorded physical-trace discovery. A possession entry needs its own
trusted inspection verifier, which must attest the observed holder, asset and
case linkage. Mere custody in item provenance is not observer knowledge.

The ledger records a legal finding only through a separate verifier responsible
for the issuing jurisdiction, effective policy, authority and adjudication. Its
baseline invariant additionally requires a recorded direct identification of
the named suspect for a `responsible` finding; possession, heat, a scene trace
or an inferred suspect alone cannot satisfy it. `not-proven` is not a finding of
innocence. This is a decision record, not a fine, arrest, restitution or prison
action. Those require later policy and settlement gates.

The evidence database is new and does not migrate existing case or Thieving
rows. It uses append-only evidence/finding tables and a shared audit chain;
unknown newer schema versions fail closed. Rollback stops consumers and retains
the evidence database, including any findings, for later replay or audit. Do
not delete it or turn a finding into an automatic sanction during rollback.

The internal `getJurisdictionCriminalRecord` view reads only audit-verified
`responsible` findings for the exact suspect and jurisdiction. `not-proven`
findings are retained in the legal ledger but never counted as a criminal
record. The view is not exposed to agents or the admin API, and it does not
infer reputation, moral standing, current custody or permission to sanction.
No persistent schema changes; rollback removes only this read-only projection.
Individual evidence and finding lookups, source lookups and case listings now
also fail closed on a broken evidence/source audit chain; private raw reads are
used only inside the chain verifier to avoid recursive validation. This
read-path change needs no migration and does not alter existing records.

## Fine proposal preflight

`createFineProposalVerifier` accepts a separate immutable v1 fine-limit policy,
not the evidence rule used to establish responsibility. A proposal must cite an
audit-valid `responsible` finding by its digest, the same suspect and
jurisdiction, the policy version issued and already effective at the incident,
an amount within that version's cap, an active issuing faction, and an independent
authority attestation. Future, retroactive, incomplete or reordered policy
families fail closed. `not-proven` cannot authorize a fine.

This is a **read-only gate**, not a fine, debt, treasury credit, player debit or
sentence. No LLM/client argument can serve as the authority attestation. The
`JurisdictionFinePolicyStore` is the trusted production source for the gate:
it records creation and activation in the Governance database and returns the
single audit-verified policy effective at the incident, including a superseded
or later-revoked version when the incident preceded the change. Passing an
in-memory array is useful for isolated tests, not for live fine decisions.
The catalog does not create a fine proposal record or collect any amount; a
separate audited, idempotent settlement workflow is still required.

`FineProposalStore` provides the next, still non-executing step: a separate
append-only SQLite v1 ledger of accepted proposals. It always uses the durable
fine-policy store and revalidates the cited legal finding against its original
crime-policy source, cited evidence and separate finding-authority attestation.
An audit-valid row alone does not establish a valid legal finding. The store
then applies the fine-specific evidence/authority gate, binds one proposal to each
legal finding, rejects a changed replay, and verifies its chained audit entries
and source references on reads. A proposal records a requested amount, not a
payable obligation, custody decision or transfer. Any later correction needs a
new legal finding and proposal; this ledger does not silently edit old records.
The typed constructor must receive trusted server-side stores and an independent
authority verifier, never an LLM-provided callback. Production must supply the
durable crime-policy source; `FineProposalStore` requires both durable policy
catalogs at construction, including a runtime guard. In-memory crime policies
are only accepted by the stand-alone read-only verifier for isolated tests.

The proposal database migrates atomically from empty `user_version=0` to v1;
it is independent of the Governance v10 migration. Rollback before first
proposal: stop writers and remove only the empty proposal database after a
backup. After recording proposals, retain the v1 file and its audit history,
and use a v1-aware reader or an audited export; do not drop it as a downgrade.
No balance or inventory migration occurs.

`FineDecisionStore` adds a separate institutional decision after a proposal.
It requires the exact audit-valid proposal digest, the same suspect and
jurisdiction, a currently authorized faction at decision time, and a distinct
trusted adjudicator attestation. A proposal receives one immutable `approved`
or `rejected` decision; only approval carries the proposal's exact amount,
while rejection records zero. An actor ID is attribution, not proof of office:
the server-supplied authority verifier must establish the adjudicator's role
and decision evidence. Neither an LLM nor an API client may provide that
verifier. Decisions are audit-chained, idempotent and fail closed on source or
row tampering. This is **authorization only**, not a player debit, treasury
credit, custody action or collectible debt. Appeals/reversals will require a
separate compensating workflow rather than editing history.

The decision ledger is a separate SQLite `user_version=1` database with an
atomic empty-to-v1 migration. Before use, stop writers and back up this file;
after any decisions exist, rollback must retain its rows and audit chain for
a v1-aware reader or explicit audited export. The existing institutional
treasury transfer only supports institution-to-institution balances; player
collection remains blocked until a verified player settlement adapter can
perform an atomic, idempotent and audited transfer.

`inspectFineCollection` is a read-only diagnostic for that boundary. It
rechecks the decision's audited source chain, rejects an institutional
rejection or currently inactive creditor, and compares the original outcome's
exact player username and agent ID with the current player control profile.
It reports a candidate payer and the faction treasury actor only for review;
`canCollect` is always false and the missing cross-ledger settlement remains a
mandatory blocker. A mutable current avatar binding is not itself historical
proof of account ownership at collection time. The engine's escrow `consume`
removes player assets while treasury external credit occurs in a separate
SQLite ledger, so a crash-safe, idempotent coordination and reconciliation
workflow is required before either operation can be used for fines. No
persistent schema changes or data migration are introduced by this diagnostic;
rollback removes only the projection.

The treasury's existing `creditExternalSettlement` route now creates one
append-only `institution_treasury_external_credit_audit` hash-chain entry in
the same SQLite transaction as its receipt and balance increment. Verified
receipt reads and all external-credit writes check the complete chain and
receipt coverage first; exact replay makes no new entry. This does not verify
the player's debit or authorize fine collection. Other treasury operations
remain available if an older external receipt lacks audit. A read-only check
of the current local treasury file found one such historical receipt; it is
not automatically backfilled or treated as trustworthy evidence. That file's
external-credit route remains closed pending explicit source/balance
reconciliation and an audited migration decision.
The verified `listExternalCredits()` returns the complete cohort without a
limit, so a later reconciliation cannot miss an extra receipt with the same
source reference merely because a paginated result was truncated. It fails
closed on any missing or corrupted receipt/audit entry, including historical
unaudited entries.

The audit table is an additive schema change. Before deploying a writer, stop
treasury writers and take a consistent backup of the treasury SQLite file and
its WAL/SHM state. On an empty external-credit cohort, the new table starts an
empty chain. Existing receipts without corresponding audit cannot be inferred
from current balances and must not be silently migrated. Rollback before any
new audited credit can use the pre-change backup; after one exists, preserve
receipt, balance and audit together for a version-aware reader or explicitly
audited export. Dropping the audit table or restoring only part of the ledger
would erase evidence and is not a valid rollback.

`FineCollectionIntentStore` is a separate, inert collection-plan ledger. It
re-runs `inspectFineCollection` against the typed decision, proposal, finding,
case, outcome, avatar and Governance sources before recording and on every
read. It accepts only an approved decision, a currently active creditor, an
exact current player-avatar binding and non-null faction/treasury endpoints.
The one-per-decision collection ID is derived from the canonical decision ID;
the immutable amount and endpoints are hash-chained with the intent row.
Exact retries return the original row; changed legal sources or row/audit
tampering fail closed. This is a plan, **not** a debt, debit, credit or
permission to remove the mandatory settlement blocker. There is no World,
gateway, LLM or asset-mutation route for it.

The intent ledger uses a new standalone SQLite file with `user_version=1`.
The empty-to-v1 migration atomically creates the intent and audit tables;
existing decision, escrow, player and treasury data are untouched. Before
enabling writers, stop them and take a consistent backup of this file and its
referenced legal source ledgers (including WAL state). Older code cannot read
the v1 intent file. Rollback disables intent writers and retains every row and
its audit chain for a v1-aware reader or explicit audited export; restore a
matched pre-migration backup only if no later intents were recorded. Do not
delete intent history or reinterpret it as a completed collection.

The faction's identity alone is not an adjudicator appointment. A separate
`FineAdjudicatorGrantStore` records the narrowly scoped right to decide fines
for one jurisdiction and one existing agent. Grant and revocation each need an
independently attested local administrative action; self-appointment, missing
agents, disabled jurisdictions and overlapping historical intervals fail.
The grant audit chain preserves the interval that was effective at the decision,
so revoking an appointment later does not rewrite an earlier valid decision.
`createFineAdjudicatorAuthorityVerifier` combines that historical grant with a
second, explicit decision-action verifier. A grant by itself does not show that
an agent actually made a decision, and agent skill knowledge or a mutable
control profile is not treated as legal office. `FineDecisionStore` requires
this grant source in its normal constructor; the caller cannot supply only an
unscoped decision callback, and the store rejects a non-catalog runtime value.
No LLM-facing grant/decision tool or public
endpoint is exposed.

Grant storage uses its own SQLite `user_version=1` database, migrated atomically
from an empty file. For rollback before any appointment, stop writers and
restore the pre-migration backup. After appointments or decisions exist, retain
the v1 file and audit chain for a compatible reader or audited export; deleting
the grants would destroy the explanation for historical decisions. This store
does not create a debt or move money.

Migration: opening a Governance v9 database atomically advances it to v10,
adding `governance_fine_policy` and its hash-chained audit table without
rewriting existing jurisdictions, crime policies, or findings. Back up the
Governance SQLite database before deployment. Rollback before any fine policy
write: stop writers, restore that backup and run the v9 code. After fine
policies have been written, preserve the v10 database and use a v10-aware
reader or an explicit audited export; do not silently downgrade or discard the
policy history. No player balance or inventory migration occurs.

## Observation ingest and backfill

The opt-in local Thieving watcher now also drains persisted discovery observations
through a separate `CrimeObservationCursorStore`. It reads the Thieving audit
sequence, including observations created before this adapter was deployed, then
idempotently writes a case discovery, any explicitly observed identification,
and only admissible direct-witness/guard or physical-trace evidence. An unnoticed
witness candidate is not an observation; a noticed but unidentified witness
creates no suspect or direct proof. The hidden outcome actor never supplies the
case suspect. No legal finding or sanction is generated by this adapter.

Each cross-ledger write precedes its cursor commit. A crash may leave a partial
case/evidence prefix, but retry reuses existing source-bound records and does not
skip the observation. Existing case bindings and manually recorded case events
are reused rather than duplicated; ambiguous outcome bindings fail closed. The
cursor is a separate SQLite v1 file with an append-only hash chain and source/
projection verification. It adds no migration to Thieving, case or evidence
databases. Rollback stops the watcher and retains all ledgers and the cursor;
reverting code does not delete or reverse discovered information.

## Explicit witness reports

The gateway also revalidates the independent engine journal and attention
decision for agent-bound discoveries in the engine producer's `witness:`
namespace, before recording or replaying a report. Exact observer identity,
outcome receipt/digest, observation digest, time and a positive attention roll
must agree. Missing engine/decision/policy sources fail closed, just like the
player-only route. The shared acceptance fixture covers both branches and a
corrupted engine source. It starts at a fixture-written real engine journal,
not at live RuneScript or HTTP login; it does not certify those boundaries.
No persistent schema changes; code rollback keeps every existing journal but
removes this stricter source check.

`CrimeReportStore` is a separate SQLite v1, append-only, hash-chained notice
ledger. A report requires a persisted case discovery whose `observerAgentId`
matches the reporter, plus an independent trusted attestation of that agent's
explicit report action. An anonymous/player-only witness still has no agent
report path; the player-identity port never invents an agent. Reports have no
free-form narrative in this first slice,
so untrusted chat cannot become legal fact by being copied into the ledger.

The report records that a known observer filed notice, not that the suspected
actor committed the offense. It does not alter case identification, evidence,
legal findings, inventory, ownership or sanctions. There is no game-client/admin
filing UI; the typed store is called only from a trusted explicit-action port.
The report database does not migrate existing ledgers. Rollback
stops report writers and retains the file with its source case events; never
delete prior reports or reinterpret them as convictions.

`fileWitnessReportForAvatar` is an internal typed intake port. Its caller must
resolve the avatar username from an authenticated local game session (never
from request JSON, chat or LLM output). The port derives the agent from the
unique persisted player identity, checks the exact player control binding and
the case's observer, then delegates to the separate explicit-action attestation
verifier and audited report ledger. This does **not** supply session
authentication or action attestation itself. Do not expose it through an admin
route: admin authorization alone cannot prove which player witnessed and
intentionally reported an event. The port changes no persistent schema; a
rollback retains recorded reports.
The gateway SDK password check is optional in local configurations, so an SDK
connection alone must not be mistaken for the required authenticated action.
Both single-report reads and case listings now verify the complete report and
case audit chain before returning data. This read-path hardening changes no
schema; rollback can revert the reader while retaining the v1 ledger.

The first player-facing intake is `POST /crime/report/:username` on the local
gateway, with an `Authorization: Bearer <player password>` header and an exact
JSON body `{ "caseId": "...", "sourceCaseEventId": "..." }`. It refuses all
requests while `LOGIN_SERVER` is disabled, requires successful per-avatar login
authentication and a fresh live game state for the same avatar, and does not
enable cross-origin browser access or password-in-URL/body shortcuts. The
server derives a stable report ID and action attestation; the client cannot
claim a reporter agent, timestamp or proof digest. Exact retries return the
same report. The existing port still requires a unique player-agent binding
and that agent's recorded discovery, so unrelated or anonymous witnesses do
not gain a report path. This files notice only, not a finding or sanction.
No existing data is rewritten: the report v1 file may be created on the first
authenticated filing attempt. Rollback disables the route and retains that
audited file and its source ledgers, rather than deleting recorded notices.
`BotSDK.fileWitnessReport(caseId, sourceCaseEventId)` provides a typed client
for this endpoint. It sends the configured player credential only in the
Bearer header and returns the stable report ID; the gateway still applies all
login, live-avatar and source checks. It is not an LLM sanction tool.

Player-only witnesses from the Property burglary sight snapshot have a separate
read-only proof gate, `verifyPlayerOnlyWitness`. It accepts only the exact
authenticated username in an audit-valid, noticed `WitnessAttentionDecision`
whose `observerAgentId` was null when issued. The decision digest must match
the persisted direct-witness observation, which in turn must match the case's
discovery event and outcome. A later agent binding cannot rewrite the
historical player-only decision. A missed attention roll, another username,
an agent-bound witness or a damaged source chain yields no proof. This does
not expose hidden offender identity or create a report; a future separate
audited player-report schema and migration is required before the HTTP intake
can accept this witness class. No persistent model changes here; rollback
removes only this read-only gate.

## Read-only fine-ledger reconciliation

The read-only fine-ledger diagnostic derives versioned, domain-separated UUIDs
for a prospective shared player escrow and treasury external-credit receipt from
the audited `collectionId`. The receipt `sourceRef` convention is the same
`collectionId`. This mapping is only a naming convention, not evidence that any
movement happened. The diagnostic checks the intent source and audit, the shared
escrow audit, and the treasury's **complete** external-credit receipt/audit
cohort. It distinguishes no movement, held/released escrow, debit without a
receipt, matching receipt *shape*, and conflicts/unverifiable sources; every
result has `canCollect: false` and `canMarkPaid: false`. In particular, an
unusual/missing payee, amount, payer, currency, status, source reference or
duplicate treasury receipt is not silently accepted. A legacy non-shared escrow
or an unaudited treasury receipt yields an unverifiable result.

The stores are separate SQLite files, so these reads are not a joint atomic
snapshot. Their local hash chains are not external signatures, and the treasury
receipt audit does not authenticate the current aggregate balance. Before any
live collection, a separately reviewed durable settlement saga, recovery and
compensation policy, and debtor-session approval are still required. This slice
adds no persistent schema and performs no migration; rollback removes only the
diagnostic code. Do not delete or rewrite historical ledger rows to make a
report look clean.

## Jurisdiction crime policy

`createJurisdictionFindingVerifier` accepts immutable, schema-versioned policy
records or a `JurisdictionCrimePolicyStore`, plus the existing Governance, case
and Thieving stores. The policy digest
commits to the jurisdiction, version, effective timestamp and evidence rule.
The adapter resolves the verified incident target through Governance territory,
uses the deepest jurisdiction with a policy effective **at the incident**, and
rejects a request that cites a parent, future, mismatched or altered policy.
Territory and jurisdiction records created after the incident cannot establish
retroactive authority. The relevant faction must have been active at the incident,
and the issuing faction must also be active when the finding
is made. A separate trusted authority/adjudication callback must attest the
request's authority evidence digest; this adapter never makes a finding itself.

For `responsible`, every configured evidence kind must be cited. Direct
identification remains mandatory in the base ledger; any possession rule must
refer to the named suspect's actual inspected custody, not somebody else's.
`not-proven` is still an explicit adjudicated record, not an inference from a
missing proof. No arrest, confiscation, fine or reputation change follows.

The production policy source is the existing Governance SQLite database, not
a second jurisdiction registry. Its typed store creates immutable draft rule
versions, then atomically activates, supersedes or revokes them with actor-bound,
hash-chained audit entries. There is one active version per jurisdiction. Reads
verify the entire policy audit chain and return only the version effective at
the incident timestamp, including a subsequently superseded or revoked version.
Drafts never apply; a disabled faction cannot modify its rules. A direct static
catalog remains available for isolated tests and trusted configuration. Only a
trusted local admin caller may invoke the policy store's write methods; the
recorded actor ID is attribution, not proof of administrative authorization.
No policy mutation is exposed directly to chat, an LLM or the game client.

Governance schema v9 introduced `governance_crime_policy` and its append-only
audit table, with foreign keys to existing jurisdiction identities. The v8→v9
migration remains additive and atomic; current migration tests advance legacy
v1 and synthetic v8 databases through v9 to the current v10 schema. Before
deployment, back up the Governance database along with its WAL state while
writers are stopped. Application-only rollback is not compatible with a newer
database: stop Governance and crime-policy writers, restore a compatible
backup, and reconcile any later Governance/treasury operations before
restarting older code. Preserve policy rows and their audit chain if any legal
findings cited them, so historical digests remain explainable; never erase or
automatically reverse such findings.
There is no migration of existing case, evidence, Thieving or player-save data.
