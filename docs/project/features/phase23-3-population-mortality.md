# Phase 23.3 – seeded, bounded natural mortality

`AgentStateStore.getPopulationMortality` projects an individual natural
lifespan, mortality susceptibility and a deterministic future mortality
candidate from the existing finite population membership and shared clock.
`evaluatePopulationMortality` is the pure domain entry point. This slice
produces a proposal for the future death authority; it does not create a death
event, change lifecycle status, disconnect an avatar or settle an estate.
Health/treatment remains 23.4 and authoritative death/physical-action closure
remains 23.5.

## Policy, entropy and bounded schedule

`config/population-mortality-policy.json` is versioned independently and pins
the exact id/version/digest of the 23.2 age policy. The age policy in turn pins
the finite lifecycle policy. None of those existing digests or world-profile
bindings are changed. Policy definitions are strictly validated and reconstructed
in a stable JSON order before hashing; reordered JSON keys preserve the digest.
A changed configuration must use a new version. Consumers must compare all
returned policy references before comparing or consuming projections.

Algorithm `sha256-annual-hazard-v1` derives entropy from the mortality-policy
digest, immutable genesis result digest, agent id and lifecycle creation time.
The genesis result digest already covers the world seed and configuration;
its audit generation time is excluded. It therefore provides a durable seeded
source without copying the raw seed into AgentState. Wall time, observation
count, row revision, enumeration order and global RNG never enter entropy.
Named, independent SHA-256 draws use bounded rejection sampling to avoid modulo
bias. Exact replay and reopening both databases preserve the traits and
candidate under the same bound policy.

Default individual reference lifespan is sampled inclusively between 60 and
100 simulation years, with millisecond resolution. Susceptibility is sampled
inclusively between 7,500 and 12,500 basis points (10,000 = 1×). These reference
lifespans are propensity parameters, not guaranteed survival ages.

Natural lifespan is computed by at most 256 annual checks (80 with the default
40–120 year bounds). Before the configured minimum natural age, annual risk is
zero. Each whole-age-year interval selects a half-open hazard band by its ratio
to the individual's reference lifespan. The band's annual probability is
scaled by susceptibility and clamped to 0–10,000 basis points. Each interval
uses its own seeded Bernoulli draw; the first successful interval chooses a
seeded millisecond within that interval. A skipped observation never skips a
draw or resamples a successful candidate.

The final interval forces a successful draw and still samples the intra-year
time independently for every member. Thus the natural lifespan is bounded to
`[minimumYears, maximumYears)` without a common fixed death age, even for an
otherwise zero-hazard configuration. These bounds and probabilities describe
the local simulation's natural-aging model. They do not model injury, disease,
combat or treatment, nor incorporate future health modifiers yet.

Natural/reference age ranges require distinct integer endpoints and must fit
within 0–256 years; reference ages are positive and contained in the natural
range. Susceptibility is bounded to 1–40,000 basis points. Hazard boundaries
must begin at zero and increase strictly; annual probabilities must be
nondecreasing and bounded to 0–10,000. At most 32 hazard bands are allowed.
The year duration comes solely from the exact age policy. Unsafe millisecond
arithmetic or unrepresentable candidate timestamps fail closed.

## Observation and integration contract

Every projection returns its age/mortality policy references, entropy digest,
bounded traits and observed simulation time. Known active members receive an
annual risk and a stable candidate id/time with a `due` flag. The flag becomes
true at the exact individual lifespan boundary and remains true after a delayed
read. Candidate time is no earlier than membership entry: an imported elderly
member already beyond its sampled lifespan is due on entry, without a fabricated
pre-membership death. A candidate is a proposal, not an authenticated death
event or permission to execute an avatar action.

Missing birth remains `unknown`: traits can be derived from membership, but no
age, risk or candidate is invented. Explicit birth registration later preserves
those same traits. Reset and deceased histories retain traits while returning
`inactive`, no current risk and no candidate. Missing/reconfigured clocks,
stale age/mortality policy references, mismatched lifecycle identity and invalid
entropy source fail closed.

The admin agent service returns `populationMortality` beside `populationAge`.
The existing agents/autonomy routes already pass the actual AgentState path
and common clock. A missing clock exposes null mortality data and a
`population-mortality` decision-context blocker. Custom age-policy integrations
must also supply a mortality policy bound to that exact custom digest. No UI
redesign, timer or mortality worker is introduced.

## Persistence, upgrade and rollback

AgentState remains schema v22. There is no new persisted model or migration:
all stochastic outcomes are reproducible projections of immutable existing
membership fields and versioned source configuration. Upgrading does not
populate birth times, infer historical deaths, consume a candidate or alter
membership/lifecycle revisions. Optional observation advances only the existing
shared clock; pause stops aging and candidate progression.

Application rollback removes the mortality projection and source policy; it
does not require a schema downgrade or data rewrite. Preserve the bound
configuration version/digest when reproducing an experiment. A future
authoritative death writer must record the consumed policy/candidate evidence
atomically and prevent repeated transitions; that persistence belongs to 23.5.
For physical rollback of existing AgentState/clock writes, stop writers and
restore complete database backups with their WAL/SHM sidecars, as documented
in 23.1/23.2. Never edit birth or genesis references to obtain another draw.

## Verification

The mortality domain suite checks exact policy binding, JSON digest stability,
500 bounded and diverse members, real genesis seed vs. audit time, exact due
boundaries, monotone bounded annual risk, individual timing at the hard cap,
old imports, missing birth, inactive history and invalid/stale configuration.
The AgentState suite checks reopening both databases, exact membership replay,
birth registration, paused clocks, direct vs. incremental catch-up, reset,
missing/reconfigured clocks, unchanged lifecycle status/revisions and admin
backend parity. Existing age, policy and genesis suites remain in the focused
integration package.
