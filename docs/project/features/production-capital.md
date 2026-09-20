# Wearing production capital

The `production-capital` domain models a machine as a real item instance that is
installed as a facility component. It can affect throughput, output quality,
failure probability, capacity and provided production capabilities, but only
while the exact item is usable, owned by the expected actor and backed by a
trusted active installation receipt.

Effects scale with the item instance's quality. The first configured workshop
bellows provides `smithing.enhanced-airflow`; at full quality it gives a 12,500
basis-point throughput multiplier, 500 quality basis points, 1,000 basis points
of failure reduction and one capacity unit. These values change actual workflow
duration and production bounds. The projection intentionally has no GP value or
gameplay price field.

Each verified production batch consumes configured uses through the existing
audited `ItemLifecycleStore`. The bellows has finite durability, stops providing
utility when broken and points to the evidence-gated
`workshop-bellows-repair` policy. That repair consumes a bronze bar, takes 15
simulation minutes, requires Smithing level 5 and the
`smithing.basic-forging` facility capability. Exact use receipts are replay-safe
and cannot consume durability twice.

## Migration and rollback

This slice extends source-controlled catalogs with a new lifecycle type, repair
policy and capital definition. The persistent lifecycle schema is unchanged;
new capital instances use the existing additive item and audit tables. Rollback
must first stop new production using the capital type. Existing instances and
their use/repair history remain readable for audit; never delete their rows or
restore durability independently. A failed physical production settlement must
be corrected forward rather than by removing the matching wear receipt.
