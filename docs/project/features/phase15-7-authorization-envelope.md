# Phase 15.7 – everyday authorization envelope

Phase 15.7 turns the autonomous skill allowlist into a narrow execution grant. A grant identifies an exact
reviewed skill version and may constrain its operations, resolved parameters, item names, quantity, trade
partners, shop unit price, per-run spending and daily spending. Legacy `id@version` entries remain readable,
but normalize to routine operations with no autonomous spending or player trade.

Routine gathering, travel, production, bank and NPC sell operations may run only after the planner-selected
parameters have been bound to a persisted source and checked against the grant. Shop buying and player trade
remain denied unless a separate `shop-buy` or `player-trade` grant names the exact item and, for trade, the exact
partner. Shop grants also reserve their worst-case GP amount atomically in the decision ledger. The skill child
process receives a trusted reduced runtime grant and checks the live shop price, cumulative run spend, item,
quantity, partner and operation again immediately before calling the SDK.

Business work can cross the player-action boundary without a fresh click only when all three durable authorities
still agree: an approved active Business policy, an active employment, and the exact work-order skill and reward.
The gateway derives a deterministic approval from those records and the run id, then resumes the normal
accept/approve/start state machine. The approval is consumed by one run id; a retry with the same id is
idempotent and a different id fails closed.

An active accepted contract contributes a parameter source only for the unsatisfied party's exact skill
obligation. The dispatch journal records `contract-obligation` plus the immutable contract id. Terminal recovery
accepts evidence only when the journal skill and parameter digest match that dispatch; the existing contract
evidence transaction then verifies party/avatar, post-acceptance time and exact skill, and deduplicates by run id
and journal digest.

Sensitive mutations are deliberately absent from the autonomous operation set. Skill publication and autonomous
grant widening, Property ownership/collateral/seizure, large treasury and credit resolution, Business/Faction
lifecycle, governance/world/mod activation and uncertain settlement reconciliation continue through authenticated
local-admin routes with explicit reasons or confirmations. Existing economic reserve/commit/release and escrow
flows are unchanged; the new spending admission and contract evidence writes are immediate SQLite transactions.

## Configuration example

```json
{
  "id": "shop.buy-hammer",
  "version": "1.0.0",
  "risk": "shop-buy",
  "operations": ["open-shop", "buy-from-shop", "close-shop"],
  "parameters": { "amount": { "minimum": 1, "maximum": 2 } },
  "itemNames": ["hammer"],
  "partners": [],
  "maxQuantity": 2,
  "maxUnitPriceGp": 10,
  "maxGpPerRun": 20,
  "maxGpPerDay": 100
}
```

## Migration and rollback

No persistent schema change is introduced in this phase. Existing configuration remains readable through the
fail-closed legacy normalization. Rollback consists of disabling autonomous execution or removing the affected
grant, stopping active autonomous skill processes, and reverting the gateway/runtime code. Decision reservations,
player-action transitions, skill journals and contract evidence are retained as audit history; they must not be
deleted or rewritten during rollback.

## Verification

- TypeScript main-project typecheck.
- Authorization/config tests for legacy normalization, routine operations, exact shop/trade grants and budgets.
- Runtime tests for live unit price, cumulative run GP, quantity, exact item and exact partner enforcement.
- Agent-state tests for atomic daily reservation and one-use resumable Business work authorization.
- Terminal recovery and economic contract tests for exact dispatch binding and idempotent evidence ingestion.

