# Business stock policy

A `config/business-stock-policies.json` Business- és item-specifikusan rögzíti a
minimum-, cél- és maximumkészletet, a beszerzési egységár plafonját, a fix MVP
eladási árat, a védett tartalékot és az egy settlementben eladható mennyiséget.
Az explicit skill-listák csak a review-zott katalógus pontos `id@version`
hivatkozásait fogadják el.

Az institution agent által használható `decideBusinessStock` tiszta, írásmentes
döntés: készlethiánynál beszerzési mennyiséget javasol, továbbá kiszámítja az
eladható mennyiséget és az árat. Nem ír inventoryt, nem indít avatarműveletet, és
nem képes tárgyat létrehozni.

A konkrét készletváltozás két külön lépésből áll:

1. `authorizeStockMovement` a döntést pontos completed verified skill- vagy
   committed trusted-settlement bizonyítékhoz köti, és ellenőrzi a policy
   mennyiségi korlátait.
2. `BusinessStockSettlementStore.apply` egyetlen SQLite tranzakcióban módosítja a
   Business működési inventoryját és immutable, idempotens settlement-bizonylatot
   ír. Eladás elégtelen készletnél teljesen visszagördül.

## Migráció és visszaállítás

A migráció additív: a meglévő Business inventory mellett csak a
`business_stock_settlement` tábla jön létre. Régi világok készletét nem számolja
újra és nem tölt fel automatikusan.

Visszaállításkor a korábbi kód figyelmen kívül hagyhatja az új settlement-táblát;
azt auditcélból meg kell őrizni. Már könyvelt készletmozgás automatikus törlése
tilos. Hibás settlementet új, ellenirányú és önálló bizonyítékú kompenzációval kell
rendezni, nem az audit- vagy inventory-sorok kézi átírásával.
