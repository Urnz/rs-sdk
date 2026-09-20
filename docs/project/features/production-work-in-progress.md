# Atomic production input reservation and work in progress

`ProductionWorkInProgressStore` persists a compiled, exact-version workflow in
the Business database. Starting a run atomically removes every external input
from Business inventory or an explicitly named Business storage and places it
in run-scoped material lots. A concurrent run therefore cannot reserve the same
stock, and a failed reservation rolls back both the run and every stock change.

Each step requires trusted evidence whose inputs and outputs exactly match the
compiled recipe and batch count. Dependencies must already be complete.
Intermediate output remains inside the run and may be consumed only by a
declared descendant step; unrelated workflow branches cannot borrow it. Exact
step receipts replay idempotently, while another operation id cannot complete
the same step twice. Finalization checks that all remaining WIP equals the
compiled final output before atomically depositing it into Business inventory
or storage.

An unstarted reservation can be cancelled idempotently and returns every input
to its exact source location. Once physical work has started, cancellation is
deliberately unavailable: partial output requires a forward recovery or
compensating workflow rather than silently recreating consumed inputs.

## Migration and rollback

The store additively creates `business_production_run`,
`business_production_material` and `business_production_step` beside the
existing Business inventory/storage tables. Existing rows need no backfill.
Rollback first stops new reservations. Reserved, unstarted runs may use the
typed cancellation path; running runs must be reconciled forward. Keep all
tables for audit until no retained Business history references them. Never drop
the tables or restore a database snapshot independently from the Business stock
database, because the reservation and stock subtraction commit atomically.
