# Checkpoint inspection evidence ledger (Phase 22)

This is a separate SQLite v1 append-only ledger for local/private LostCity checkpoint evidence. It records a trusted **inspection** and a separately trusted **detection**. A policy grants permission to inspect but never supplies inventory contents. Location entry, item heat, ordinary inventory state and a player's or LLM's claim are not accepted as source events. There is no engine producer or gameplay hookup in this slice.

`CheckpointEvidenceLedger.recordInspection` requires a versioned policy matching jurisdiction, location, checkpoint and authority at the inspection time, plus a caller-supplied verifier of the typed server-side inspection event and its `sourceEvidenceDigest`. `recordDetection` requires the persisted inspection, the same subject, valid chronology and a separate verifier for the typed recognition event. Neither method creates a legal finding, guilt, confiscation, fine or inventory mutation. The verifier must be backed by an independent trusted server event store; passing `() => true` is only suitable for isolated tests.

`projectExposure` joins the persisted pair to the read-only checkpoint policy
gate. It rejects a different policy digest and requires both source verifiers
again at read time. Missing detection or verification exposes no asset.

Schema/migration: new database files migrate transactionally from `PRAGMA user_version = 0` to v1. A future schema is rejected. Event payloads carry the source digest and inspection entries carry the policy digest. The append-only SHA-256 chain and payload digest are rechecked before reads and writes; changed replay is rejected and source digests are unique per event kind. SQLite `UNIQUE` and a single immediate transaction protect the event append and chain link.

Rollback: stop checkpoint writers and retain a byte-for-byte backup of the SQLite file (including WAL/SHM if active). Revert the code and leave the separate v1 database untouched; older code does not consume it. Restore from the backup only after stopping all writers if a rollback of ledger data itself is explicitly required. Do not downgrade `user_version` or delete records to make an older binary accept a newer schema.

Before enabling live gameplay, wire the independent engine inspection and detection sources to these verifier callbacks, preserve their source events and digests for audit, and add end-to-end tests for their identity and scope. A digest by itself is not proof of a server event.
