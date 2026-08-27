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
- `.local/admin/world-mod-backups`: automatikus és kézi konfigurációs
  pillanatképek.
- `server/engine/src/mods/WorldMods.ts`: induláskor fail-closed módon betöltött,
  ténylegesen aktív állapot és engine hookok.
- `/api/internal/admin/world-mods`: az engine aktív snapshotja.
- `/api/admin/world-mods`: World Admin lekérdezés és auditált konfigurálás.
- `/api/admin/world-mods/backups`: backup-lista, kézi mentés és revízióvédett
  restore.
- `/api/admin/engine/restart`: indokláshoz kötött, auditált helyi engine-restart.

Az első mintamod a `sample.welcome-message`. Bekapcsolva egy konfigurálható
játéküzenetet ír ki belépéskor. Szándékosan kicsi, nincs perzisztens domainadata,
és kikapcsolással teljesen visszafordítható.

## Életciklus

A `sample.welcome-message` mintamod `hot-reload`: mentéskor a gateway azonnal
kéri az engine atomi újratöltését, így a következő belépés már az új üzenetet
kapja engine-restart nélkül. A `sample.restart-message` alapból kikapcsolt
mintamod külön lefedi a `restart-required` ágat: kért állapota menthető, de csak
engine-induláskor válhat aktívvá.

Minden manifest kötelező `dataSchemaVersion` mezőt tartalmaz. Hot reload közben
az engine csak azonos adatsémájú modot cserél. Magasabb séma
`migration-required`, alacsonyabb séma `rollback-required` állapotot eredményez;
mindkettő változatlanul hagyja a működő aktív modot. Hibás manifest vagy state
szintén fail-closed: a jelölt snapshot nem írhatja felül az aktívat.

A World Admin külön hot-reload gombot ad az ismételt aktiváláshoz. Konfiguráció-
mentésnél a hot mod automatikusan aktiválódik, restore után pedig az engine
automatikusan újraalkalmazza az összes kompatibilis hot modot. Minden kézi vagy
automatikus aktiválási eredmény auditált.

Az engine minden modhoz futásidejű állapotot tart nyilván: hookhívások és hibák
száma, az utolsó hívás és hiba időpontja/szövege, valamint modul-specifikus
domain számlálók. A welcome mintamod első domainmetrikája a sikeresen elküldött
belépési üzenetek száma. Hookhiba nem állíthatja le a world ticket; a mod
`activation-error` állapotba kerül, a hiba pedig látható marad a World Adminban.

## Biztonsági határok

- Ismeretlen mod és konfigurációs kulcs elutasítva.
- Típus-, tartomány-, függőség- és konfliktusellenőrzés mentés előtt.
- Elavult kliensrevízió nem írhatja felül az újabb állapotot.
- Az állapot ideiglenes fájlból, atomi átnevezéssel kerül a helyére.
- Minden konfigurálás előtt automatikus backup, minden restore előtt külön
  mentőpont készül. A restore tartalma új, növekvő revíziót kap.
- A mutáció helyi adminjogot és indoklást kér, és auditbejegyzést készít.
- Hibás engine-konfigurációnál az összes mod kikapcsolva marad.
- Az admin restart csak akkor fut, ha a kérő gateway PID-je egyezik a
  `.local/runtime.json` nyilvántartott, valóban futó gatewayével. Ezután csak a
  hozzá tartozó, indulási idővel is ellenőrzött engine-folyamatot állítja le.
- A gateway és az adminpanel restart közben futva marad; az új engine health
  check után kerül a runtime-nyilvántartásba, a művelet eredménye auditált.

## Regressziós kapu és a 7. fázis lezárása

A LostCity rétegeinek térképe és a változtatások elhelyezési szabályai a
`docs/project/architecture/MODDING_MAP.md` fájlban vannak.

A 7. fázis ismételhető regressziós kapui:

```powershell
# Determinisztikus ellenőrzések, futó lokális stack nélkül
bun run test:phase7

# Ugyanez, majd az engine, gateway és webclient élő health smoke-ja
bun run test:phase7:live
```

A kapu ellenőrzi a formázást, mindkét TypeScript projektet, a teljes
tesztcsomagot, a PowerShell szkriptek szintaxisát, élő módban pedig a lokális
stack egészségét is. Külön regressziós teszt bizonyítja, hogy a kikapcsolt mod
szigorú no-op, a hookhiba pedig nem jut ki a world tickbe és mérhető marad.

A lezáró futás 45 fájlban 332 tesztet és 1293 állítást teljesített hiba nélkül;
az élő health smoke is sikeres volt. Ezzel a 7. fázis elfogadási feltételei
teljesülnek.
