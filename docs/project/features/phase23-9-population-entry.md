# Phase 23.9 – bounded seeded population arrivals

The finite population can receive new persistent player-agents through an explicit
arrival batch. `generatePopulationEntry` separates deterministic generation from
AgentState admission and the local avatar namespace adapter. Its first generator,
`seeded-arrival-v1`, represents arrivals from outside the simulated population.
It does not model family, pregnancy, parentage or reproduction.

## Generation and policy

`config/population-entry-policy.json` binds the exact finite lifecycle policy and
the exact `mature-society` / `historical-burn-in` profile versions and digests.
The shared age policy provides the simulation year scale; its digest is included
in the preview. Changing generation inputs or policy changes the plan digest.
The supplied limits are 8 entrants per batch, 64 active members in the shared
world and 256 admissions over the lifetime of a clock/profile binding. The last
limit counts every committed entrant, across entry policy revisions; death,
membership reset and genesis reset never replenish it. The world profile's own
maximum population remains an additional upper bound.

A request names an existing, unreset genesis member as its world anchor. The
anchor may be deceased: a completely deceased founding cohort can receive new
arrivals. Reset genesis cannot authorize new entry. Active members with a
different genesis or world profile on the same clock block admission.

New batches require a paused shared SimulationClock. Preview uses its persisted
simulation time and does not advance it. The apply transaction checks the clock
again before commit. Identity, membership, generated birth and receipt either all
commit or all roll back. The generator derives independent deterministic
alphanumeric avatar names, agent IDs, personality traits and entry ages from the
seed, batch and policy. It never takes a deceased identity as a template.

Arrivals have a generated known birth time, default age 18–35 simulation years,
and lifecycle origin `imported`. This records an adult arriving in the world;
it is not a birth event or an inference about pre-existing characters. The
receipt preserves the generation provenance. Existing characters keep their
original birth state.

## Persistent admission and replay

AgentState schema v25 adds `agent_population_entry`. Its immutable receipt stores
the canonical request, complete generation plan, exact world/genesis/clock/policy
references, explicit admin reason and audit wall time. Receipt and plan digests
are verified on restart, together with the persisted entrant/birth/source links.
SQL triggers reject receipt updates and deletion. Missing receipts or members
fail closed.

An idempotency key is derived from clock ID, clock profile digest and batch ID.
Reusing that batch with a different seed, count or anchor is a conflict. Exact
replay returns the original receipt, even after the clock resumes, a member dies
or the population resets; it never recreates or reactivates members. Membership
uses the distinct `entry-…` source ID and plan digest, rather than pretending the
arrival was part of the original genesis output. The general membership binder
requires the exact admission receipt for entry sources.

Each entrant gets a fresh player identity/control profile and finite membership,
with zero LLM/operating budgets. Admission grants no episode, semantic fact,
relationship, skill, goal, autonomy enrollment, currency, item, property or
institutional right. Learning and inheritance continue through their existing
explicit mechanisms. The engine's existing finite-avatar binding, age, mortality
and terminal-death paths accept these members unchanged.

Genesis reset atomically marks both founding members and later entrants from
that genesis as historical `reset` memberships. Entry receipts, identities and
births remain. The original asset rollback still concerns its recorded genesis
allocations; it does not erase economic transactions performed later by arrivals.

## Local admin API

Both endpoints use the existing authenticated admin boundary:

- `POST /api/admin/population-entry/preview`
- `POST /api/admin/population-entry/apply`

Preview body:

```json
{
  "reason": "Review the next bounded arrival cohort",
  "request": {
    "batchId": "arrival-wave-1",
    "seed": "local-cohort-1",
    "count": 2,
    "anchorAgentId": "existing-genesis-agent"
  }
}
```

Apply uses the same body plus `expectedPlanDigest` from `result.digest` in the
preview response. It rechecks admission limits and identity reservations inside
the AgentState write transaction. A changed preview is rejected.

The production adapter uses the gateway's actual AgentState path and shared
clock. Before a new admission, it requires the actual local engine health/death
authority v2, local SQLite account registry (`server/engine/db.sqlite`), player
save directory and bot directory. It opens engine/account databases read-only,
rejects existing account/save/bot/online usernames, permanent finite-avatar
bindings and terminal history, and never constructs empty replacement sources.
The generic store API accepts an explicit avatar-availability port; alternative
adapters must enforce their own authoritative namespace checks.

An arrival is a persistent population actor with a reserved player-avatar link.
This API does not provision credentials, create a save, start an engine NPC,
connect a bot or run an autonomous skill. Physical activation uses the existing
local avatar registration/login path as a separate operation. The response marks
this with `activation: "separate-local-avatar-login"`. Ambient visual NPCs are
not promoted into economic actors by their visual type. Admission has no timer,
automatic refill loop or live world side effect.

## Migration and rollback

The v24→v25 migration is additive: create the empty receipt table and immutability
triggers, then advance `user_version`. It creates no arrivals or fictional
historical membership. Earlier v21/v22/v23 migration fixtures explicitly omit
the future entry schema, so the old paths remain exercised.

For operational rollback, stop new admission and retain v25 history. Reset the
source genesis to close its members, including arrivals; do not delete receipt
rows or reuse usernames. Old v24 binaries reject v25 databases. A binary/database
downgrade requires a coordinated, verified pre-admission snapshot of AgentState,
the clock and engine authorities, with relevant economic stores, while stopped.
Do not lower the version marker or remove entry history from an active world.

## Verification

Focused tests cover deterministic read-only generation, birth/age/control links,
fresh memory and zero budgets, restart, immutable history, exact replay after
reset and terminal death, changed request/preview conflicts, all three limits,
policy drift, existing identity and local avatar/account collisions, unavailable
authorities, transaction failure on a later entrant, a concurrent clock resume,
v24 migration and genesis reset of later arrivals. All fixtures are isolated;
no live population is admitted and no bot is started for verification.

Final full `bun run verify:full`: **1592 pass / 0 fail / 0 skip**, exit 0,
including all 18 new entry tests, format and root/engine/webclient typechecks.
Evidence: `.local/verification/20261014-185931-585-full.log`, with the native
read-only cache runner recorded in
`.local/verification/20261014-185930-731-phase23-9-full-final.log`. The runner
serves the existing packed cache only for the test child and closes afterward;
it imports no live World runtime and advances no production simulation clock.
