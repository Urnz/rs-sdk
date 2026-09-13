# Phase 15.8 — verified skill and capability coverage

## Implemented coverage

- The Varrock proto-society fixture declares an immutable, exact-version autonomous allowlist containing the ten
  shared verified catalog skills. Every player's known skills must be a subset, and the immediate goal must reference
  one of that player's exact known skills.
- Fixture preflight verifies every allowlisted reference against the shared verified catalog. Draft catalog entries
  are not accepted and are never assigned by the fixture.
- The existing verified `shopping.lumbridge.buy-hammers@1.0.0` path is protected by the separate shop-buy
  authorization envelope: exact item, quantity, live unit-price, per-run GP and daily GP limits are required.
- Approved Business player-action requests have a one-use accept/delegate/start path, and exact active economic
  contract obligations can provide authoritative skill parameters and receive terminal run evidence.
- Terminal execution failures are classified as procedure, parameter-binding, context, policy, lifecycle,
  input-shortage, or transient. Only a genuine missing procedure is reported to CapabilityGap/Skill Builder.

## Published reusable procedures

Four shared procedures were promoted to immutable `1.0.0` versions after two independent live runs and deterministic
verification, without creating personal or route-per-agent skills:

- `procedure.travel-meet-return`: bounded destination, wait, and return coordinates;
- `procedure.bank.withdraw-item`: exact bank coordinates, item, quantity, and note mode;
- `procedure.shop.buy-item`: exact shopkeeper/item and bounded quantity, with spending authority kept outside the
  skill in the authorization envelope;
- `procedure.trade.receive-item`: the receiving side of a two-player trade, with exact partner, item, and amount.

`trade-receive-item` uses the SDK's full trade protocol with an empty give set and a required want set. The SDK
rechecks the partner's offer before both accept stages. Runtime authorization independently rechecks operation,
partner, item, and quantity.

The verifier-created local shared versions are loaded by the normal admin catalog alongside the reviewed source
catalog. Source drafts are suppressed only when their exact skill id already has a verified successor. This keeps
newly published skills runnable through the standard admin `start-skill` path while preserving verifier-only trust.

## Published composite workflow

`workflow.varrock.bronze-dagger-bank-cycle@0.1.0` composes the exact verified bank-withdraw, Varrock bronze-dagger
production, and bank-deposit skills. Two independent live runs each withdrew one banked Bronze bar, produced one
Bronze dagger, and deposited the result. The deterministic verifier passed all checks and explicit human approval
published the immutable shared `1.0.0` version. Test input was added through the audited offline editor and the
complete player save was restored from its automatic pre-edit backup after evidence collection.

The attempted shop acquisition from Shantay also exposed a separate route/context dependency at the Al Kharid gate.
That timeout is retained as negative evidence and must not be misclassified as a missing shop-buy procedure.

## Published crafted-output handoff

`workflow.varrock.bronze-dagger-handoff@0.1.0` composes the exact-versioned Varrock bronze-dagger production and
Lumbridge give-item skills. Two independent live giver runs each produced one Bronze dagger and transferred it to
the exact `Ferrye14` recipient; paired `procedure.trade.receive-item@1.0.0` runs independently confirmed both
receipts. The deterministic verifier passed all ten checks and explicit human approval published the immutable
shared `1.0.0` version. Both players were restored from automatic pre-trial backups after evidence collection.

## Remaining capability work

- Model the Al Kharid gate/toll interaction as a bounded travel dependency before using Shantay acquisition from
  outside the gate.
- Add richer automatic acquisition-goal selection once exact verified acquisition parameters exist; until then an
  `acquire-input` terminal deterministically stops same-skill redispatch with `input-required`, requiring a bounded
  acquisition action or explicit wait.

## Persistence and rollback

This slice adds no persistent database schema. The fixture JSON schema gains a required allowlist field and a new
baseline digest; existing unapplied fixture manifests are unaffected. Rollback consists of removing the five draft
catalog files and `trade-receive-item` adapter, removing the corresponding verifier-created local shared files,
reverting the manifest field/digest, and restoring the previous failure classifier. Applied fixture domain databases
need no migration or data rollback because the baseline digest continues to be journaled per application.
