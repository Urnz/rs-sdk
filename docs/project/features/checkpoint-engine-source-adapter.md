# Checkpoint engine source adapter (Phase 22)

`crime-checkpoints/engine-source-adapter.ts` only bridges an independently
trusted, chain-verified LostCity engine event store to the existing inspection
and detection verifier callbacks. It requires an exact server-script search
event, then a distinct explicit recognition event for the same inspection and
subject. Missing events, changed scope/identity/digest and failed source reads
fail closed. It does not scan an inventory, infer guilt, seize property or
recognize stolen goods from provenance, location or heat alone.

**Not live yet.** The current LostCity scripts do contain actual NPC searches:
`server/content/scripts/areas/area_karamja/scripts/customs_officer.rs2` searches
for Karamja rum, and `server/content/scripts/quests/quest_desertrescue/scripts/`
contains guard searches for quest keys. Neither emits an independently audited
checkpoint search event. They also do not resolve the Phase 22 `assetId` from
an explicit stolen-asset recognition event, or map the searched player to the
`subjectAgentId` in a trusted source. Reusing these script messages, inventory
state, or item presence as detection would fabricate knowledge. A real producer
must emit and retain those two events in the engine, preserve their digests and
tick order, and be covered by an end-to-end test before enabling the ledger
writer. An injected mock source is useful only in isolated tests.
The exported current production source returns no events, so it cannot be
mistaken for a live search integration.

There is no persistent schema or data change in this adapter. Rollback is to
stop using these verifier callbacks; existing checkpoint evidence must be kept
and not relabelled as engine-authenticated. The eventual engine event store
requires its own migration, audit and rollback plan.
