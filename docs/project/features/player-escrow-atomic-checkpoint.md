# Közös adatbázisú játékos-escrow checkpoint – opt-in alap

A `PlayerInventoryEscrowStore` most opcionálisan ugyanazt a `MarketStore`
adatbázis-kapcsolatot használhatja, amelyben a játékosok `accounts` mentési
checkpointja van. Ebben a módban a `mutateWithCheckpoint` az escrow
állapotváltozását és az érintett játékos checkpointját egy SQLite `IMMEDIATE`
tranzakcióba fogja. Sikertelen sorozatosítás vagy SQLite-írás esetén a
tranzakció visszagördül, és a hívó által adott memóriabeli rollback lefut.
Az érintett online játékos neve pontosan egyezzen a művelet payer/payee
oldalával. A meglévő, külön adatbázisú API ezzel a módszerrel nem hívható.

**Ez még nem a meglévő világ átállítása.** A `World` alapértelmezésben a korábbi,
külön `data/mods/player-inventory-escrow.sqlite` fájlt használja. Friss
világban külön kapcsolóval választható a közös tranzakciós út; régi rekordnál
zárva marad. Az új mód nem indít magától régi rekordmigrációt, nem teszi
beszedhetővé a bírságot, és nem oldja meg a Housing-tároló tartalmának
tranzakcióját. A `player_autosave` küldése nem tartóssági igazolás.

Az opt-in `ensurePlayerSaveStore()` a GE kapcsolójától függetlenül meg tudja
nyitni vagy létre tudja hozni ugyanazt a játékos-checkpoint adatbázist;
`marketStore()` kikapcsolt GE mellett ettől még továbbra is tiltott. A szokásos
`playerSaveStore()` olvasó feloldása nem hoz létre új fájlt. A külön folyamatban
futó teszt bizonyítja a GE nélküli létrehozást és újranyitást. Az élő `World`
csak bekapcsolt opt-in mód és sikeres migrációs előellenőrzés után hívja a
közös checkpoint-authorityt.

Éles bevezetés előtt:

1. Le kell állítani a releváns írásokat és mindkét adatbázisról konzisztens
   mentést készíteni.
2. A régi escrow rekordokat státusz és játékos-checkpoint szerint egyeztetni
   kell. `pending`, `releasing`, `reconcile` vagy kétes `held` rekord nem
   migrálható automatikusan; kézi rendezésig zárt marad.
3. Az igazolt rekordokat és auditjukat idempotens, ellenőrzött migrációval
   kell a közös adatbázisba másolni. A betöltésnek ezt az authorityt akkor is
   használnia kell, ha a Grand Exchange ki van kapcsolva; az opt-in megnyitó
   már rendelkezésre áll, az élő bekötés még nincs kész.
4. Az élő `World`-műveleteknek egy világ-ticken belül a közös adatbázisú
   metódust kell használniuk; a teljes érintett játékosállapotot menteniük
   és hiba esetén memóriában visszaállítaniuk kell. A kimenetet restart- és
   áramkimaradás-szimulációs tesztekkel kell igazolni.

Visszaállítás: az éles átállítás előtt a jelenlegi út változatlan. Az első
közös adatbázisú éles írás után a régi külön escrow fájlra egyszerűen
visszakapcsolni tilos; mindkét mentést és az átállás utáni műveleteket
egyeztetni kell. A már megírt escrow rekordok törlése adat-/vagyonvesztést
okozhat.
