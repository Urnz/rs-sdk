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

This slice is pure and creates no persistent data, so it requires no migration.
The next task adds the durable, idempotent economic consumption ledger; until
that boundary commits an inventory receipt and closure, callers must treat the
returned transition as an inert candidate rather than authoritative state.
