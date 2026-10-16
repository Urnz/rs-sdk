# Phase 23.7 – governed admin inheritance MVP

An authenticated admin can assign a deceased member's personal Property to one
living player-agent heir. A versioned rule explicitly binds the Property IDs
to a real faction and, optionally, a jurisdiction in that faction. Preview and
execution require ready 23.6 custody and the exact terminal engine/AgentState
death. The policy supplies an executable first inheritance mechanism; it does
not infer family relationships, legal domicile or an heir from social affinity.

## Scope and admission

The MVP transfers all personal Property in the selected estate under one
matching legal rule, in one Property database transaction. Each asset must have
been freely owned by the deceased before custody, with its exact locked version
and sealed row still intact. The policy's `propertyIds` are explicit legal
assignments; they are not inferred from an avatar's current map position.
Overlapping assignments and duplicate rule IDs are rejected.

The named faction must exist and be active. A named jurisdiction must exist
and belong to that faction. A faction-wide rule uses `jurisdictionId: null`.
Missing bindings, an inactive faction, inconsistent governance or an unassigned
personal Property block the decision. There is no implicit default law.

The heir must be a distinct active player agent with a matching avatar and
player control profile. A deceased/reset member or an institution cannot inherit
under this policy. The engine death journal is checked independently, so an
engine-closed heir remains ineligible before AgentState reconciliation catches up.

Unadjudicated personal social debt/receivables, open commitments, active personal
contracts, unresolved contract funding, governance claims, personal loans or
engine escrow prevent distribution. A Property with collateral is ineligible.
The workflow does not waive those claims or invent a zero balance. Its claim
checks use the eight verified 23.6 sources; it is not an adjudicator for other
specialized liability domains.

Business ownership, Business Property, institution balances, loans and collateral
remain in custody as separate legal-person assets. Player inventory, cash,
Business equity, multiple heirs, wills, automatic family succession, estate tax
and debt settlement are outside this first policy. `inheritance.status:
completed` means the personal-Property decision completed; the estate itself
continues to expose its custody state and retains all other holds. This is not
a declaration that the whole estate has been liquidated or distributed.

## Configuration

`config/population-inheritance-policy.json` defines
`admin-single-heir-personal-property`. Its shipped `bindings` list is empty:
installation alone never authorizes a live inheritance. Add reviewed assignments
using actual governance and Property IDs, for example:

```json
{
  "ruleId": "district-admin-inheritance",
  "factionId": "existing-faction-id",
  "jurisdictionId": "existing-jurisdiction-id",
  "propertyIds": ["existing-personal-property-id"]
}
```

The canonical policy digest and exact governance rows are bound to the preview
and immutable prepared decision. Changing a rule, governance revision, heir or
asset version invalidates a stale preview. A pending decision cannot silently
switch policy, heir, reason or scope. Keep the approved configuration with the
experiment; configuration replacement is not a way to rewrite an existing award.

## Admin interface

Both endpoints use the existing local-admin/token authorization boundary. They
are not added to the agent's SDK tools or model action catalog.

1. `POST /api/admin/population-estates/:estateId/inheritance-preview` takes
   `heirAgentId`, `ruleId` and an 8–1000 character `reason`. It returns the exact
   eligible assets, source/governance/policy references, blockers, estate
   `revision` and preview `digest`. Preview can reconcile existing custody but
   does not prepare or transfer an inheritance.
2. `POST /api/admin/population-estates/:estateId/inheritance` takes the same
   selection plus a stable `decisionId`, the preview's `expectedRevision` and
   `previewDigest`. Execution recomputes the preview and rejects stale input.
   The result is the estate case with its durable `inheritance` record.

The existing admin agents output already includes the estate case, so it exposes
prepared/completed inheritance state and the immutable plan without a UI redesign.
The first MVP uses admin selection; pre-death heir nomination is not required.

## Atomic title transfer and recovery

The coordinator first records a prepared decision in its existing hash-chained
case audit. Before title mutation, the implementation reserves the live
AgentState, engine death and governance writers with immediate transactions. It
rechecks donor death, heir identity/lifecycle, engine closure and governance
under those reservations. It then commits all selected titles in a single
Property transaction. This is a bounded locking protocol, not a distributed
atomic transaction across every economic store.

That transaction changes the owner to the heir, advances the Property version,
restores `owned` status, writes the native `property_transfer` receipt and an
inheritance receipt bound to the approved plan and original custody seal. It
checks that each UPDATE affected exactly one row and produced the exact expected
state. It removes only this estate's transferred Property hold. The deceased's
actor hold and all unrelated economic barriers remain. An active competing
Property custody claim blocks the transfer.

The temporary estate write permit is removed before commit. A failing later
asset rolls back every earlier title, receipt, hold release and permit. A
silently ignored UPDATE cannot produce a successful receipt. A source commit
before coordinator acknowledgement is recovered by the next normal estate
cycle, which validates the complete source/native receipts and marks the same
decision completed. If failure occurs before source commit, retry the exact
admin request; the prepared decision stays immutable and authority is rechecked.

Original 23.6 receipts are preserved. Their superseded Property seal is replaced
only by the exact centrally approved inheritance plan and matching immutable
native transfer proof. A later legitimate transfer by the heir does not rewrite
the former estate or fail its historical custody verification. A missing,
partial, forged or conflicting inheritance/native receipt blocks reconciliation.
Exact replay never transfers the title twice or advances revisions again.

## Migration, activation and rollback

Existing estate-case JSON gains an optional `inheritance` field; coordinator
schema v1 and its existing audit/tail remain unchanged. Existing cases have no
decision inferred. The Property source adds namespaced inheritance schema v1
and `population_estate_inheritance_transfer` only when executing its first
approved transfer, in the same transaction. AgentState remains v23, engine death
source v2 and SimulationClock v4. No historical heir or asset transfer is invented.

Estate coordinator and engine death-source stores explicitly finalize their
cached SQLite statements on normal and failed construction/close paths. The
estate cycle also reads the prepared plan once per member rather than repeating
the full coordinator audit for each source. These changes preserve verification
and prevent unnecessary retained SQLite resources during repeated admin cycles.

For activation, use the real eight economic sources and coordinated terminal-
lifecycle/custody-capable engine and gateway. Configure actual legal bindings,
restart the matching application version and request an admin preview. This
implementation verification does not restart live services or run bots.

Before upgrade/rollback, stop all relevant writers and preserve a coordinated
snapshot of the estate coordinator, eight economic sources, engine death source,
clock, shared checkpoints/saves and exact policy files, including WAL/SHM sidecars.
Do not remove a completed transfer or restore only the original Property owner:
the heir may have legitimately transferred it again. An older custody reader
cannot interpret the superseding inheritance proof and will block; keep the
compatible reader/barriers or leave writers stopped. Preserve the current audit
archive and restore a complete pre-upgrade snapshot only as a separate experiment.

## Verification

Integration coverage uses the actual stores and native title history. It covers
admin authorization, faction/jurisdiction rules, engine-only heir death, stale
preview, unresolved claims, collateral, exact replay, legitimate later title
transfer, source-commit/coordinator-crash recovery, source corruption, ignored
UPDATE and single-/multi-Property rollback. The unchanged 23.6 custody suite and
engine death-source tests are included. Final results and logs are recorded in
PHASE23_PROGRESS.md.

The new inheritance integration cases have a bounded 15-second per-case timeout:
they build and reconcile eight real SQLite sources and may perform several full
cycles. Earlier runs exceeded Bun's generic five-second default at varying
file-I/O steps without assertion failures. The existing custody test timeouts
and every assertion remain unchanged; there are no automatic retries or skips.

The initial full regression encountered six existing Lite cache failures because
the default `localhost:8888` emulator cache service was offline. Verification
uses a temporary loopback HTTP server reading the actual native packed cache
through read-only `FileStream`, with the engine's CRC algorithm and existing
`ondemand.zip`. `LITE_TEST_ORIGIN` is overridden only for its verification child;
the world, simulation clock and gateway are not started. The server closes after
the child exits. All 43 Lite tests, including the real browser collision oracle,
pass against that source. No cache assertions or unavailable-source checks were
removed, and the initial full FAIL remains recorded in the progress log.
