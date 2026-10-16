# Phase 22 acceptance and operations

Phase 22 closes through one exact acceptance fixture and one generated evidence
bundle. The fixture is `config/fixtures/phase22-acceptance-v1.json`. It enumerates
22.1–22.7 in order, the exact focused test files for each package, the four live
Thieving procedures, both observer classes, required restart replay, operational
sources, policies, switches and failure injections. Missing coverage is an error;
there is no skipped or “not available but passed” state.

## Workers and switches

The normal local profile is started with:

```powershell
pwsh -NoProfile -File scripts/start-local.ps1 `
  -GatewayLoginAuthentication -EnableThievingProcessor
```

`-EnableThievingProcessor` starts `thieving-procedures/watch.ts`. It consumes the
engine-owned Thieving journal, verifies its audit chain, writes procedure receipts,
rights facts, witness decisions and discovery/case observations. Starting an
already-running stack without that worker is rejected instead of silently claiming
coverage.

The gateway performs startup and periodic recovery for ready fine-collection and
justice-execution sagas. `PLAYER_ESCROW_SHARED_CHECKPOINT=true` selects the shared
engine escrow authority; `PLAYER_CHECKPOINT_DATABASE` selects its SQLite database.
The local launcher sets both explicitly and does not derive checkpoint authority
from Grand Exchange enablement. `TRADE_EVIDENCE_DB`, `PLAYER_CUSTODY_DB`,
`CHECKPOINT_ENGINE_EVIDENCE_DB` and `PROPERTY_STATE_DB` may isolate their respective
engine ledgers. Their defaults remain local private-emulator paths.

`CRIME_REPORT_ACCEPTANCE_BUNDLE` is acceptance-only isolation. The gateway refuses
it unless real login authentication is active. It routes crime intake and the
processor to `.local/phase22-live/<bundleId>` without treating files in that
directory as authority; authenticated HTTP and all source audit chains are checked
again during replay.

## Policies and sources

The fixture pins the relevant policy files rather than duplicating their content:
witness attention, Housing security, checkpoint policy, reintegration policy and
item provenance policy. The authoritative sources remain separate: engine theft,
checkpoint, trade and custody ledgers; authenticated witness observations; crime
case/finding/report ledgers; shared escrow and treasury; provenance/transformation
lineage. A source adapter returning no or invalid evidence fails the operation or
projection. It never silently disables verification.

## Live vertical and exact evidence bundle

Use only the three dedicated local acceptance avatars named in the fixture. First
run the pickpocket live trial; it prints and creates the timestamped
`pickpocket-...` seed bundle. The completion orchestrator accepts only that real,
restart-verified seed and fails before starting services if any required source is
missing or unaccepted. Its audited offline setup banks the dedicated thief's
accumulated inventory while retaining one lockpick, preserving exact item totals
and a rollback backup so repeated transfer trials cannot fill the inventory. It
then performs real gameplay for door lockpick, container
theft and property burglary; exercises player-only and agent witnesses; performs
explicit reports; restarts engine and gateway; and requires exact replay.

```powershell
bun scripts/run-phase22-pickpocket-live.ts `
  rKFXWHZFk YJLhy3Vpb

bun scripts/run-phase22-completion-live.ts `
  <pickpocket-bundle-id> rKFXWHZFk YJLhy3Vpb ZUgnsbd3A

bun scripts/run-phase22-acceptance.ts `
  <final-bundle-id> .local/phase22-live/<pickpocket-bundle-id>
```

If the seed already contains both accepted recognition trials, pass
`--resume-procedures`; the runner revalidates them through authenticated HTTP and
their audited sources before continuing. A newly invented bundle id is not a valid
shortcut because it has no theft/procedure/case/witness source chain.

The second command reruns the fixture’s exact 22.1–22.7 focused tests and writes
`.local/phase22-acceptance/<final-bundle-id>/evidence-bundle.json`. The bundle
contains SHA-256 digests and byte counts for every required live artifact, the
focused verification log, package coverage, operational inventory and failure
injections, plus a canonical bundle digest. It is replay-verified after writing.

## Failure and recovery

Focused tests inject tampered/missing audit sources, changed idempotent replays,
fine/justice crash boundaries and deleted transformation ancestry. The live trial
adds full engine/gateway restart replay. Any non-zero test process, missing live
file, false `passed` value, incomplete procedure set, missing explicit report or
digest mismatch fails the acceptance runner.

Acceptance outputs are ignored local evidence. Keep a completed bundle together
with the referenced live directory. Product database migration and rollback remain
defined by each package’s own document. The acceptance harness adds no production
schema and can be removed without changing product state. Large admin UI parity is
not part of Phase 22 and remains Phase 26 work.
