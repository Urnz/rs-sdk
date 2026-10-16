# Item restitution claim audit v2

The v1 provenance event chain did not cover `item_restitution_claim` rows. A
changed `amount_coins` could therefore pass `verifyAuditChain()`. This v2
schema adds `item_restitution_claim_audit`: each claim has a full-row digest,
an origin marker, and a hash-chained entry. A new fungible theft writes its
event, claim, and claim-audit entry in the same immediate SQLite transaction.
Verification checks count, chain continuity, full claim contents, arithmetic,
and the claim's linkage to its audited theft event. `getClaim()` verifies both
chains before returning any amount.

## Migration and legacy trust boundary

Opening v1 first verifies its event chain, then snapshots all existing claims
into the new claim chain in one transaction and advances `user_version` to 2.
Those entries are marked `legacy-v1-snapshot`. The snapshot detects changes
**after migration**, but it cannot establish whether a claim value was already
altered during v1. Consequently `getClaim()` refuses legacy claims with an
explicit error; no financial action or harm metric may treat their amounts as
authenticated. An operator must use independent trusted evidence and a future
explicit re-attestation workflow to resolve them. Migration never silently
promotes them to `v2-write`.

Newly written claims are marked `v2-write` and are readable only while both
audit chains verify. This is tamper evidence within the local database, not an
external signature or a guarantee against an attacker who can rewrite the
whole database and recompute all hashes.

## Rollback

Stop provenance writers and back up the database with WAL/SHM sidecars before
upgrading or rolling back. A v1 binary rejects the v2 database. Do not merely
lower `user_version` or drop the claim audit table: that discards v2 integrity
evidence and would make new claims appear to be unaudited legacy claims.
Restore a pre-migration backup only if losing all later provenance writes is
acceptable; otherwise retain v2 as an immutable record and disable
claim-dependent reads/writes until a v2-compatible application is restored.
