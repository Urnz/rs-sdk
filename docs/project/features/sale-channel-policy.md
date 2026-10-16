# Stolen-goods sale channel policy

The `sale-channel-policy` module decides whether a particular acquirer may
accept a particular item offer. It does not read world-truth theft history and
does not expose a global stolen-item flag.

Business and NPC shop channels accept observer-scoped inspection evidence. A
normal merchant rejects an offer only when trusted evidence for that exact
merchant and exact offer says `recognized-ineligible`. A report held by another
shop, an unverified model statement or unrelated provenance knowledge cannot be
used. With no recognition evidence the merchant may accept the offer; this is
possible ignorance, not a declaration that title is clean.

Direct player trade consumes no merchant-inspection evidence and remains
permitted. Its decision always says `provenanceDisposition: preserve`. For a
tracked asset the offer binds the available asset id and provenance digest, and
the item-provenance custody transfer retains title and theft history. The channel
policy never launders title.

The finite agent-operated Business shop now requires an accepted, digest-bound
business acquisition decision for every procurement before it mutates stock or
treasury state. Outbound Business sales cannot accidentally consume such a
decision. Existing legacy NPC shops remain disabled in the closed-society world
profile; the NPC rule is the required boundary for a future finite NPC-backed
acquirer, not a route that re-enables infinite legacy shops.

The catalog is schema version 1 and does not add persistent tables. Deployment
adds the policy gate to new Business procurement requests. Exact replay of an
older already-journalled operation remains compatible with its legacy request
digest, while every new procurement binds the acquisition decision digest.
Rollback removes the gate and its configuration after stopping new procurement;
it does not alter completed stock, treasury, provenance or audit records. Any
operation started under the new gate must be reconciled by the existing
agent-shop recovery flow before rolling back.
