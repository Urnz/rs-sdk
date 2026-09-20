# Finite legacy shop boundary

## Runtime policy

The engine world setting `node.shopEconomyMode` has two explicit values:

- `legacy` is the compatibility default. Existing shared-inventory shops and
  their automatic stock convergence retain the original emulator behaviour.
- `closed-society` disables the legacy shop route. The shop cannot be opened,
  an already open interface cannot submit a transaction, and the world cleanup
  cycle does not automatically add, remove or decay shop stock.

The same setting can be supplied at process start as
`NODE_SHOP_ECONOMY_MODE=closed-society`; an environment value overrides
`data/config/world.json`. Changing either setting requires an engine restart.
Unknown values abort configuration loading instead of silently enabling an
unfunded shop.

This boundary is deliberately fail-closed. The classic sell script pays a
player with a direct inventory add, while the classic buy path does not credit
a Business treasury. Therefore neither direction is a valid closed-society
settlement, even if the visible shared inventory happens to contain an item.
Until the later Business inventory and treasury adapter is ready, the closed
profile exposes no legacy NPC trade rather than pretending that a shared
container is an economic actor.

## Authority and invariants

- A RuneScript command exposes only the boolean compatibility decision; scripts
  cannot choose or widen the configured policy.
- Both shop entry procedures and the final request label enforce the decision.
  The second check protects an interface opened before a policy-aware script
  reload.
- The engine independently disables `InvType.restock` processing in the closed
  mode, so another script cannot recover infinite stock by bypassing the shop UI.
- No item, coin, save, Business balance or treasury record is migrated by this
  change. Closed mode only removes legacy mutation authority.
- Re-enabling trade in a closed society requires an exact Business binding,
  finite inventory, treasury funding and typed atomic settlement. A dialogue,
  NPC type, shared inventory snapshot or LLM output is not sufficient evidence.

## Migration and rollback

There is no persistent schema migration. Before enabling `closed-society`, stop
the engine, back up `data/config/world.json` and any world saves according to the
normal server backup procedure, set the mode, restart, and verify that a legacy
shop reports itself unavailable. Existing shared-shop contents remain present
but inert; they are not accepted as Business opening stock and must later be
handled through the genesis-provenance cutover.

Rollback is configuration-only: stop the engine, restore `legacy` (or the
backed-up world configuration), and restart. That restores emulator compatibility
and its infinite-liquidity behaviour, so it is not an allowed fallback for a
run that still claims closed-society validity. Once a future Business shop has
committed economic transactions, rollback must reconcile forward and must not
copy the old shared inventory or recreate treasury funds.

## Verification

`ShopEconomyPolicy.test.ts` covers the compatibility default, closed-mode denial,
restock denial, persistent configuration, environment override and invalid-mode
rejection. The content build compiles the policy command and all three RuneScript
guards. A live smoke test can additionally attempt to open any `_shop_keeper`
while the closed setting is active and confirm that no shop interface or
inventory/coin delta appears.
