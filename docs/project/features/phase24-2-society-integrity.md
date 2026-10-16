# Phase 24.2 – genesis value and runtime injection evidence

The social `mature-society` and `historical-burn-in` profiles now acquire a durable
integrity observer when genesis starts. `society-integrity` records bootstrap
value separately from subsequent admin/fallback assistance. The observer is an
injection gate for the Phase 24.1 contract, not a self-sufficiency verdict or a
benchmark result. Phase 24.3 measurements remain separate.

## Bootstrap boundary

Each declared currency/item allocation has a separate `genesis-value` event.
Embedded Business opening capital is expanded into its own currency event, with
the derived `:capital` allocation ID; collisions with explicit allocations fail
before any application. Business stock remains an item allocation. The existing
world-genesis provenance journal is retained.

The local adapter also snapshots existing canonical save value for **every
founder**, including founders receiving no new allocation. Currency and each
inventory/bank/equipment entry receive `genesis-opening-value` events, and an
opening snapshot records even a verified empty holding. Existing configured
institutional balances and Business stock are observed before new credits.
These are observed starting holdings, with `historicalOrigin: unknown`; no
historical acquisition or internal production lineage is invented. Opening value
and the new allocation are distinct contributions to the starting endowment.

For finite local profiles, preparation reads/observes the actual shared
SimulationClock. `genesisAppliedAtSimulationTime` records the **start of genesis
application**, including bootstrap work. It can differ from the generated
result's initial clock anchor. Runtime events bind the same clock ID and profile
digest, with simulation and wall timestamps retained separately. Pausing the
clock does not hide an intervention or manufacture elapsed simulation time.

The journal enters `bootstrapping` before authoritative apply. Value events remain
pending until the verified adapter receipt, provenance and run application have
succeeded. Failure leaves an explicit incomplete application and unverified
integrity history. Preview does not create a journal or advance the clock.

Genesis native credits and offline edits use exact, single-use permits. Permits
must match the declared allocation; player edits bind the actual before/after
save value, preserving skills and location. An extra coin/item, changed recipient,
reused permit or a later call named `creditGenesis` cannot silently become
bootstrap value. The engine consumes the permit at its actual write boundary.

## Instrumented runtime boundaries

The native hooks record these sources automatically:

- `engine.offline-save`: positive currency/item/XP additions through offline edit
  or restore, with canonical before/after value. Moving an existing item between
  containers or removing value is not an injection. Persistence verification is
  inside the journal boundary.
- `engine.player-reward`: reward credits without observed native treasury backing.
  The existing settlement UUID makes exact replay idempotent.
- `engine.cheat-value`: actual `give`, `giveother`, `givecrap` and `givemany` item
  additions. Requested quantity and the native result are distinct; a proven
  zero-effect grant is not an injection.
- `engine.debugproc`: privileged debug script execution and direct stat changes.
  This is conservatively flagged **unquantified assistance**, not a fabricated
  item or GP amount. A script can provide indirect or delayed economic benefits.
- `engine.save-fallback`: creation of a new/default save with default hitpoints
  during an observed social world. It cannot silently stand in for a lost save.
- `gateway.treasury-balance`: positive administrative balance adjustments.
- `gateway.treasury-genesis` and `gateway.business-stock-genesis`: credits outside
  their exact active bootstrap permit, including later fixture/bootstrap calls.

The observer covers the local world rather than only direct founder recipients:
help given to an outsider or institution can subsequently reach the founders.
Normal production and verified transfers keep their existing authoritative
domain paths. NPC import/export accounting is a later requirement, not relabeled
as internal self-sufficiency here.

Every instrumented mutation writes an immutable, hash-linked intent **before**
the native action, then appends its resolution. A successful journal commit and
the economic write can live in separate stores; this is a write-ahead protocol,
not a claim of cross-database atomicity. An exception, crash, ambiguous partial
credit or missing resolution remains pending and cannot pass the observed
injection gate. A corrupt chain, missing run, clock conflict or conflicting
operation ID blocks a new marked mutation before it changes native value.

## Legitimate internal payments

Player-action and economic-contract settlement coordinators bind an exact native
treasury reservation to the settlement, payee and amount before engine payment.
The engine consumes that permission. The transfer remains pending until the
treasury's actual committed debit is verified. It then becomes a resolved
`internal-transfer`, not new currency. Recipient credit without a completed
debit cannot produce a clean observation. Recovery reuses the original settlement
and reservation IDs; it cannot manufacture an exemption from a caller-supplied
origin label. Verified player escrow and institution-to-institution transfers
already use their transfer authorities and do not pass through admin mint hooks.

A rejected native payment with a verified return to its exact pre-credit balance
records a compensation proof and releases that attempt's consumed transfer
permission. This permits retry after an inventory-capacity failure using the
same settlement/reservation IDs. The transfer itself remains pending until a
successful native credit and the actual treasury debit are proven. An ambiguous
or uncompensated failure cannot reuse the permission through this path.

## Invalidation and reporting

`config/society-integrity-policy.json` defaults `invalidateOnInjection` to `true`.
The value is frozen with the run binding. With it enabled, a confirmed runtime
injection/privileged assistance irreversibly sets the run's `invalidated` flag.
With it disabled, the same event and contamination flag remain visible; only
automatic invalidation is disabled. Changing the current config cannot reclassify
an existing run or erase its history.

Authenticated, read-only reporting is available at
`GET /api/admin/world-genesis/:resultId/integrity`. It reports:

- `contaminated` when a runtime intervention is confirmed;
- `unverified` when bootstrap, an operation or pre-observer history is incomplete;
- `no-detected-injection` when no such signal exists in the observed history.

`passesObservedInjectionGate` is false for contamination, pending evidence and
reset runs. `eligibleUnderInvalidationPolicy` additionally expresses the optional
experiment invalidation setting; with invalidation disabled, contamination is
still **not** a clean result. Coverage explicitly names the instrumented local
boundaries. This report is not a certificate that every possible external file
edit, custom mod, missing native source or all other Phase 24.1 integrity gates
have been verified. The broader completeness gate and self-sufficiency assessment
must retain their own evidence requirements.

Missing history is `unavailable`, not zero injections. The GET creates no source
or database and requires the same local admin authorization as other economic
domain reads. It uses a read-only SQLite transaction for a consistent snapshot.

## Existing worlds, isolation and recovery

For a previously applied social genesis, the first subsequent native boundary
automatically registers an observer against the persisted applied result/receipt.
It records a permanent `observer-started-after-genesis` coverage gap. Future
injections are marked, but unobserved past operations never become a clean
history. Conflicting legacy applied worlds or clock bindings fail closed.

The engine hooks run in the native engine workspace. Default store hooks target
the canonical treasury/Business/reward paths. Stores at custom/test paths require
an explicit `IntegrityBoundary`; isolated unit tests therefore do not mutate a
live world's integrity journal. The tests use temporary native stores and their
own common clock, without starting a live engine or a bot.

The additive store is `.local/simulation/society-integrity.sqlite`, schema v1.
Creating a new journal migrates v0 to v1 transactionally; future schemas are
rejected. Existing AgentState, saves, treasury and genesis schemas are unchanged.
The journal contains immutable event payloads, hash-linked resolutions, exact run
bindings and consumed permits. Reset archives its state and retains all value,
contamination and coverage-gap evidence. It does not automatically clear an
invalidation or rewrite an ambiguous native settlement.

Rollback removes the new hooks/module/config while preserving a backup of this
journal and the original domain ledgers. No preexisting economic schema needs a
downgrade. Resuming observation after rollback must retain the resulting coverage
gap; deleting the journal cannot make the old experiment clean.

## Verification

The native integration suite passed **72 tests / 0 failures / 0 skips**, followed
by root, engine and webclient TypeScript and formatting validation
(`.local/verification/20261014-230605-310-phase24-2-native-domain-final.log`).

The first full regression exposed a save comparison depending on JSON object
field order (`.local/verification/20261014-230935-943-full.log`). The comparison
now uses canonical validated JSON across the journal boundary. The new regression
accepts unchanged native values with reordered object keys and rejects a one-GP
value mismatch. The final focused genesis/integrity/native-bridge suite passed
**30 tests / 0 failures / 0 skips**, with all three TypeScript checks and format
validation (`.local/verification/20261014-231559-016-phase24-2-canonical-native-final.log`).

An intermediate full run hit the existing estate audit-tampering test's 5000 ms
limit (`.local/verification/20261014-231738-857-full.log`). The exact case passed
alone, and the full estate suite passed **34 / 34** with the original timeout and
assertions (`.local/verification/20261014-232354-309-phase24-2-estate-timeout-recheck.log`,
`.local/verification/20261014-232438-415-phase24-2-estate-suite-recheck.log`). No
test timeout, assertion or skip was changed to accommodate the timing failure.

The complete regression subsequently passed **1656 tests / 0 failures / 0 skips**,
exit 0 (`.local/verification/20261014-232548-842-full.log`, outer runner
`.local/verification/20261014-232547-972-phase24-2-full-confirmed-final.log`).
After the final compensated-payment retry improvement, the affected integrity,
authenticated reporting and native reward suites passed **22 tests / 0 failures /
0 skips**, including the new retry regression, followed by root and engine
TypeScript validation
(`.local/verification/20261014-233155-539-phase24-2-funded-retry-final.log`).
The full run's webclient TypeScript and formatting checks were also green.
These are implementation checks using temporary stores and the actual packed
local cache served read-only; no live society benchmark or engine/bot run was
started.
