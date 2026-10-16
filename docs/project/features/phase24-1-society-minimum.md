# Phase 24.1 – measurable minimum for a self-sustaining society

The first minimum means **recurrent basic needs and productive capacity maintained
inside one finite local society for a predeclared observation period after
bootstrap**. It is a bounded claim about one run, cohort and contract. It is not
an assertion of indefinite survival, universal optimality or a complete measure
of a good society.

`config/society-minimum-policy.json` defines `private-society-minimum@1.0.0`.
`society-minimum` validates it, resolves its configured dependencies and produces
a digested measurement contract with **17 quantitative requirements and eight
mandatory integrity gates**. This is a definition artifact: its status is always
`unmeasured`, and it has no run verdict. It reads configuration only, opens no
world/database, creates no events and authorizes no action.

## Observation boundary

The baseline uses at least **24 simulation hours of warmup after applied genesis**,
followed by **seven complete, consecutive simulation days**. Each evaluation
bucket is 24 simulation hours. Observation traces have a maximum gap of one
simulation hour; a sparse sample is not proof of everything between samples.
Wall-clock time and engine tick counts are not substitutes for this duration.
The actual common SimulationClock binding must be recorded with the run.

The founder roster is frozen before warmup, with at least **four distinct finite
player-agents**. It includes offline actors. The minimum living founder count is
four at every observation boundary, and at least **90% of the original founders**
must remain alive at the end. Survival uses the original denominator; replacement,
reset, respawn or excluding an unsuccessful actor cannot improve it. The first
baseline admits no new members during the observed period. Demographic admission
experiments require a separately declared contract rather than silently changing
this cohort.

Actor exposure runs from the evaluation start to authoritative terminal death or
the evaluation end. Offline time still incurs the exact configured needs rates;
offline does not mean asleep. Death stops future personal demand, but still counts
against the founder survival gates. Unknown membership, death or need intervals
are unavailable evidence, not zero demand.

Events belong to **(bucket start,bucket end]** and exposure intervals to
**[bucket start,bucket end)**. Shared boundaries are counted once. Opening and
closing stocks are exact boundary observations, separate from event flows. A
longer observation may contain additional full buckets; it cannot select the
best seven scattered days or discard a failing bucket afterward.

## Quantitative minimum

All applicable requirements must hold; one surplus cannot compensate for another
missing necessity.

- **Food and physiological maintenance:** hunger and fatigue stay strictly below
  their pinned critical thresholds for at least **95% of every member's exposure
  in every daily bucket**. Neither need may remain continuously critical for
  more than **six simulation hours**. The current needs policy uses an 8000/10000
  critical burden. Rates remain positive for hunger and awake fatigue, with
  genuine negative fatigue recovery while sleeping. Disabling need growth does
  not demonstrate maintenance.
- **Internal food supply:** **100% of effective hunger relief** in each bucket
  must come from verified internal gather → process → consume lineage. Effective
  relief is the actual before/after hunger reduction, not nominal relief wasted
  by clamping at zero. Every observation boundary has at least **24 simulation
  hours of usable cooked-food reserve**, using a conservative forecast from the
  pinned dynamics and living population. Closing usable food stock is at least
  opening stock, compared per required chain in equivalent relief capacity.
  Raw food, spoiled food, inaccessible items and unrelated production are not
  cooked-food reserve. Empty stock/demand cannot form a successful ratio.
- **Sleep and housing:** legal, capacity-backed access to at least
  `temporary-shelter` is available for at least **95% of each member's exposure
  in every bucket**. This measures available accommodation, not standing inside
  a room all day. Rest intervals separately require verified presence/access and
  the pinned housing recovery effect. A lease, Property label or comfort rating
  alone is not proof of sleeping or fatigue recovery. A shared bed cannot supply
  several simultaneous reserved places without verified capacity.
- **Tools and maintenance:** every required tool type demonstrates at least
  **one verified use/wear → repair-or-replacement → usable-service cycle** in the
  evaluation window. Each maintenance input and successor must have internal
  provenance. Outstanding unusable demand may last at most **one simulation
  hour**. Closing usable service capacity is at least opening capacity, measured
  per required type from durability and mechanical output capability rather than
  GP or item count alone. A free durability reset or shop-bought successor cannot
  close the internal loop. No wear/demand opportunity means the maintenance claim
  is not demonstrated.
- **Division of labor:** every bucket has at least **two distinct active
  producers** with verified productive events and at least **one inter-actor
  producer-to-distinct-consumer chain ending in real final use**. Across the
  window, food gathering, food processing and tool maintenance must all occur.
  A configured profession, known skill, job offer, invoice, chat agreement,
  circular trade or moved inventory without final use is insufficient. Business
  activity is attributed to its executing agents; several institutions controlled
  by one idle actor do not become several producers.

The baseline binds the currently configured `lobster` chain and
`bronze-pickaxe-mining` cycle. These are first supported categories, not hardcoded
profession classes. Configured lists can add real supported chains/types in a
later version, with every required category measured independently. A profitable
food surplus cannot replace missing tool maintenance or a homeless member.

## Bootstrap, replenishment and value origin

Applied genesis may provide declared starting money, tools, food, housing and
institutions. Those are separately recorded initial endowments. Opening food and
tool service capacity are retained floors; a long-lived stockpile running down
cannot qualify as recurrent sufficiency.

Internally produced warmup lots may supply evaluation consumption if their full
post-genesis native lineage is verified. Seeded raw/cooked inventory remains
genesis origin even after repackaging or trading. Actual new gathering, processing,
use and maintenance must also occur in the required evaluation scopes. Legitimate
initial tools and housing may serve as productive capital; the claim concerns
recurring needs and capacity upkeep, not building every initial asset from zero.

Natural extraction through configured Fishing/Farming/Mining mechanics is an
internal production input. Its exact world rules, actor actions and native gains
must be pinned. An infinite NPC shop, unbounded NPC money source, externally
supplied item, admin grant or fallback replenishment is not such a production
event. Internal barter, wages, contract settlement, rent, tax and inheritance can
redistribute existing value through verified ledgers; they do not count as
new production or new money. Admin approval of a legitimate transfer is distinct
from an admin command creating value or providing unaccounted maintenance.

The integrity observation starts at **genesis application**, including warmup,
and ends at the evaluation end. An injection during warmup cannot be hidden by
starting the performance window later. Post-genesis admin/fallback item or money
creation, free need/health/skill recovery and unaccounted assistance contaminate
the closed baseline. The observer and its supported native boundaries are
documented in [Phase 24.2](phase24-2-society-integrity.md). This definition does
not manufacture measurements or source coverage from an empty event list.

External trade may be a valid separately configured experiment later, with bounded
counterparties and explicit import/export measurements. It receives a distinct
dependency-supported claim. It cannot receive this closed-economy minimum label
by silently allowing imported food, tools or NPC-shop proceeds.

## Required evidence and decision protocol

A qualifying result requires all eight gates: applied and reconciled genesis
baseline; complete source coverage; unchanged clock/world policy; finite lifecycle
without respawn; no post-genesis admin/fallback value; no external-shop/import
value; frozen founder roster; and verified internal lineage ending in final use.

Required evidence comes from these sources, with exact event IDs, digests, actor
bindings, clock bindings and covered intervals:

- Population membership and authoritative engine death events establish the fixed
  roster and exposure. Phase 23.10 current demographic aggregates help inspection
  but cannot reconstruct every historical need/skill interval by themselves.
- Needs dynamics transitions, actual food removal and before/after burden states
  establish demand and effective hunger relief. Food-consumption closures provide
  valuable causality, but production totals alone prove neither consumption nor
  a current reserve. Native inventory/needs snapshots must close the boundary.
- Housing rights/tenancy/Property access and verified rest/location traces establish
  accommodation capacity and recovery. Existing tier/effect configuration provides
  policy semantics, not complete occupancy history.
- Item-lifecycle use, wear, breakage, repair/replacement authorization and native
  acquisition/input-consumption receipts establish productive service. A replacement
  acquisition receipt alone does not prove local production of that replacement.
- Native production, transfer and final-use lineage establishes division of labor;
  offered work or wall-time-only contract totals cannot replace simulation-bound
  causal events.
- Genesis allocations, native value changes, admin/fallback operations, external
  exchange and source watermarks establish experiment integrity. Unobserved paths
  cannot be certified clean by the absence of telemetry rows.

The run manifest must freeze the exact contract digest, genesis result ID/digest
and applied simulation time, clock ID/profile digest, world build/active mods,
founder roster, attribute distribution, seed, evaluation endpoints and source
watermarks/coverage. Dependency changes with an unchanged version string still
change the resolved contract digest and invalidate an old binding. Policy changes
require a new version and are declared before the run, not chosen after its result.

Future assessment has three outcomes:

- **PASS / minimum met:** all integrity gates and all 17 requirements are proven
  throughout their required scopes, including every consecutive daily bucket.
- **FAIL / violation proven:** a measured threshold or integrity condition is
  violated. A proven violation is not hidden by unknown evidence elsewhere.
- **INCONCLUSIVE / not demonstrated:** required evidence, temporal coverage,
  lineage or supported source capability is missing; demand/opportunity is zero;
  or the required duration has not elapsed. It is never relabeled as PASS.

Ratios keep their declared denominator and use exact integer comparisons
(`10000 × numerator >= threshold × denominator` for a minimum). Rounding a
near-miss upward is forbidden. Report the per-member/per-bucket/per-type failures
and their event lineage; no blended score turns a failing necessity into success.

## Implementation boundary and rollback

Phase 24.1 provides the formal definition, validated configuration, dependency
snapshot and binding/requirement APIs. It introduces **no measurements, collector,
runtime verdict endpoint, economic mutation, persistent schema or benchmark run**.
The resulting artifact is explicitly `unmeasured`. Its tests exercise contract
validation and pinning, not a population sustaining itself.

24.2 implements injection detection and clean-run invalidation; 24.3 builds actual
self-sufficiency measurements and source adapters; 24.4 import/export and later
tasks add dependencies, long experiments and a reproducible benchmark. Unsupported
native housing/need history or tool-origin proof remains INCONCLUSIVE until those
bridges exist. Removing the module/policy rolls back the definition without
touching any clock, population, asset, save or audit ledger. Future runs retain
their exact contract snapshot rather than rereading a changed current policy.

## Verification

The focused contract suite passed **13 tests / 0 failures / 0 skips**, with root
TypeScript validation (`.local/verification/20261014-221342-415-phase24-1-initial-contract.log`).
The affected society/needs/loop-metrics/food/housing/item-lifecycle/population/
genesis integration suite passed **182 tests / 0 failures / 0 skips**, followed
by root, engine and webclient TypeScript and formatting checks
(`.local/verification/20261014-222814-077-phase24-1-domain-quality.log`).
The complete `bun run verify:full` / `bun run check` regression passed with
**1636 tests / 0 failures / 0 skips**, exit code 0
(`.local/verification/20261014-223046-883-full.log`, outer runner
`.local/verification/20261014-223045-950-phase24-1-full-final.log`). The runner
serves the actual packed local cache read-only to the tests; it does not start
the live engine or a bot.
These checks validate the definition and its dependency bindings; they are not
evidence of an observed society meeting the minimum.
