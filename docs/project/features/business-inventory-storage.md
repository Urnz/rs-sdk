# Business inventory and storage

A Business működési inventoryja és storage-helyei intézményi tulajdonú állapotok.
Nem a tulajdonos vagy a manager személyes inventoryjának nézetei, és a modul nem
ad olyan fallbacket, amely személyes készletből automatikusan pótolna hiányt.

A `business_inventory` a napi működési készlet kompatibilis belépési pontja. A
`business_storage` több, opcionálisan Propertyhez kötött, névvel és véges
kapacitással rendelkező raktárhelyet ír le. A `business_storage_item` raktáranként
és itemenként tartja a mennyiséget.

Minden mozgatás egyetlen SQLite `IMMEDIATE` tranzakcióban:

- ellenőrzi az aktív Businesst és az actor pontos szerepjogosultságait;
- levonja a forrásból és jóváírja a célhelyen ugyanazt az itemet;
- betartja a raktár kapacitását;
- immutable `business_asset_movement` auditbizonylatot ír;
- azonos operation ID és azonos tartalom esetén idempotens, eltérő tartalomnál
  fail-closed.

## Migráció és visszaállítás

A változás additív: három új táblát hoz létre, a meglévő `business_inventory`
struktúráját és genesis-bizonylatait nem módosítja. Így a korábbi kód a storage-
adatokat figyelmen kívül hagyva továbbra is olvassa a működési inventoryt.

Visszaállítás előtt minden storage-készletet auditált mozgatással vissza kell tenni
a működési inventoryba. Ezután a korábbi programverzió használható; a storage- és
movement-táblák megőrizhetők történeti adatként. Automatikus táblatörlés vagy a
raktárkészlet tulajdonosi inventoryba másolása tilos.
