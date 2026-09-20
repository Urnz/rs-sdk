# Persistent actor identity boundary

`actor-identity-boundary` separates a rendered world entity from a persistent
economic or social actor. Its versioned policy is fail-closed: the default is
`ambient`, and promotion based on visual type is always forbidden. A name,
NPC type, spawn, dialogue, model output or the fact that an entity can be clicked
does not justify AgentState identity, memory, goals or LLM budget.

The boundary accepts observations for NPCs, animals and mobs. `Man`, `Woman`, a
cow and a goblin therefore all remain ambient when no verified persistent state
exists. This is a state rule, not a hardcoded species rule: an animal or ordinary
looking citizen can still become a full actor later if the simulation genuinely
persists qualifying economic or social state for that exact entity.

Qualifying economic evidence is limited to Business ownership/employment,
Property entitlement or treasury control. Qualifying social evidence is limited
to governance membership or a persistent social-relationship record. Every
claim binds an exact world entity, persistent record ID and source digest. The
caller must supply a trusted domain verifier; a syntactically valid but
unverified claim produces the same ambient result as no claim.

The result is a digest-bound assessment with accepted evidence IDs. It is an
authorization prerequisite for a future world-entity promotion adapter, not an
identity writer itself. Existing explicit player, institution, service and World
Director creation paths remain unchanged because they do not infer identities
from visual world entities.

This addition is read-only and introduces no persistent schema, so no database
migration is required. Rollback removes the policy/module before any promotion
adapter consumes it. Once an adapter persists identities from assessments, that
adapter must store the assessment and policy digests, migrate atomically, and
use forward reconciliation rather than deleting identities that have acquired
economic assets, commitments or social history.
