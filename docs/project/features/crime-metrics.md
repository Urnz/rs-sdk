# Crime outcome metrics: explicit receipt cohort

The read-only `projectCrimeOutcomes` function accepts an actor agent ID and an explicit,
bounded list of Thieving outcome receipt IDs. It verifies the entire Thieving audit
chain before reading, rejects missing/duplicate/cross-actor receipts, and returns
the source receipt IDs with every result. Caller authorization to see private
world-truth outcomes must be enforced outside this function; it is not a public
player or NPC knowledge endpoint.

The projection counts succeeded, failed and blocked attempts by procedure kind.
It separately counts distinct outcomes with any discovery, direct identification
of that actor, or inferred identification. These are observed facts within the
selected cohort, **not** detection probabilities, legal guilt, or population
rates. Transferred item quantities are actual recorded movements; they are not
sale revenue or profit. Unselected receipts are not silently treated as absent.

`projectVerifiedCrimeEconomics` adds an exact, caller-selected join across the
audited Thieving, item-provenance, transformation-lineage and fencing-settlement
sources. A settlement counts as gross criminal income only when it is fully
committed, the immutable request belongs to the actor, the engine-trade verifier
confirms the coins actually received, and the sold asset or one of its transitive
ancestors is a selected theft asset. Unrelated valid trades remain explicitly
unlinked and contribute zero. Net income stays unavailable without a verified
cost basis.

Victim loss is reported as the exact item and quantity whose custody moved in a
verified theft event. `monetaryDamageGp` remains `null`: restitution claim values,
item names and asking prices are not proof of realized harm or replacement cost.
Observed discovery and identification are kept separate from loss and payment.
Every result returns selected source IDs and coverage counts, so omitted receipts,
events or settlements are never treated as absent world history.

`inspectJurisdictionCrimeHistory` supplies the half-open incident window and
inclusive finding-recording cutoff over the complete local responsibility
ledger. `additionalResponsibleOutcomes` measures repeated responsible outcomes
inside that declared window; it is not a population or cross-jurisdiction
recidivism rate.

`estimateProspectiveDiscoveryRisk` is separately labelled
`prospective-estimate`. It exposes its selected-cohort sample, observed numerator,
basis-point estimate and limitations, and sets `representsOccurredEvent: false`.
It creates no discovery, evidence, finding, sanction or global wanted score.

Crime metrics remain pure read-only projections and add no persistent schema or
economy operation.
