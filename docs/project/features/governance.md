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

## Versioned fiscal policies

Tax, tariff, fee and subsidy rules are immutable versions in a stable policy family. Each jurisdiction may have
one active version per `policyKey`; activating a replacement atomically supersedes the previous version. Drafts
are inert, and creation, activation, supersession and revocation carry an actor-bound audit trail with optimistic
revision protection.

The calculation language is deliberately small: a policy is either a positive flat GP amount or a basis-point
rate with explicit minimum and maximum GP bounds. Policy kind and trigger must match a closed allowlist. Current
triggers are `property-transfer`, `property-ownership`, `business-revenue`, `business-registration`,
`goods-import` and `property-development`; arbitrary chat, model output or external event names cannot become
executable policy. The pure calculator rounds proportional amounts down and applies the persisted bounds
deterministically. A subsidy is represented as a positive amount; its later obligation adapter determines the
reversed payer/payee direction rather than encoding negative money.

## Verified obligations

The obligation adapter accepts only typed Property or Business source events and requires an independent
verifier to return the SHA-256 digest of the normalized event. Source-domain and trigger combinations are
allowlisted. The supplied source reference is unique inside its domain, so renaming an event ID cannot charge
the same upstream event again. The Property transfer adapter uses the exact transfer receipt, recipient and
property location; the Business revenue adapter accepts only complete, positive `shop-sell` or `player-trade`
economy events. Its caller must establish the worker-to-business binding before verification.

Processing resolves the event coordinate through the deterministic broadest-to-narrowest jurisdiction chain and
selects the policy versions that were effective at the event timestamp, not whichever version happens to be
active during delayed processing. The verified source event and every positive obligation are inserted in one
immediate transaction. `(eventId, policyId)` and deterministic obligation IDs prevent duplicate creation across
retries. Tax, tariff and fee obligations point from the subject to the jurisdiction faction treasury; subsidies
reverse that direction. These records remain `due` and move no GP until the later collection layer verifies and
settles them.

## Persistence and migration

The SQLite database stores an explicit `governance_schema.version`. Version 1 created faction, jurisdiction and
territory tables. Version 2 added budgets and the immutable budget audit. Version 3 added fiscal policies,
single-active-version indexes and policy audit. Version 4 adds verified source events and immutable due
obligations. Each migration runs in one immediate transaction, and the full
v1-to-current path has a reopen-and-migrate test using a prior-schema fixture. Future migrations must upgrade one
known version at a time and preserve stable IDs. Unknown versions fail closed instead of being silently rewritten.

Rollback for version 4 is operational: stop governance writers and restore the pre-deployment v3 database backup.
The new database is isolated at `.local/economy/governance.sqlite`, so rollback does not rewrite player saves,
property, business, treasury or banking databases. Before a later destructive schema change, export the three
base governance tables, budgets, policies, source events, obligations and both audits, then verify row counts and
foreign keys after restore. Because treasury provisioning is idempotent and creates only a zero-balance account,
a governance rollback may leave an
unused faction treasury account; it must not be deleted automatically if it has ever received funds.

## Next slice

The next slice exposes the bounded Governance read/write port to exact faction agents. It may inspect scopes,
budgets, policies and obligations or submit inert proposals, but only verified settlement events may move treasury
funds.
