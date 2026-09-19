# Character needs

The `needs` domain owns character-level physiological burdens independently of
RuneScape skill levels, agent procedures and the engine tick. Version 1 requires
`hunger` and `fatigue`; further definitions such as thirst or stress can be
added through a new policy version without changing the state shape.

Need values are integer burdens: zero is fully satisfied and larger values are
worse. Every definition declares an upper bound, initial value and critical
threshold. A `NeedsState` is bound to one character, one `SimulationClock`, the
exact policy digest and a canonical simulation-time observation. It must contain
every configured need exactly once and rejects unknown, duplicate or out-of-range
values.

This first slice is an additive in-memory model and creates no persistent store,
so no migration is required. Rollback removes the module and policy before any
consumer persists a state. The next slice will add clock-based transitions;
future persistence must introduce an explicit schema migration and rollback.
