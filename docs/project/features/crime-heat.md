# Crime heat and item traceability

`crime-heat` computes a read-only risk projection for one verified crime receipt or
one stolen identified asset/provenance lot. The result has no actor-wide wanted
score, arrest instruction or automatic merchant/guard knowledge.

The versioned policy weights the appraised value, uniqueness, victim importance,
distinct direct witnesses, owner loss reports, publicity and the exposure of the
current location. The jurisdiction of the crime controls how much of the result
persists locally or in another configured jurisdiction. Risk decays with elapsed
SimulationClock hours. Outcome/discovery wall-clock timestamps are never used as
simulation-time duration.

`projectCrimeHeatFromStores` verifies the existing Thieving and item-provenance
audit chains and resolves outcome, discovery, asset and theft records from those
stores. A separate verifier must attest the appraisal, publicity, jurisdiction,
location and simulation clock binding. No report or witness is inferred from the
world-truth theft event. Duplicate observations by one witness count only once;
untrusted, foreign or future observations fail closed.

The projection is internal evidence for later inspection and resale-risk rules.
It does not tell a merchant what it knows. The existing sale-channel rule still
requires evidence available to that particular merchant before rejecting an
offer. Possession and heat alone establish neither knowledge nor guilt.

This slice adds a JSON policy and pure computation, without persistent schema or
inventory mutation. Rollback removes the module and policy after disabling its
consumers. The underlying Thieving, provenance and audit ledgers are retained.
