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

Those domains may read a profile through a typed adapter later. They must not
rewrite base aptitude values to represent experience, equipment, membership or
temporary effects. A future legitimate change to an aptitude requires a separate,
audited lifecycle event rather than an in-place mutation of the genesis profile.

Validation is fail-closed: all six values are required exactly once, integer
scores must fit the profile's declared scale, versions are semantic, timestamps
are canonical simulation-time UTC values, and only seeded genesis creation may
retain a seed digest.
