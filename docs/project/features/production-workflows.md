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

The first catalog demonstrates that the same model covers both a one-step raw
shrimp to cooked shrimp process and a longer copper ore + tin ore → three bronze
bars → bronze pickaxe chain. The latter compiles to three copper ore, three tin
ore, one pickaxe and nine simulation minutes; its intermediate bronze bars are
not misclassified as externally purchased inputs.

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
