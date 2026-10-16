# Phase 24.7 – controlled long experiment programs

`society-experiments` runs a finite sequence of actual Phase 12 multi-agent
cohort experiments against the local/private gateway. It adds durable claims,
warmup/evaluation windows, native input bindings, observation coverage and restart
handling. Every wave still uses the existing coordinator, event gate, budgets,
skill dispatch, terminal journals and Phase 12 persistence. It does not drive
ticks, synthesize agent work or create a separate simulated economy.

This phase provides the executable protocol. Automated verification uses
isolated native databases and an advanced fixture clock, not a completed live
society benchmark. Treatment comparisons and the later full benchmark/export/
restore acceptance remain separate tasks.

## Controlled inputs and preflight

A prepared plan pins these native inputs:

- Exact applied genesis result ID/digest, configuration, output, seed, declared
  world build and finite world profile/lifecycle policy.
- Exact founder agent/avatar roster, immutable lifecycle creation times and
  native player control settings, including decision and budget limits.
- Seeded attribute budget/allocation policies and each founder's generated
  six-attribute input profile, with a distribution digest.
- Every root `config/*.json` file's content digest; all active world mods are
  separately read from the engine through the Phase 12 environment gate.
- Exact immutable Phase 12 parameter profile and its native digest.
- Initial Phase 12 avatar/bank/skill and goal snapshot digest, checked again
  immediately before the first wave is persisted or dispatched.
- Actual source path binding, so resumption cannot silently switch databases.

`prepare` returns a plan containing `expectedConditionDigest` and
`expectedInitialStateDigest`. `start` verifies those values; it does not refresh
them to accept a changed baseline. For a repeat, retain the same expected hashes,
restore the same native baseline, and choose a new session ID. Native founder
membership reset, identity/control change, policy change, profile corruption or
active-engine drift prevents further dispatch. Age and natural goal/skill
progress are outcomes, not reasons to reinitialize the founders between waves.

The Phase 24.2 society integrity journal must be present, bound to that genesis
and in observing state. Native contamination/reset/corruption fails the program.
A temporarily unresolved cross-store integrity operation withholds dispatch and
is recorded in observation checkpoints while finite deadlines remain in force.
This reuses the instrumented boundary coverage; it does not establish complete
world history.

Important existing capability boundaries are explicit in every report:

- Attribute profiles are **declared, reproducible experiment inputs**. Phase 12
  does not attest that the engine applies them to every skill/XP decision. The
  program never retroactively labels them as applied engine history.
- The experiment seed controls genesis inputs and Phase 12 selection. It does
  not seed the entire engine random stream or guarantee identical outcomes.
- The initial avatar/goal fingerprint and genesis binding are not a full world,
  NPC, inventory and Business-state backup. Full baseline restoration is an
  operator prerequisite; genesis reset alone is not a whole-world rollback.

Missing native sources are rejected without creating clocks, memberships or
past evidence. Configuration snapshots are conservative: even an added root
configuration file changes the condition digest. Source/engine observations are
separate consistent snapshots, not one globally atomic world freeze.

## Finite schedule and evidence

A plan requires at least one simulation day of evaluation, optionally preceded
by up to 30 simulation days of warmup. Evaluation buckets are whole durations
between one hour and one day and divide the evaluation span. Cadence is between
one minute and one hour, with buckets at least twice as long as cadence. The
observation gap bound is at most one simulation hour and no smaller than cadence.
There can be at most 10,000 scheduled cohort opportunities and 200,000 journal
events. Wave and whole-program wall deadlines are mandatory and finite.

The recommended initial protocol matches the 24.1 measurement horizon: one
simulation day of warmup plus seven simulation days of evaluation, daily buckets,
30-minute earliest dispatch cadence and a one-hour maximum observation gap.
This is an execution protocol, not automatic satisfaction of the 24.1 contract.

Only one wave is active within a program. The next wave is eligible after the
cadence interval and after its predecessor settles; delayed work is not replayed
in a catch-up burst. A native paused clock starts no new work and does not advance
the simulation schedule, while the wall deadline still applies. Normal engine
and agent execution continue through existing Phase 12 boundaries.

A wave qualifies only with native `completed` Phase 12 state, all original
founders, exact profile/environment binding, and distinct successful terminal
skill journals for every participant. Native failures, gate-only outcomes,
missing journals or reused terminal run IDs cannot supply successful work.

Simulation timestamps describe **observation envelopes**: an immutable native
clock claim precedes dispatch, and another clock observation follows reading
the terminal native receipt. The wave's wall start/finish must fit that envelope.
No terminal wall timestamp is relabeled as an exact simulation event timestamp.
A bucket is covered only by a whole successful cohort wave whose claim and
terminal observation both fit inside it. Warmup waves remain visible but never
count as evaluation work. Each evaluation bucket needs such a wave before the
execution program can complete. Sparse wave observations are not continuous
economic or person-time coverage.

Clock jumps beyond the maximum gap fail explicitly. Merely waiting for the end,
writing heartbeat observations or completing a wave across a bucket boundary
cannot create the missing contained evidence. Native clock stamps and settled
Phase 12 records are checked again when reading the report. Missing backing
invalidates the report rather than preserving a favorable historical status.

## Persistence, interruption and concurrency

The new dedicated `.local/admin/long-experiments.sqlite` has schema 1:

- `long_experiment_run`: immutable full definition/digest and independent tail.
- `long_experiment_event`: ordered append-only events with a hash chain.
- `long_experiment_lock`: one active program per world clock in that journal.

Reads use one SQLite snapshot. Claims and head/lock updates are atomic with
sequence compare-and-set; future versions, missing tails and stale writers fail
closed. New Phase 12 cohorts also reject agents already in a running cohort.
There is no lease expiry that silently starts a competing program.

Each wave has a deterministic UUID derived from the session, plan digest and
wave index. The claim is committed **before** sending the Phase 12 request.
Phase 12 explicit-ID replay verifies the exact definition, parameter/environment
digests and initial baseline when supplied, and returns the existing native
record without redispatch. An unknown HTTP outcome therefore retains its claim.
On resumption, the controller reads the existing native row, or retries the same
ID if no native row exists. A native `pending` dispatch left by a process crash
is not automatically resubmitted under a new identity: it eventually hits the
wave deadline and needs operator inspection.

Every stamped program event binds the full immutable definition digest to the
existing shared SimulationClock under `society-long-run`. The clock is a separate
database: a later journal rollback can leave an orphan stamp. It proves no work
without its committed local event and Phase 12 backing. A conflicting orphan is
not deleted or rewritten to permit another history under the same sequence.

`stop` requires an explicit reason and prevents new waves. It retains an active
wave's identity and does **not** kill already dispatched skills. A failed or
stopped program must be inspected alongside its Phase 12 jobs before another
experiment is started. The Phase 12 running-cohort gate still applies.

## Local commands

Save an ignored JSON plan, filling actual genesis/profile identifiers and their
digests. The two expected hashes can initially be 64 zeros for preparation only:

```json
{
  "schemaVersion": 1,
  "sessionId": "society-repeat-001",
  "label": "Fixed baseline eight-day program",
  "summary": "One warmup day and seven evaluation days with unchanged inputs.",
  "genesisResultId": "genesis-replace-with-actual-id",
  "genesisResultDigest": "<actual-64-hex-digest>",
  "parameterProfileId": "<actual-profile-id>",
  "parameterProfileVersion": "1.0.0",
  "parameterProfileDigest": "<actual-64-hex-digest>",
  "attributeBudgetPolicyId": "default-npc-attributes",
  "attributeAllocationPolicyId": "default-npc-allocation",
  "expectedConditionDigest": "<64-zeros-before-prepare>",
  "expectedInitialStateDigest": "<64-zeros-before-prepare>",
  "warmupSimulationMilliseconds": 86400000,
  "evaluationSimulationMilliseconds": 604800000,
  "bucketSimulationMilliseconds": 86400000,
  "cadenceSimulationMilliseconds": 1800000,
  "maximumGapSimulationMilliseconds": 3600000,
  "maximumWaveWallMilliseconds": 3600000,
  "maximumWallMilliseconds": 1209600000
}
```

Run from the repository root; substitute real values before preparation:

```powershell
bun run society:experiment --command prepare --plan .local/long-plan.json > .local/long-prepared.json
bun run society:experiment --command start --plan .local/long-prepared.json --run
bun run society:experiment --command step --id society-repeat-001 --run
bun run society:experiment --command report --id society-repeat-001
bun run society:experiment --command stop --id society-repeat-001 --reason "Operator stopped the program"
```

`prepare` dispatches no skills and creates no program. It requires the existing
local gateway for fresh Phase 12 preflight. `start` and `step` without `--run`
perform one bounded state transition. `--run` loops until terminal, using a
1–60-second poll (`--poll-ms`, default 30 seconds), with compact stderr progress
and final JSON on stdout. It does not start the engine, gateway or bots. Polling
must be frequent enough for the actual native simulation rate and gap bound;
the runner never changes the rate to make a program finish sooner. Existing
budgets and gate policies may stop a plan that asks for infeasible activity.

The client accepts only the local/private HTTP gateway and rejects redirects;
`ADMIN_TOKEN`, when set, is sent as an admin header and never included in the
plan, journal or output. Missing reports return `unavailable` and create no file.

The authenticated read-only endpoint is
`GET /api/admin/society/long-experiments/:sessionId`. HTTP cannot select source
paths or submit evidence. Phase 12 adds authenticated `POST .../preflight`,
`GET .../environment` and `GET .../:experimentId` under
`/api/admin/multi-agent-experiments`. The original start endpoint remains
compatible; explicit idempotent starts additionally require exact expected
environment and parameter-profile digests.

## Interpretation and rollback

Reports retain the entire definition, source conditions, attribute inputs,
baseline fingerprint, native clock observations, wave receipts/digests,
terminal skill IDs, bucket coverage, errors and hash-chain tail. `completed`
means this bounded execution protocol was satisfied. `economicAssessment` is
`unassessed`, `completeEconomyCoverage` and `provesSelfSufficiency` are false.
It does not replace 24.1 qualification or certify that any society survived,
fed itself or maintained its tools for the required duration.

Migration creates only the new dedicated schema; no old Phase 12 run is imported
as a long experiment, and existing source/AgentState/clock schema versions are
unchanged. Phase 12 gets explicit replay guards, overlap admission and a strict
read-only reader without new persistent columns. The clock domain is additive.

Before an actual rollout, retain consistent matched backups of the long journal,
clock, Phase 12 records, AgentState, genesis/integrity and relevant engine/world
state. Code rollback may leave the new journal and stamp rows intact. Do not drop
tails, remove clock markers or invent terminal rows to repair a failed program.
Restore matched backups when reverting history; perform world/avatar recovery
through the existing explicit operator procedures. Stopping a runner alone is
not a rollback of its already executed game actions.

No live engine/bot was started, no live program or long benchmark was run, no
live database was migrated, and no `.canvas.tsx` was produced during development.

## Verification

The 28 native controller cases cover a complete fixture day with 24 contained
hourly waves and 96 native terminal skills, first-wave baseline guards, profile/
policy/population/engine drift, observation gaps, missing terminal evidence,
native backing tampering, tail corruption, future schemas, competing programs,
Phase 12 replay/overlap, interruptions before and after POST, finite deadlines,
paused clocks, warmup exclusion, integrity holds, atomic journal rollback,
concurrent clock observation, production runtime reads and exact terminal
avatar/time binding. Two new admin cases
check authentication and fixed source paths.

The final affected controller/admin/Phase 12 suite passed **33/33**, with
root/engine/webclient TypeScript checks and format PASS:
`.local/verification/20261015-185900-625-phase24-7-pre-full.log`.
The read-only CLI smoke returned `unavailable` without creating a journal:
`.local/verification/20261015-185324-967-phase24-7-cli-smoke.log`.

Full `bun run verify:full` / `bun run check` passed **1772 tests, 0 failures,
0 skips**, exit 0, including the final terminal avatar/time cases:
`.local/verification/20261015-190034-990-full.log`; outer wrapper:
`.local/verification/20261015-190034-194-phase24-7-full-final.log`.
The one-day fixture completed in 2.22 seconds in that full run. A prior targeted
run overlapping the full suite hit its unchanged five-second test timeout; the
fixture was narrowed to its actual configuration dependencies without dropping
any of the 24 buckets, 96 terminals or assertions. No timeout was increased.

Final sequential controller/admin verification passed **30/30**, with all three
TypeScript checks and format PASS:
`.local/verification/20261015-190644-335-phase24-7-final-quality.log`.
