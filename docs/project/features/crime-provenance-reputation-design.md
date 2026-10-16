# Crime, stolen provenance, fencing and reputation design

This design separates world facts, observed knowledge and legal conclusions. A
trusted simulation fact is not automatically known by an agent, and an observed
fact is not automatically proof of guilt.

## Provenance resolution

Ownership title, current possession and historical provenance are independent,
but they are not tracked at the same resolution for every item:

- cheap fungible goods stay quantity based; the theft event records the victim,
  source inventory and value, without inventing a permanent owner for each unit;
- commercially relevant quantities may use a persistent provenance lot;
- valuable, durable or identifiable goods may use a stable item instance with
  legal title, current holder and immutable history.

The existing `stack`, `batch` and `instance` classification is the policy entry
point. It must be extended rather than replaced. The current instance field
`ownerActorId` cannot represent both title and possession after theft, so the
separate `item-provenance` projection now owns title, custody and historical
theft facts. Batch expiry remains prepared-only, while provenance lots are
persistent and independent from expiry activation.

A verified theft changes possession without creating an item and without
transferring lawful title. Fungible restitution normally repays equivalent value;
an identifiable instance may instead be returned. Player trade does not erase
known history. Coins remain fungible in the first slice: criminal proceeds are
measured, not individual coin objects.

## World truth, discovery and proof

The system may know that a right was violated while every in-world observer is
still unaware. The following transitions are separate:

1. a violation occurs as world truth;
2. the loss or intrusion is discovered;
3. an actor becomes a suspect;
4. evidence supports or weakens an allegation;
5. a jurisdiction reaches a legal finding.

Finding stolen property is evidence, not automatic guilt: possession may have
followed an innocent purchase. Recognition requires information available to the
observer, such as a witness report, a reported identifier, engraving or heraldry,
an inspection, a physical trace, or law-enforcement/underworld knowledge. There
is no `inventory contains stolen item -> merchant knows` shortcut.

Heat/traceability belongs to a crime, instance or provenance lot rather than to a
universal wanted score. It may depend on value, uniqueness, victim importance,
witnesses, reporting, publicity, elapsed simulation time, jurisdiction and
current location. Heat affects inspection and resale risk but is not itself
evidence or a conviction.

## Emergent fencing

Fencing is an emergent agent activity, not a permanent NPC role or guaranteed
world service. Any sufficiently capable agent may begin knowingly purchasing,
storing, transforming or reselling stolen goods when economic incentives and
available relationships make it worthwhile. Fence businesses are subject to
ordinary agent mortality, imprisonment, insolvency and competition; the world
does not automatically replace a lost fence. Consequently, local fencing markets
may disappear entirely, become competitive, consolidate into criminal
organizations or develop into territorial cartels as a consequence of agent
behaviour.

Fence availability and prices form part of the simulated economy. Scarcity of
fencing capacity reduces stolen-goods liquidity and indirectly reduces the
profitability of theft, while unusually profitable fencing markets can attract
new entrants and competition.

There is no `Fence` NPC type, mandatory fence shop, dedicated Fencing personal
skill or guaranteed fallback service. A lawful Business may also conduct covert
fencing. It reuses ordinary treasury, finite inventory, storage, employment,
trade and insolvency/lifecycle rules. Whether an acquisition was innocent,
suspicious, knowing or habitual is inferred later from evidence and history, not
from a permanent character class. Useful capabilities may include trading,
appraisal, deception, social relations, Thieving experience, crafting and
underworld knowledge.

Normal merchants reject only goods they recognize as ineligible under their
policy; they are not omniscient. A direct player trade may move possession while
preserving available provenance. Underworld counterparties are learned through
agent memory, relationships, rumours and experience, never a globally visible
lookup table.

## Transformation and laundering

Fencing does not magically create lawful title. Physical transformation may
consume an identifiable instance and produce material or a new item with lower
traceability, but the transformation receipt retains the historical input
provenance. This is a later crafting/economic process with real inputs, outputs,
cost and detection risk, not a `clean stolen item` flag.

Clean title may arise only from restitution, policy-backed forfeiture or another
verified legal resolution. Concealment and reduced traceability are not the same
as lawful ownership.

## Record, reputation, personality and karma

Four projections remain separate:

- a jurisdictional legal record contains allegations, warrants, findings,
  sentences, imprisonment and restitution under versioned law;
- reputation is observer-, group- or community-specific and changes only from
  information available to that observer;
- stable `personalityTraits` describe the character baseline and are not rewritten
  as punishment;
- optional `moral standing` (UI label: karma) is a world-profile role-play rule,
  never a universal authorization score.

There is no global `social credit` field. Evidence-derived descriptors such as
`habitual thief`, `uses fences`, `unreliable` or `reformed offender` belong in a
separate dynamic behavioural/reputation projection. Hidden conduct cannot affect
public reputation, and theft alone does not prove malice.

Restitution, compensation, community service, completed sentences, forgiveness
and religious penance may improve the projection selected by policy. Prayer by
itself cannot erase ownership title, evidence or a legal record. This keeps
spiritual redemption, social trust and legal consequence distinct.

## Organizations, control and legitimacy

Criminal organizations are emergent organizations, not predefined factions. Any
group, clan, business network or polity may become increasingly dependent on
theft, fencing, extortion, smuggling, raiding or corruption. Conversely, criminal
organizations may acquire territory, institutions and legitimacy and evolve into
ordinary political entities. The simulation models actions, economic
dependencies, relationships and control rather than assigning permanent
`criminal` faction types.

There is currently no complete general clan/organization membership domain. The
existing Faction/Jurisdiction model represents formal authority and territory;
Business represents an economic institution; organization-scoped learning grants
only control skill access. A future general organization layer must connect to
these modules instead of cloning them. Gang, cartel, guild and polity are derived
descriptions of membership, activity, assets, influence and control, not mutually
exclusive hardcoded classes or state transitions.

Formal territorial jurisdiction remains distinct from informal influence,
coercion, protection, corruption and legitimacy. Activity and income composition
must be derived from verified transactions and conduct. Raiding must transfer
real finite assets and therefore deplete victims, production and trade rather
than generate infinite loot. These are compatibility requirements for later
phases, not part of the first Thieving slice.

## First implementation boundary

The first vertical slice reuses the existing RuneScript Thieving mechanics and
adds a typed, trusted bridge for pickpocket, lockpick, container theft and
Property burglary. It records attempts/outcomes, resolves protected resources,
emits rights violations after successful unauthorized transfer/entry, and creates
separate discovery observations where an actual witness or trace exists.

It does not implement cartel growth, polity takeover, raiding, corruption,
sentencing, imprisonment, laundering or an autonomous fencing market. It also
does not create a separate Burglary or Fencing personal skill.
