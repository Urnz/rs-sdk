# Character attributes

The `character-attributes` domain owns immutable, slowly changing base aptitudes
for persistent player characters. Version 1 uses six axes: `intellect`,
`dexterity`, `vigor`, `endurance`, `perception` and `will`.

An `AttributeProfile` is bound to the character agent and the creation time of its
current lifecycle. It records the exact creation policy, optional seeded genesis
evidence, declared score scale, derived total point count and a canonical SHA-256
digest.

NPC total point budgets use a versioned `bounded-discrete` policy. Every integer
in the configured interval must have one positive weight, the interval must fit
the six-attribute scale, and total weight is bounded. Generation derives an
unbiased weighted ticket with SHA-256 rejection sampling from the world seed,
policy digest, character identity and lifecycle creation time. The raw seed is
not retained; results contain its digest, the exact policy reference and entropy
evidence.

The second deterministic draw selects one of three explicitly weighted allocation
strategies. `generalist` keeps scores within one point where the scale permits;
`specialist` fills a seeded subset of focus attributes before spending elsewhere;
`unoptimized` assigns each point independently without looking ahead to future
skill weights. Every strategy spends the exact generated budget, stays inside the
declared scale and emits allocation evidence plus a complete validated
`AttributeProfile`. This makes balanced, strongly specialized and awkward random
combinations possible without an LLM choosing a build.

Human character creation is a separate world policy. `standard-human-choice`
requires the player to spend an exact fixed budget across all six bounded values;
no seed is accepted or invented. `hardcore-human-lottery` references and reuses
the exact NPC budget and allocation policy versions, while wrapping their
evidence in a human-policy-owned profile. A mode mismatch, partial allocation,
wrong point total, changed policy digest or mismatched lottery reference fails
before a profile is created.

The profile deliberately contains none of the following:

- RuneScape skill levels (personal learned competence);
- verified agent skills (executable procedures);
- facility or organizational capabilities (effective access and infrastructure).

The versioned `CompetenceSnapshot` keeps those three concepts in separate typed
collections and namespaces. Personal RuneScape skills are bounded to levels 1–99.
An agent procedure is present only as an exact-version, checksum-bound, learned
and verified executable skill reference. A provided capability always retains
its facility or organization provider plus the access grant. Type-specific
requirements query only their own collection, so a workshop cannot impersonate
a personal Smithing level and a high skill level cannot invent a learned
procedure.

This is an additive in-memory schema and is not yet persisted, so no data
migration is required. Rollback removes the schema and validator before any
consumer stores it; a future persistent integration must introduce its own
versioned migration and rollback plan.

`SkillPotentialProfile` derives per-skill learning multipliers and personal
potential levels from an immutable attribute profile. Each configured skill has
six non-negative weights totalling exactly 10,000 basis points. An optional,
bounded per-character talent component may adjust both results, while policy
minimums and maximums remain authoritative. The result binds the exact source
profile and policy digests and never changes the underlying aptitudes.

Personal level progression has four separate cap policies. `classic-99` retains
the vanilla level ceiling. `attribute-hard-cap` stops personal progression at the
derived potential; `attribute-soft-cap` keeps level 99 reachable but applies a
bounded learning penalty above that potential. `facility-centered-cap` limits
personal progression to the lower of potential and its configured ceiling, and
names the separately required provided capability. Facility access never raises
or rewrites a personal RuneScape level.

The first bounded progression adapter applies these decisions only to Fishing,
Cooking, Mining and Smithing XP awards. It adjusts XP by the resolved learning
multiplier or returns zero after a hard personal cap. Every other existing skill
uses an explicit vanilla pass-through that does not even require a potential
profile. This keeps the rollout narrow and makes later engine integration use a
single typed, testable boundary rather than duplicating formulas in scripts.

The versioned paired experiment replays the same bounded XP event list for each
participant in a vanilla control arm and a potential-policy treatment arm.
Telemetry retains every input event and exact treatment award, then aggregates
base XP, granted and adjusted XP, hard-cap blocks and soft-cap exposure per arm.
The immutable report binds experiment, workload, participant profile and cap
policy digests, making repeated runs directly comparable and reproducible. It is
an exported report only, not persistent state; rollback therefore removes the
adapter before a future telemetry store introduces its own migration plan.

Those domains may read a profile through a typed adapter later. They must not
rewrite base aptitude values to represent experience, equipment, membership or
temporary effects. A future legitimate change to an aptitude requires a separate,
audited lifecycle event rather than an in-place mutation of the genesis profile.

Validation is fail-closed: all six values are required exactly once, integer
scores must fit the profile's declared scale, versions are semantic, timestamps
are canonical simulation-time UTC values, and only seeded genesis creation may
retain a seed digest.
