# Character attributes

The `character-attributes` domain owns immutable, slowly changing base aptitudes
for persistent player characters. Version 1 uses six axes: `intellect`,
`dexterity`, `vigor`, `endurance`, `perception` and `will`.

An `AttributeProfile` is bound to the character agent and the creation time of its
current lifecycle. It records the exact creation policy, optional seeded genesis
evidence, declared score scale, derived total point count and a canonical SHA-256
digest. Generated scores are not implemented by this slice; the next phase 17
slice will own the bounded seeded distribution policy.

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
