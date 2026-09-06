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

## Persistence and migration

The SQLite database stores an explicit `governance_schema.version`. Version 1 creates additive faction,
jurisdiction and territory tables plus lookup indexes. A future migration must run in one immediate transaction,
upgrade one known version at a time, preserve stable IDs, and include a reopen-and-migrate test using the prior
schema fixture. Unknown versions fail closed instead of being silently rewritten.

Rollback for version 1 is operational: stop governance writers and restore the pre-deployment database backup.
The new database is isolated at `.local/economy/governance.sqlite`, so rollback does not rewrite player saves,
property, business, treasury or banking databases. Before a later destructive schema change, export the three
governance tables and verify row counts and foreign keys after restore.

## Next slice

`Faction.treasuryActorId` is the stable join key reserved for the shared institution treasury. The next slice
will provision that account and introduce versioned budgets before tax, tariff, fee and subsidy policies are
allowed to emit settlement obligations.
