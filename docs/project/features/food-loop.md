# Closed food loop

The first food economy slice binds one configured lobster chain from Fishing
through Cooking to final consumption and hunger relief. `config/food-loops.json`
contains stable raw/cooked item ids, required personal skills and bounded hunger
relief instead of embedding those choices in runtime code.

Closing a loop requires three distinct trusted inventory receipts for the same
agent: raw-item gain, exact raw-to-cooked transformation and cooked-item removal.
Receipts must be causally ordered on simulation time and carry immutable source
digests. Only after all three match the configured chain does the domain produce
a new, digested needs state. Hunger is clamped at zero and unrelated need values
are preserved. Chat, model output, Cooking XP or an animation alone is never
accepted as proof that an item was produced or eaten.

`FoodConsumptionStore` commits an accepted closure, all three single-use receipt
identities, a final-use economic event and a hash-chained audit record in one
SQLite transaction. Exact replay is idempotent, while a changed closure id or a
receipt reused by another closure fails closed. Queries expose final food units
and hunger relief separately from upstream gathering/processing production, so
production and actual demand no longer collapse into one metric.

The additive ledger starts at schema version 1. Rollback requires stopping food
writers and archiving or restoring the SQLite database together with WAL/SHM
sidecars. Deleting it would lose receipt-consumption locks and could allow an
old inventory receipt to be counted again. A newer schema is rejected rather
than silently downgraded.
