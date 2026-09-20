# Closed-loop economy metrics

`loop-metrics` derives operational measurements for the first food and tool
loops without turning observations into gameplay authority. The versioned
`config/loop-metric-policies.json` binds stock targets to exact food-chain and
production-cycle ids; unknown and tampered dependencies fail closed.

Food stock is measured only from a typed inventory snapshot with actor,
SimulationClock timestamp and source digest. Raw and cooked shortages are the
configured minimum minus observed stock, clamped at zero. Consumption comes
separately from the persisted `FoodConsumptionStore` within an explicit,
inclusive simulation-time window. Production receipts or a historical
consumption total are never treated as proof of current inventory.

Tool stock, use, breakage and replacement counts are derived directly from the
item-lifecycle database for one lifecycle type and owner. The projection reports
usable tools, broken tools still awaiting replacement, successful uses, breaks,
replacements, replacement coverage in basis points, and replacements per
thousand successful uses. A zero denominator is represented as `null`; it is not
silently reported as a meaningful zero rate.

These are read-only projections. They add no persistent schema and therefore
need no data migration or destructive rollback. Removing the module leaves both
source ledgers intact; historical measurements can be reconstructed from the
same audit-backed events and fresh inventory snapshots. Metrics must not
authorize purchases, production, consumption or replacement by themselves.
