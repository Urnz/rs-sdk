# Phase 22 crime foundation audit

Audit date: 2026-09-21. This document records what already exists before the
verified Thieving procedure slice, what can be reused, and which boundaries must
not be duplicated.

## Existing foundations

### Ready to reuse

- **Vanilla Thieving:** RuneScript already implements pickpocket success/failure,
  stun/damage, stall owner and guard line-of-sight checks, locked doors, trapped or
  locked chests, loot, XP and respawn. The SDK has a Thieving acceptance test.
- **Rights violations:** the `rights-violations` domain stores immutable,
  verifier-gated, replay-safe facts for item, Business storage, Property and entry
  entitlement violations. It intentionally does not infer crime or punish.
- **Property:** persistent legal owner, typed economic actor, entry points and
  server-authoritative access checks already exist.
- **Business:** owner, workers/managers, institution agent, treasury, finite
  inventory/storage, role checks, stock policy and atomic audited movements exist.
- **Governance:** generic factions, nested jurisdictions, territory resolution,
  treasuries, fiscal policy and obligations exist. This is the formal
  jurisdiction/authority source for later law.
- **Agent state:** directional trust/affinity/familiarity, evidence-linked
  relationships, episodic memory, semantic knowledge and stable personality
  traits exist. These are the base for non-omniscient reports, rumours and
  observer-specific reputation.
- **Trade/economy:** verified shop buy/sell, player trade, bank and production
  telemetry exist; the Grand Exchange has escrow and conservation. These can
  provide real activity and income evidence.
- **Housing security:** housing tiers already expose private storage capacity and
  a theft-protection modifier. It can contribute to a security calculation.

### Partial or prepared only

- **Item state:** `stack`, `batch` and `instance` classification exists. Durable
  instances have identity, durability, quality and a provenance digest. Batch is
  only a prepared expiry contract; there is no persistent provenance-lot ledger.
- **Ownership:** Property and Business ownership are authoritative. Item instance
  `ownerActorId` currently represents a single owner concept and cannot safely
  express unlawful possession while legal title remains elsewhere.
- **Organization access:** organization-scoped skill policies and membership-like
  grants exist only for learning authorization. They are not a general member,
  role, governance or lifecycle model.
- **Lifecycle:** active/deceased character status and a detected death transition
  exist, but permanent death, estate settlement, inheritance and succession do
  not.
- **Territory:** formal rectangular jurisdiction and nested authority exist;
  informal influence, protection, corruption and legitimacy do not.
- **Detection:** stall scripts already use actual owner/guard line of sight, but
  produce only immediate retaliation. They do not persist a discovered crime,
  suspect or evidence chain.

### Not implemented

- a general clan/group/organization membership domain;
- legal allegations, warrants, findings, sentences, prison state or restitution;
- observer/community reputation distinct from raw relationships;
- stolen-goods heat/traceability and reported identifiers;
- a persistent item possession/title split or provenance-lot ledger;
- emergent fencing, laundering, underworld discovery or criminal market entry;
- informal territorial influence, coercion, corruption, raiding and succession.

The apparent prior “clan” support is therefore not a reusable clan module. Guild
and gang names in vanilla content, `FactionKind='guild'`, economic actor
`member` links and organization learning grants are separate narrow concepts.

## Reuse decisions

1. Extend the existing item classification policy with provenance/traceability
   requirements; do not make every inventory unit an instance.
2. Keep `rights-violations` as world truth and add separate discovery, suspect and
   evidence projections. Do not expose its actor field directly to observers.
3. Use Property and Business as authoritative title/storage sources and
   Governance as jurisdiction resolution. Do not create crime-owned copies.
4. Use agent episodes, semantic knowledge and directional relationships for who
   knows what. Add derived reputation later without mutating personality traits.
5. Reuse verified economy events and real Business capital/storage for future
   fencing economics. Never introduce infinite fence stock or replacement NPCs.
6. Build a future generic organization membership layer before gangs/cartels;
   connect it to Business and Faction instead of adding `CriminalFaction`.

## Required refactors and conflicts

- Instance theft needs legal title and current holder to diverge. Migrating the
  current `ownerActorId` requires an additive schema/version plan and rollback;
  silently reinterpreting the field would corrupt existing ownership checks.
- Batch provenance requires a real lot ledger before lot theft can be promised.
  The first slice should use theft-event value for fungible rewards and reserve
  lot linkage for a later implementation.
- A denied access event is not always a completed theft. Procedure outcomes must
  distinguish attempt, successful unauthorized entry, successful transfer and
  failure before emitting the relevant rights event.
- Existing Thieving scripts know the NPC/loc and immediate witnesses, but not
  Property, Business storage or legal owner IDs. A typed server adapter must
  resolve those identifiers from trusted configuration/state.
- Existing economy telemetry stores item IDs and quantities, not instance or lot
  references. High-resolution trades need additive typed references later.
- Governance fiscal policy cannot simply be relabelled as criminal law; a
  versioned law/evidence layer must consume the same jurisdiction identity.
- Housing's theft-protection roll may modify security, but cannot replace locks,
  witnesses, traces or evidence.

## Next vertical slice

Implement one narrow, reversible procedure foundation:

1. define a versioned procedure catalog for `pickpocket`, `lockpick-door`,
   `container-theft` and `property-burglary`, all requiring the existing
   `Thieving` skill;
2. emit trusted attempt/outcome receipts from server-side RuneScript bridges with
   exact actor, target, location, result, item/quantity delta and engine tick;
3. resolve Property/Business/agent ownership and entry entitlement from trusted
   adapters, then record a rights violation only for a completed unauthorized
   action;
4. emit a separate discovery observation only for an actual witness, owner/guard
   line of sight, alarm or physical trace; keep suspect identification and proof
   unset unless the observation supports them;
5. treat fungible loot through the theft event's source/value and test one
   identifiable instance path only after title/holder separation is migrated;
6. expose these procedures through the bounded typed skill layer, not direct LLM
   tick control;
7. test success, failure, no witness, witnessed discovery, idempotent replay,
   wrong owner/entitlement evidence, restart persistence and item conservation.

This slice deliberately stops before arrest, punishment, fence selection,
laundering or organization formation.
