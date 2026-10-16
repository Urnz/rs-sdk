# Physical transformation source readiness

`item-transformation` is a read-only source-capability projection for a specific
versioned production recipe. It checks the production catalog and provenance
policy digests and reports exact *item types and quantities*. An unknown item
has `provenanceTier: null`; it is not silently treated as clean.

The readiness projection remains deliberately conservative for old and generic
production receipts: aggregate item quantities do not prove exact asset lineage.
For verified execution, `ItemProvenanceStore.transform()` now accepts the exact
consumed asset revisions and exact created asset IDs plus a versioned recipe
receipt. It is enabled only when provenance and Business inventory live in the
same SQLite database. One `IMMEDIATE` transaction debits the exact aggregate
stock location, marks every input asset consumed, credits the output stock,
creates the output assets and appends every input-output lineage edge and its
hash-chain audit. A failed debit or write rolls the entire transition back.

The readiness projection still reports `exactAssetLineage: unavailable`,
`recognizabilityChange: unverified`, and `cleanTitleFinding: not-established`. A physical change
*could* reduce recognizability, but it cannot erase theft history or produce
lawful title by itself. The execution path preserves the common input title,
theft-history count and transitive ancestry on every output. It refuses to
collapse inputs with distinct title claims. Consumed assets remain readable but
cannot be transferred, stolen or consumed again.

The verifier boundary must validate the recipe/catalog digest and the real
crafting receipt; passing an arbitrary callback is not a substitute for a live
source adapter. Exact replay is idempotent, while reuse with changed inputs or
outputs fails. For old production runs there is no safe identity backfill:
retain them as unlinked historical production, not presumed clean assets.

Schema v3 is a transactional migration. Existing assets become `active`; new
transformation, lineage and audit tables are empty until verified writes occur.
Before deploying v3, snapshot the shared SQLite database and its WAL/SHM files.
Binary rollback after v3 writes means restoring that snapshot: never drop the
lineage tables or merely lower `user_version`, because doing so would erase
origin. A failed migration or failed transformation commits no partial stock or
provenance state.
