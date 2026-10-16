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

`measureProductionCapitalValue` is a read-only telemetry boundary. It compares
trusted baseline and actual good-unit and duration outcomes, values only the
observed unit delta at a verified market price, subtracts observed maintenance
cost and reports recovery against an observed acquisition cost. Negative
performance remains negative evidence. The report is explicitly
`telemetryOnly` and exposes neither a gameplay price nor a suggested price.

Each verified production batch consumes configured uses through the existing
audited `ItemLifecycleStore`. The bellows has finite durability, stops providing
utility when broken and points to the evidence-gated
`workshop-bellows-repair` policy. That repair consumes a bronze bar, takes 15
simulation minutes, requires Smithing level 5 and the
`smithing.basic-forging` facility capability. Exact use receipts are replay-safe
and cannot consume durability twice.

The Business investment boundary turns one physically produced bellows into an
installed capital instance. In one SQLite transaction it removes exactly one
item from Business inventory or storage, persists an immutable request digest
and appends a hash-chained audit event. It requires the Business owner or an
appropriately authorized worker plus trusted facility authorization at the
Business Property. The durable receipt is then materialized idempotently in the
item-lifecycle store; a crash between the two databases is recovered by
replaying that receipt, never by consuming another inventory item.

This makes the upgrade an actual choice rather than free configuration. The
Business gives up one saleable produced asset and receives a wearing capital
instance. At full quality, the acceptance scenario reduces a later 100-minute
production baseline to 80 minutes, raises capacity from two to three units,
adds 500 quality basis points and removes 1,000 failure basis points.

## Migration and rollback

This slice extends source-controlled catalogs with a lifecycle type, repair
policy and capital definition. It additively creates
`business_capital_investment` and its audit table in the Business database;
existing rows need no rewrite. The lifecycle schema is unchanged. Rollback must
first stop investment and production writers, then retain both investment
tables and all item instances for audit. If materialization was interrupted,
replay committed receipts before downgrade. Never credit the consumed Business
item back while its lifecycle instance exists, and never restore durability
independently; corrections must be forward, audited operations.
