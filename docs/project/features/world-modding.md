# World modding framework

## Cél

A keretrendszer az Agent Society saját világmódosításait szabványos, látható és
visszakövethető egységekként kezeli. Nem tetszőleges kódot tölt be az admin
felületről: a futtatható implementáció továbbra is verziókezelt kód, a World
Admin pedig kizárólag az előre deklarált manifestet és beállításokat kezelheti.

## Első függőleges szelet

- `config/world-mods.json`: verziókezelt manifest-regiszter.
- `server/gateway/admin/world-mods.ts`: sémaellenőrzés, függőség/ütközés,
  revízióvédelem és atomi állapotmentés.
- `.local/admin/world-mod-state.json`: lokális, gitből kizárt kért állapot.
- `server/engine/src/mods/WorldMods.ts`: induláskor fail-closed módon betöltött,
  ténylegesen aktív állapot és engine hookok.
- `/api/internal/admin/world-mods`: az engine aktív snapshotja.
- `/api/admin/world-mods`: World Admin lekérdezés és auditált konfigurálás.

Az első mintamod a `sample.welcome-message`. Bekapcsolva egy konfigurálható
játéküzenetet ír ki belépéskor. Szándékosan kicsi, nincs perzisztens domainadata,
és kikapcsolással teljesen visszafordítható.

## Életciklus

A mintamod `restart-required`: a World Admin módosítása a kért revíziót írja,
az engine viszont csak induláskor olvassa be. Az admin nézet ezért külön mutatja
a kért és az aktív revíziót, és eltéréskor nem állítja, hogy a változtatás már
él. A későbbi `hot-reload` csak explicit támogatással kerülhet be.

## Biztonsági határok

- Ismeretlen mod és konfigurációs kulcs elutasítva.
- Típus-, tartomány-, függőség- és konfliktusellenőrzés mentés előtt.
- Elavult kliensrevízió nem írhatja felül az újabb állapotot.
- Az állapot ideiglenes fájlból, atomi átnevezéssel kerül a helyére.
- A mutáció helyi adminjogot és indoklást kér, és auditbejegyzést készít.
- Hibás engine-konfigurációnál az összes mod kikapcsolva marad.

## Következő lépések

A 7. fázis befejezéséhez még szükséges a teljes LostCity módosítási térkép,
konfigurációs backup/restore, adminból vezérelt biztonságos engine-restart,
migrációs/rollback protokoll, modmetrikák és a mintamod élő ellenőrzése.
