# Versioned production recipes and workflows

The `production-workflow` domain defines strict, data-driven and immutable
recipe versions. A recipe declares exact item inputs and outputs, simulation
time, one typed execution skill, personal skill levels, facility capabilities,
tools, knowledge or licences, and access entitlements. Configuration cannot
embed commands or arbitrary executable fields.

`ProductionWorkflow` composes exact recipe versions as a bounded dependency
graph. The deterministic compiler orders the graph, scales batches and derives
external inputs, final outputs and total duration. Only declared ancestor steps
may supply an intermediate, so unrelated parallel branches cannot silently
share material. Unknown versions, duplicate identities, dangling dependencies
and cycles fail closed.

The first catalog demonstrates that the same model covers a one-step raw shrimp
to cooked shrimp process, a copper ore + tin ore → bronze pickaxe chain, and a
longer production prototype. The prototype smelts six bronze bars, forges one
bronze pickaxe, then combines the remaining bars with leather into the existing
workshop-bellows capital asset. It compiles to six copper ore, six tin ore and
two leather as external inputs, one pickaxe and one bellows as final outputs,
and 23 simulation minutes. Intermediate bars are never misclassified as
externally purchased inputs.

The prototype intentionally reuses the vanilla personal `Smithing` and
`Crafting` skills. It introduces no `Engineering` or `Machining` personal skill:
the specialist distinction remains in a verified procedure, the facility
capability and the typed execution skill. Producing the bellows is not the same
as installing it; activation and mechanical benefit still require the separate
capital installation boundary.

This slice is configuration and planning only. It creates no inventory, work in
progress, entitlement or settlement rows. Later execution must reserve Business
inputs atomically, verify facilities and workers from trusted domain state, and
commit physical outputs only from exact verified skill evidence.

## Migration and rollback

There is no persistent schema migration. Adding a new version is additive;
published recipe or workflow versions must not be edited in place. Rollback
removes a newly added unused catalog version and its references. Once runtime
work-in-progress refers to a version, retain it for audit and disable new starts
instead of deleting or rewriting it.
