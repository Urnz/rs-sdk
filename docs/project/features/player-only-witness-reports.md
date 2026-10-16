# Player-only witness reports (Phase 22)

This is an independent, append-only journal for a player who noticed a burglary but had no agent binding at the incident. It does not use the agent `CrimeReportStore` and does not identify a suspect, find guilt, create a fine, or move money.

`PlayerWitnessReportStore.record` accepts only a server-derived authenticated username, an explicit action attestation, and a case discovery validated by `verifyPlayerOnlyWitness`. The attestation callback belongs at the trusted gateway boundary; a request body, game chat, mod data, or LLM output is not an attestation. The report stores the case-event and witness-decision digests. Reads verify the complete report audit chain and source chains, failing closed on mismatch. The pair `(source_case_event_id, reporter_username)` permits one report; an exact `report_id` replay returns the original row, while a changed replay is rejected.

## Migration and rollback

The report database is a separate SQLite file. On first open, a single transaction creates `player_witness_report` and `player_witness_report_audit` and sets `PRAGMA user_version=1`. Existing CrimeCase, Thieving and agent-report schemas are unchanged. Before deployment, back up the new report file together with its three source files at a consistent snapshot. An unknown newer schema is refused.

For rollback, disable new player-only report intake and use the earlier application without deleting or rewriting the v1 file. The previous application does not consume this separate ledger. Preserve it and its source databases for a later forward deployment and verify the audit chains before reopening intake. Restoring a pre-migration snapshot is appropriate only if losing reports written since that snapshot is explicitly accepted; never silently discard them.

The existing `/crime/report/:username` gateway route now selects this ledger only
for a case discovery whose observer agent is `null`. The route still requires
login-server authentication and a fresh, matching game avatar before intake.
The separate engine evidence, witness-decision ledger and attention policy must
already exist; missing sources fail closed. Agent-bound discoveries continue
through the pre-existing agent report ledger. The route supplies a server-derived
action attestation and stable report ID, never accepting those from the body.
