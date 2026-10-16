# Phase 23.8 – terminal memory archive and explicit knowledge transfer

Verified finite-population death now archives the agent's personal episodic and
social memory in the same AgentState transaction as the death receipt,
`deceased` lifecycle and autonomy closure. Semantic facts, skill-knowledge records
and consolidation evidence are preserved in the snapshot as well. Their presence
in an archive does not give another agent access or execution rights.

## Archive and preservation

AgentState schema v24 adds the immutable memory archive, transfer receipts,
hash-chained memory audit and tail anchor. A new authoritative death captures
all rows rather than a retrieval page: an agent with more than 500 episodes
retains the complete history. Source relationships preserve their own trust,
affinity, notes and reported debt; these remain the deceased's perspective.
The archive also records the control profile and economic affiliations present
at admission, the exact engine/AgentState death digests, engine recording time,
simulation death time, capture time and capture mode.

Persistent SQLite guards reject ordinary insert/update/delete operations on a
deceased agent's episodes, social and semantic memory, skill knowledge and
consolidation evidence. Updates check both the old and new owning agent. A
`deceased` lifecycle without verified death evidence is also protected, but no
archive is invented for it. Episode retention reports `population-archive`
protection and pruning preserves the closed agent's evidence.

Archive insertion, audit append and tail update must each affect exactly one
row. An ignored or failed write rolls back the entire AgentState death
projection. The independent engine closure remains authoritative, so that
failure never revives physical execution. Reconciliation can retry once the
storage failure is resolved. Checksums, audit sequence/tail and frozen source
rows detect modified content, incomplete records and truncated history.

Migration does not reconstruct historical memory. Existing v23 identities and
death records gain empty archive metadata only. A later reconciliation against
the exact engine death can capture the currently available records, explicitly
marked `late-reconciliation`. It does not claim that this was the memory at the
original engine tick. Normal new admissions are `death-admission` captures.

## Explicit policy and recipients

`config/population-memory-transfer-policy.json` starts with an empty `rules`
list. Neither Property inheritance nor organization membership automatically
copies knowledge. Each reviewed rule binds an exact source agent, recipient,
archive digest, selected semantic knowledge IDs, mode and confidence ceiling.
There is no wildcard or implicit fallback. For example, a personal bequest rule
has this shape inside `rules`:

```json
{
  "ruleId": "reviewed-personal-knowledge",
  "sourceAgentId": "existing-deceased-agent",
  "recipientAgentId": "existing-living-agent",
  "archiveDigest": "<exact 64-character archive digest>",
  "mode": "inheritance",
  "organization": null,
  "knowledgeIds": ["existing-archived-knowledge-id"],
  "maximumConfidence": 50
}
```

Personal inheritance requires a distinct active player agent and matching
player control profile. Engine terminal status is checked independently of
AgentState ingestion. A reset, deceased, missing or incompatible recipient is
blocked. An organization rule instead requires the exact institution controller
and an archived owner/manager/member affiliation with the named Business or
faction. The affiliation's creation and last update must precede or match the
engine death recording time. A late archive cannot establish a historical
organization affiliation and is rejected for this mode.

The selected source facts must exist, be active and remain within their
validity window. A recipient's existing active subject/predicate fact blocks
transfer rather than being silently superseded. Policy, archive, recipient
identity/profile/lifecycle/membership and current semantic state are bound to
the preview digest; changed approval input or recipient state requires review.

## What learning creates

The transfer creates new recipient semantic records with source `manual`, an
`archived-knowledge` tag and confidence equal to the lower of source confidence
and policy ceiling. Decision context labels them `archived report`. These are
reported facts, not independently verified skill definitions or permissions.

Each selected fact has a new, recipient-owned acquisition episode. It is marked
`untrusted` and contains only provenance identifiers, not the source's private
episode details. Its evidence link satisfies the existing rule that semantic
evidence must belong to the same agent. The transfer receipt binds the original
archive/fact, policy, human reason, preview, new fact's immutable content and
acquisition episode checksum.

The workflow does not copy source episodes, social relationships, trust,
affinity, debts, personality, goals, skill-knowledge status, verified skill
definitions, licenses, organization grants or execution capabilities. A semantic
`procedure` fact remains a reported fact; it does not mark a skill known or
grant permission to run it. Other specialized organizational repositories need
their own explicit transfer adapter; this MVP handles AgentState semantic facts.

## Atomicity, replay and authority

The admin operation reserves AgentState first and the engine death database
second, following the same lock order as Property inheritance. Under these
short write reservations it verifies source death and recipient terminal status.
Source archive validation, recipient preview, acquisition episodes, semantic
facts, transfer receipt and audit are committed in one AgentState transaction.
The engine reservation writes no world state. A failed or ignored receipt/audit
write rolls back all recipient changes as well.

A stable transfer ID with the exact request, preview and policy replays the
original receipt without learning twice. Conflicting reuse fails closed. A
later legitimate semantic supersession changes status/revision but preserves
the original imported fact's immutable body, so historical replay remains
valid. Modified acquisition evidence, fact body, receipt indices or audit data
is rejected. Source memory stays archived throughout.

## Admin interface

The existing authenticated local-admin/token boundary protects all new routes:

- `GET /api/admin/population-memory/:sourceAgentId/archive` reads the complete
  archive and digest for review. Missing verified archival data returns null.
- `POST /api/admin/population-memory/:sourceAgentId/transfer-preview` takes
  `recipientAgentId`, `ruleId` and an 8–1000 character `reason`; it returns the
  selected IDs, digest references, blockers and preview `digest`.
- `POST /api/admin/population-memory/:sourceAgentId/transfer` takes the same
  selection plus `transferId` and the exact `previewDigest`.

Preview may reconcile a missing historical archive against the engine source;
it never transfers facts. Policy files are server configuration, not body-supplied
permissions. These operations are not added to agent SDK/model tools. The admin
agents projection exposes only archive metadata/counts through
`populationMemoryArchive`; the dedicated authorized archive endpoint handles
the complete personal record. No UI redesign is introduced.

## Migration and rollback

The v23→v24 migration is additive and transactional. It creates
`agent_population_memory_archive`, `agent_memory_transfer`, `agent_memory_audit`,
`agent_memory_audit_tail` and preservation/immutability triggers. It preserves
existing memory rows and creates no death, birth, historical archive or learning
event. The read-only avatar action gate accepts additive v24; it still refuses
future unsupported schemas. Engine death schema v2, SimulationClock v4 and estate
coordinator v1 remain unchanged.

Stop engine/gateway/agent writers and back up AgentState, the engine death
source, common clock, estate/economic databases and exact policy files together,
including WAL/SHM sidecars. Deploy matching readers/writers before restarting.
The empty shipped transfer policy remains inert until reviewed archive-bound
rules are configured. Implementation verification starts no bots or live world.

Older AgentState writers reject v24; do not lower the schema marker, remove
preservation triggers or restore a recipient alone to undo an import. Preserve
the current audit and keep writers stopped or retain the compatible version.
A pre-upgrade rollback must restore the complete coordinated snapshot as a
separate experiment; otherwise an already learned fact could lose its provenance
or be learned twice. There is no destructive in-place down migration.

## Verification

The focused suite covers full archive/restart, more than 500 episodes, prune and
postmortem mutation denial, missing death authority, additive migration and late
capture, historical organization eligibility, source/audit corruption, scoped
semantic copying, engine-only recipient closure, expired facts, stale preview,
idempotent replay and supersession, ignored writes, complete rollback and the
authenticated HTTP boundary. Existing death and estate/Property inheritance
regressions are included. Final counts and complete log paths are recorded in
PHASE23_PROGRESS.md.
