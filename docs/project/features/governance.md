# Governance domain

The governance domain stores faction identity separately from territorial authority. A faction may own
one or more jurisdictions, and a jurisdiction may be nested below a jurisdiction owned by another faction.
This supports kingdoms, cities, manors, guilds, districts and future custom units without specialized agent
classes.

## Territorial resolution

Territories are inclusive world-coordinate rectangles on levels 0–3. Child territory must be fully contained
by a territory of its direct parent. Overlapping territories are accepted only along the same ancestry chain;
unrelated or sibling overlap is rejected. `resolveAt(x, z, level)` consequently returns an unambiguous,
deterministic broadest-to-narrowest jurisdiction list that later policy evaluation can consume.

Territory assignment is replay-safe: an existing `territoryId` accepts an exact replay and rejects changed
content. Faction, jurisdiction, treasury actor and property references use normalized, bounded identifiers;
display names are treated as untrusted input and stored only after length and whitespace validation.

## Treasury and budgets

Each faction has one stable `treasuryActorId`. `GovernanceFinanceService` provisions and reconciles that exact
actor as a `faction` account in the shared institution treasury; governance never copies its balance. A combined
read snapshot exposes faction identity, the current treasury state and the active budget while all actual GP
reservation and transfer remains atomic in `InstitutionTreasuryStore`.

Budgets are immutable numbered plans per faction. Creation must use the next version, and activation atomically
supersedes the previous active version with optimistic revision protection. Creation, activation, supersession
and closure append actor-attributed audit entries in the same governance transaction. Idempotent replays bind
to the original creator or approver and reject changed provenance. A budget is an authorization ceiling, not a
second balance or a reservation; later spending must still pass through the treasury settlement layer.

## Persistence and migration

The SQLite database stores an explicit `governance_schema.version`. Version 1 created faction, jurisdiction and
territory tables. Version 2 adds budgets, a single-active-budget index and the immutable budget audit. The
v1-to-v2 migration runs in one immediate transaction and has a reopen-and-migrate test using a prior-schema
fixture. Future migrations must upgrade one known version at a time and preserve stable IDs. Unknown versions
fail closed instead of being silently rewritten.

Rollback for version 2 is operational: stop governance writers and restore the pre-deployment v1 database backup.
The new database is isolated at `.local/economy/governance.sqlite`, so rollback does not rewrite player saves,
property, business, treasury or banking databases. Before a later destructive schema change, export the three
base governance tables, budget tables and audit, then verify row counts and foreign keys after restore. Because
treasury provisioning is idempotent and creates only a zero-balance account, a v2-to-v1 rollback may leave an
unused faction treasury account; it must not be deleted automatically if it has ever received funds.

## Next slice

The next slice introduces versioned tax, tariff, fee and subsidy policies. Policy evaluation will consume the
deterministic jurisdiction chain and may emit obligations, but only verified settlement events may move treasury
funds.
