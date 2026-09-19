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

Need changes use elapsed `SimulationClock` time only. A versioned dynamics policy
provides separate hourly rates for online/offline and awake/sleeping states. The
calculation carries fractional results with a fixed integer denominator, so many
small observations produce the same result as one large observation without
floating-point or wall-clock drift. Values are clamped to their declared bounds.
The transition records the previous state digest, exact elapsed simulation time,
selected rates and resulting state digest for deterministic replay and audit.

Critical self-maintenance is a deterministic high-level decision boundary, not
an LLM prompt. Hunger takes precedence over fatigue when both are critical. The
routine selects the strongest available inventory food, or the accessible sleep
place with the best recovery and safety tie-breaker. Inputs are bounded, exact
and digest-bound; unavailable resources produce a typed blocked decision instead
of inventing an action or automatically calling a model. Execution remains behind
the typed `consume-food` and `seek-sleep-place` action intents.

This remains an additive in-memory model and creates no persistent store, so no
migration is required. Rollback removes the module and both policies before any
consumer persists a state. Future persistence must introduce an explicit schema
migration and rollback.
